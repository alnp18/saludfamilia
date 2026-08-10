import { state } from '../state.js';
import * as api from '../lib/api.js';
import { showModal, closeModal, showToast } from '../lib/modal.js';
import { esc, fmtDate } from '../lib/utils.js';
import { emptyStateHtml, errorStateHtml } from '../lib/emptyState.js';
import { openAttachmentViewer } from '../lib/viewer.js';
import { dateRangeFieldHtml, wireDateRangeField, readDateRangeField } from '../lib/dateRange.js';
import { coincideAprox } from '../lib/searchSources.js';

/**
 * Archivo — buscador de los documentos adjuntos a las órdenes médicas
 * (auditoría móvil, Fase 5).
 *
 * El problema que resuelve: los PDFs y las fotos de una orden solo se podían
 * ver entrando a esa orden. Buscar "la autorización de la resonancia del año
 * pasado" obligaba a recorrer órdenes una por una, y las órdenes se listan por
 * paciente. Acá los documentos se ven todos juntos, de toda la familia, y se
 * filtran.
 *
 * Una orden guarda hasta tres documentos, uno por etapa del flujo. No hay una
 * tabla de adjuntos: son tres columnas de `medical_orders`, así que la lista se
 * arma desplegando cada orden en sus documentos en vez de consultando otra
 * tabla.
 */

const SLOTS = [
  { key: 'orden_archivo', etiqueta: 'Historia clínica', fecha: o => o.fechaOrden, hc: true },
  // Ojo: `orden_archivo` guarda la historia clínica y `orden_documento` la
  // orden. El nombre de la primera es histórico — ver migración 0033.
  { key: 'orden_documento', etiqueta: 'Orden', fecha: o => o.fechaOrden, hc: false },
  { key: 'solicitud_imagen', etiqueta: 'Solicitud', fecha: o => o.solicitud_fecha, hc: false },
  { key: 'auth_imagen', etiqueta: 'Autorización', fecha: o => o.auth_fechaInicio, hc: false },
];

// Filtros vivos entre repintados: se conservan mientras dure la sesión para
// que volver a Archivo desde otra vista no obligue a rearmar la búsqueda.
let filtros = { texto: '', soloHc: false, pacienteId: '', medicoId: '', especialidad: '' };
let datos = null; // { docs, pacientes, medicos, especialidades }
// El paciente activo se preselecciona una sola vez, en la primera visita. Si se
// hiciera en cada pintado, "Limpiar filtros" lo volvería a poner y el botón no
// haría lo que dice.
let preseleccionHecha = false;

export async function render() {
  const container = document.getElementById('view-archive');
  if (!container) return;

  container.innerHTML = `
    <div class="view-header">
      <div>
        <div class="view-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><line x1="10" y1="12" x2="14" y2="12"/></svg> Archivo</div>
        <div class="view-sub">Documentos adjuntos a las órdenes médicas de la familia</div>
      </div>
    </div>
    <div id="archive-content"></div>
  `;

  const el = document.getElementById('archive-content');
  el.innerHTML = '<p style="font-size:12.5px;color:var(--ts)">Cargando documentos…</p>';

  try {
    datos = await cargarDocumentos();
  } catch (err) {
    showToast(err.message || 'No se pudo cargar el archivo', 'err');
    el.innerHTML = errorStateHtml({ retryId: 'btn-retry-archive' });
    document.getElementById('btn-retry-archive').addEventListener('click', () => render());
    return;
  }

  if (!datos.docs.length) {
    el.innerHTML = emptyStateHtml({
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><line x1="10" y1="12" x2="14" y2="12"/></svg>',
      title: 'Sin documentos archivados',
      message: 'Acá van a aparecer los PDFs y las fotos que adjuntes a las órdenes médicas: la historia clínica, la solicitud y la autorización.',
    });
    return;
  }

  el.innerHTML = `${filtrosHtml()}<div id="archive-results"></div>`;
  wireFiltros();
  pintarResultados();
}

/**
 * Arma la lista de documentos a partir de las órdenes del household.
 *
 * Las órdenes ya vienen con el nombre del archivo y su ruta en Storage, así que
 * no hace falta tocar el bucket para listar: la URL firmada se pide recién al
 * abrir un documento, que es cuando se necesita y caduca sola.
 */
async function cargarDocumentos() {
  const [ordenes, pacientes, medicos] = await Promise.all([
    api.listOrdersByHousehold(state.household.id),
    api.listPatients(state.household.id),
    api.listDoctors(state.household.id),
  ]);

  const pacienteById = Object.fromEntries(pacientes.map(p => [p.id, p]));
  const medicoById = Object.fromEntries(medicos.map(m => [m.id, m]));

  const docs = [];
  for (const o of ordenes) {
    const paciente = pacienteById[o.patientId] || null;
    const medico = o.medicoId ? medicoById[o.medicoId] || null : null;
    for (const slot of SLOTS) {
      const att = o[slot.key];
      if (!att) continue;
      docs.push({
        orden: o,
        att,
        slot: slot.key,
        etiqueta: slot.etiqueta,
        esHc: slot.hc,
        fecha: slot.fecha(o) || null,
        paciente,
        medico,
        especialidad: medico?.especialidad || '',
        // Texto contra el que corre el buscador. Se arma una vez por documento
        // en vez de por tecla: filtrar en vivo sobre una lista larga es lo que
        // se repite, no cargarla.
        indice: [
          att.name, slot.etiqueta, o.descripcion, o.tipoOrden,
          paciente?.nombre, medico?.nombre, medico?.especialidad,
          o.solicitud_numero, o.auth_numero,
        ].filter(Boolean).join(' '),
      });
    }
  }

  // Más recientes primero. Los que no tienen fecha en su etapa van al final:
  // ordenarlos como si fueran del año 0 los mandaría al fondo igual, pero por
  // accidente; así es una decisión visible.
  docs.sort((a, b) => {
    if (!a.fecha && !b.fecha) return 0;
    if (!a.fecha) return 1;
    if (!b.fecha) return -1;
    return b.fecha.localeCompare(a.fecha);
  });

  const especialidades = [...new Set(docs.map(d => d.especialidad).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  const medicosConDocs = [...new Map(docs.filter(d => d.medico).map(d => [d.medico.id, d.medico])).values()]
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
  const pacientesConDocs = [...new Map(docs.filter(d => d.paciente).map(d => [d.paciente.id, d.paciente])).values()]
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  return { docs, pacientes: pacientesConDocs, medicos: medicosConDocs, especialidades };
}

function filtrosHtml() {
  // El paciente activo entra preseleccionado: es de quien se está hablando en
  // el resto de la aplicación. Se puede quitar para ver a toda la familia.
  if (!preseleccionHecha) {
    preseleccionHecha = true;
    if (state.activePatient && datos.pacientes.some(p => p.id === state.activePatient.id)) {
      filtros.pacienteId = state.activePatient.id;
    }
  }
  const opciones = (lista, sel, valor = x => x.id, texto = x => x.nombre) =>
    lista.map(x => `<option value="${esc(valor(x))}" ${sel === valor(x) ? 'selected' : ''}>${esc(texto(x))}</option>`).join('');

  return `
    <div class="card" style="margin-bottom:16px">
      <div class="form-row cols-3">
        <div class="form-field span2">
          <label class="fl">Buscar</label>
          <input class="fi" id="ar-texto" type="search" placeholder="Nombre del archivo, orden, médico, número de autorización…" value="${esc(filtros.texto)}"/>
        </div>
        <div class="form-field">
          <label class="fl">Paciente</label>
          <select class="fi" id="ar-paciente">
            <option value="">Todos los pacientes</option>
            ${opciones(datos.pacientes, filtros.pacienteId)}
          </select>
        </div>
        <div class="form-field">
          <label class="fl">Especialidad</label>
          <select class="fi" id="ar-especialidad">
            <option value="">Todas</option>
            ${opciones(datos.especialidades, filtros.especialidad, x => x, x => x)}
          </select>
        </div>
        <div class="form-field">
          <label class="fl">Médico</label>
          <select class="fi" id="ar-medico">
            <option value="">Todos</option>
            ${opciones(datos.medicos, filtros.medicoId)}
          </select>
        </div>
        ${dateRangeFieldHtml('ar-fecha', { label: 'Rango de fechas' })}
      </div>
      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:10px">
        <label class="ck-row" for="ar-solo-hc">
          <input type="checkbox" id="ar-solo-hc" ${filtros.soloHc ? 'checked' : ''}/>
          <span>Solo historia clínica</span>
        </label>
        <button type="button" class="btn btn-sm" id="ar-limpiar">Limpiar filtros</button>
        <span class="card-meta" id="ar-conteo" style="margin-left:auto"></span>
      </div>
    </div>`;
}

function wireFiltros() {
  const repintar = () => pintarResultados();
  document.getElementById('ar-texto').addEventListener('input', (e) => {
    filtros.texto = e.target.value;
    repintar();
  });
  document.getElementById('ar-paciente').addEventListener('change', (e) => {
    filtros.pacienteId = e.target.value; repintar();
  });
  document.getElementById('ar-especialidad').addEventListener('change', (e) => {
    filtros.especialidad = e.target.value; repintar();
  });
  document.getElementById('ar-medico').addEventListener('change', (e) => {
    filtros.medicoId = e.target.value; repintar();
  });
  document.getElementById('ar-solo-hc').addEventListener('change', (e) => {
    filtros.soloHc = e.target.checked; repintar();
  });
  wireDateRangeField('ar-fecha', { onChange: repintar });
  document.getElementById('ar-limpiar').addEventListener('click', () => {
    filtros = { texto: '', soloHc: false, pacienteId: '', medicoId: '', especialidad: '' };
    render();
  });
}

function aplicarFiltros() {
  const { inicio, fin } = readDateRangeField('ar-fecha');
  const q = filtros.texto.trim();
  return datos.docs.filter(d => {
    if (filtros.soloHc && !d.esHc) return false;
    if (filtros.pacienteId && d.paciente?.id !== filtros.pacienteId) return false;
    if (filtros.medicoId && d.medico?.id !== filtros.medicoId) return false;
    if (filtros.especialidad && d.especialidad !== filtros.especialidad) return false;
    // Un documento sin fecha en su etapa no puede afirmarse dentro de un rango:
    // se excluye cuando hay rango, en vez de colarse por no tener con qué
    // compararse.
    if (inicio || fin) {
      if (!d.fecha) return false;
      if (inicio && d.fecha < inicio) return false;
      if (fin && d.fecha > fin) return false;
    }
    if (q && !coincideAprox(d.indice, q)) return false;
    return true;
  });
}

function pintarResultados() {
  const cont = document.getElementById('archive-results');
  if (!cont) return;
  const docs = aplicarFiltros();

  const conteo = document.getElementById('ar-conteo');
  if (conteo) {
    conteo.textContent = `${docs.length} de ${datos.docs.length} documento${datos.docs.length !== 1 ? 's' : ''}`;
  }

  if (!docs.length) {
    cont.innerHTML = `<p style="font-size:12.5px;color:var(--ts);padding:10px 2px">Ningún documento coincide con estos filtros.</p>`;
    return;
  }

  // Agrupados por orden: un documento suelto ("solicitud.pdf, 3 de marzo") no
  // dice de qué es. La orden es lo que le da sentido, y además es la unidad
  // que abre la línea de tiempo.
  const porOrden = new Map();
  for (const d of docs) {
    if (!porOrden.has(d.orden.id)) porOrden.set(d.orden.id, { orden: d.orden, paciente: d.paciente, medico: d.medico, docs: [] });
    porOrden.get(d.orden.id).docs.push(d);
  }

  cont.innerHTML = [...porOrden.values()].map(g => `
    <div class="card" style="margin-bottom:10px">
      <div class="card-hd" style="flex-wrap:wrap;gap:8px">
        <h2 style="font-size:13.5px">${esc(g.orden.descripcion || 'Orden sin descripción')}</h2>
        <span class="card-meta">${[
          g.orden.tipoOrden,
          g.paciente?.nombre,
          g.medico ? g.medico.nombre + (g.medico.especialidad ? ' · ' + g.medico.especialidad : '') : null,
        ].filter(Boolean).map(esc).join(' — ')}</span>
        <button type="button" class="btn btn-sm btn-ghost" data-timeline="${g.orden.id}" style="margin-left:auto">Línea de tiempo</button>
      </div>
      ${g.docs.map(d => `
        <div class="policy-item">
          <div class="policy-info">
            <div class="policy-tipo">${esc(d.etiqueta)}${d.esHc ? ' <span class="dir-mini-tag">HC</span>' : ''}</div>
            <div class="policy-num">${esc(d.att.name || 'Documento')}${d.fecha ? ' · ' + fmtDate(d.fecha) : ' · sin fecha'}</div>
          </div>
          <div class="policy-actions">
            <button type="button" class="btn btn-sm" data-abrir="${d.orden.id}|${d.slot}">Abrir</button>
          </div>
        </div>`).join('')}
    </div>`).join('');

  cont.querySelectorAll('[data-abrir]').forEach(b => b.addEventListener('click', () => {
    const [ordenId, slot] = b.dataset.abrir.split('|');
    const doc = docs.find(d => d.orden.id === ordenId && d.slot === slot);
    if (doc) openAttachmentViewer(doc.att);
  }));
  cont.querySelectorAll('[data-timeline]').forEach(b => b.addEventListener('click', () =>
    openTimelineModal(porOrden.get(b.dataset.timeline))));
}

/**
 * Línea de tiempo de una sola orden: sus documentos en el orden en que
 * ocurrieron, con los hitos sin documento incluidos.
 *
 * Los hitos vacíos se muestran a propósito. En un flujo de cuatro etapas, que
 * falte la autorización es información — y si solo se listaran los documentos
 * existentes, ese hueco sería indistinguible de una etapa que todavía no llegó.
 */
function openTimelineModal(grupo) {
  const o = grupo.orden;
  const conDoc = Object.fromEntries(grupo.docs.map(d => [d.slot, d]));

  // La etapa A puede tener DOS documentos (historia clínica y orden), así que
  // cada hito lista los suyos en vez de asumir uno solo.
  const hitos = [
    { etiqueta: 'Orden médica', fecha: o.fechaOrden, nota: '',
      slots: [['orden_archivo', 'Historia clínica'], ['orden_documento', 'Orden']] },
    { etiqueta: 'Solicitud', fecha: o.solicitud_fecha, nota: o.solicitud_numero ? 'N.º ' + o.solicitud_numero : '',
      slots: [['solicitud_imagen', 'Documento']] },
    { etiqueta: 'Autorización', fecha: o.auth_fechaInicio, nota: o.auth_numero ? 'N.º ' + o.auth_numero : '',
      slots: [['auth_imagen', 'Documento']] },
    { etiqueta: 'Cita', fecha: o.cita_fecha, nota: o.cita_hora ? o.cita_hora.slice(0, 5) : '', slots: [] },
  ];

  showModal(
    'Línea de tiempo de la orden',
    `<div class="form-body">
      <p style="font-size:12.5px;color:var(--ts);margin:0 0 12px">
        ${esc(o.descripcion || 'Orden sin descripción')}${grupo.paciente ? ' — ' + esc(grupo.paciente.nombre) : ''}
      </p>
      <div class="hist-timeline">
        ${hitos.map(h => {
          const presentes = h.slots.filter(([slot]) => conDoc[slot]);
          return `<div class="hist-item${h.fecha ? ' current' : ''}">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
              <strong style="color:var(--tp)">${esc(h.etiqueta)}</strong>
              <span style="color:var(--ts)">${h.fecha ? fmtDate(h.fecha) : 'sin registrar'}</span>
              ${h.nota ? `<span style="color:var(--tm)">${esc(h.nota)}</span>` : ''}
              <span style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap">
                ${presentes.length
                  ? presentes.map(([slot, etiqueta]) =>
                      `<button type="button" class="btn btn-sm" data-tl-abrir="${esc(slot)}">${esc(etiqueta)}</button>`).join('')
                  : (h.slots.length ? '<span style="color:var(--tm)">sin documento</span>' : '')}
              </span>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`,
    [{ label: 'Cerrar', cls: 'btn', action: closeModal }]
  );

  document.querySelectorAll('[data-tl-abrir]').forEach(b => b.addEventListener('click', () => {
    const doc = conDoc[b.dataset.tlAbrir];
    if (doc) openAttachmentViewer(doc.att);
  }));
}
