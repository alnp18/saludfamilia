import { state } from '../state.js';
import * as api from '../lib/api.js';
import * as files from '../lib/files.js';
import { showModal, closeModal, showToast, setModalMaxWidth } from '../lib/modal.js';
import { esc, today } from '../lib/utils.js';
import { createAttachmentField } from '../lib/attachmentField.js';
import { doctorFieldHtml, wireDoctorField, leerDoctorField, fillDoctorField, etiquetaMedico } from '../lib/doctorField.js';
import { SPECIALTIES } from './doctors.js';

/**
 * Asistente de CONSULTA (migración 0035).
 *
 * Registrar y hacer seguimiento son dos momentos distintos, separados por
 * semanas, y hasta ahora estaban en el mismo formulario: el día de la consulta
 * la aplicación te preguntaba por la CITA, que es imposible que sepas
 * todavía. Acá viven solo el registro:
 *
 *   A · Consulta  — fecha, médico e historia clínica. Una vez.
 *   B · Órdenes   — tantas como haya salido de esa consulta.
 *
 * Un solo guardado. Nunca pregunta por solicitud, autorización ni cita: eso es
 * el seguimiento, y se hace después, orden por orden, desde `orders.js`.
 *
 * Las filas de órdenes viven en memoria hasta guardar, igual que la tabla
 * mes-a-mes de autorizaciones. Cada una lleva su propio campo de adjunto
 * (`createAttachmentField`), que guarda su estado en su propio cierre — por eso
 * volver a dibujar la lista no pierde el PDF ya elegido.
 */

const ORDER_TYPES = ['Cita de control', 'Nueva especialidad', 'Medicamentos/Insumos/Terapias', 'Examen', 'Laboratorio', 'Otro'];

/** Filas de la pestaña B mientras se edita. */
let filas = [];
/** Órdenes que existían al abrir y que el usuario quitó: se borran al guardar. */
let filasBorradas = [];
/** Campo de adjunto de la historia clínica (nivel consulta). */
let campoHc = null;
/** Contador para dar un id de DOM único a cada fila, incluso tras quitar otras. */
let uidSeq = 0;
/** Ruta de la historia clínica al abrir, para borrarla si se reemplaza. */
let hcOriginalPath = null;

/**
 * Abre el asistente. Sin `visitId` es una consulta nueva.
 * `onSaved` se llama con la consulta guardada — lo usa la vista que la abrió
 * para refrescarse.
 */
export async function openConsultaWizard(visitId, { onSaved, filaNueva } = {}) {
  if (!state.activePatient) { showToast('Selecciona un paciente primero', 'err'); return; }

  filas = [];
  filasBorradas = [];
  uidSeq = 0;
  hcOriginalPath = null;
  campoHc = createAttachmentField({
    id: 'oc-hc',
    nombreArchivo: 'historia-clinica',
    dropText: 'Haz clic para subir la historia clínica (PDF o foto)',
  });

  let visita = null;
  try {
    if (visitId) {
      visita = await api.getVisit(visitId);
      hcOriginalPath = files.isStored(visita.hc_archivo) ? visita.hc_archivo.path : null;
      const ordenes = await api.listOrdersByVisit(visitId);
      ordenes.forEach(o => filas.push(nuevaFila({
        id: o.id,
        tipoOrden: o.tipoOrden || '',
        descripcion: o.descripcion || '',
        documento: o.orden_documento || null,
        stage: o._stage,
      })));
    }
  } catch (err) {
    showToast(err.message || 'No se pudo abrir la consulta', 'err');
    return;
  }

  // Una fila pedida por quien abrió el asistente — hoy, la orden de control
  // que se ofrece al marcar una cita como finalizada.
  if (filaNueva) filas.push(nuevaFila(filaNueva));

  // Una consulta nueva arranca con una fila: el caso corriente es una consulta
  // con una orden, y obligar a pulsar "Agregar" para llegar a él sería cobrar
  // dos veces por lo mismo.
  if (!filas.length) filas.push(nuevaFila());

  const body = `
    <div class="wiz-tabs" id="oc-tabs">
      <button class="wiz-tab active" data-t="a" type="button"><span class="wiz-dot"></span>A · Consulta</button>
      <button class="wiz-tab" data-t="b" type="button"><span class="wiz-dot"></span>B · Órdenes</button>
    </div>

    <div class="wiz-pane visible" id="oc-pane-a">
      <div class="info-box" style="margin-bottom:16px">Registra la consulta tal como pasó: la fecha, quién atendió y la historia clínica. Las órdenes que salieron de ella van en la pestaña siguiente.</div>
      <div class="form-row cols-2">
        <div class="form-field"><label class="fl">Fecha de la consulta</label><input class="fi" id="oc-fecha" type="date"/></div>
        <div class="form-field"></div>
        ${doctorFieldHtml('oc-medico', { span: true })}
        <div class="form-field span2">
          <label class="fl">Historia clínica</label>
          ${campoHc.html()}
        </div>
      </div>
    </div>

    <div class="wiz-pane" id="oc-pane-b">
      <div class="info-box" style="margin-bottom:16px">Una consulta puede terminar en varias órdenes. Agrega acá todas las que te entregaron: cada una lleva después su propia solicitud, autorización y cita.</div>
      <div id="oc-ordenes"></div>
      <button type="button" class="btn btn-sm" id="oc-add-orden" style="width:100%;justify-content:center;margin-top:10px">+ Agregar otra orden</button>
    </div>
  `;

  showModal(visitId ? 'Editar consulta' : 'Nueva consulta', body, [
    { label: 'Cancelar', cls: 'btn', action: closeModal },
    { label: visitId ? 'Guardar cambios' : 'Guardar consulta', cls: 'btn btn-primary', action: () => guardar(visitId, onSaved) },
  ]);
  setModalMaxWidth('680px');

  document.querySelectorAll('#oc-tabs .wiz-tab').forEach(t =>
    t.addEventListener('click', () => irAPestana(t.dataset.t)));

  document.getElementById('oc-fecha').value = visita?.fecha || today();
  campoHc.wire();
  if (visita?.hc_archivo) campoHc.set(visita.hc_archivo);

  wireDoctorField('oc-medico', { specialties: SPECIALTIES });
  if (visita?.medicoId) {
    const doctors = await api.listDoctors(state.household.id).catch(() => []);
    fillDoctorField('oc-medico', {
      id: visita.medicoId,
      label: etiquetaMedico(doctors.find(d => d.id === visita.medicoId)),
    });
  }

  document.getElementById('oc-add-orden').addEventListener('click', () => {
    leerFilas();
    filas.push(nuevaFila());
    pintarFilas();
    // La fila nueva queda al final; se lleva el foco para no obligar a buscarla.
    document.getElementById(`oc-tipo-${filas[filas.length - 1].uid}`)?.focus();
  });

  pintarFilas();
}

function irAPestana(t) {
  // Antes de cambiar de pestaña hay que volcar lo escrito al modelo: la
  // pestaña B se vuelve a dibujar entera y perdería los campos de texto.
  leerFilas();
  document.querySelectorAll('#oc-tabs .wiz-tab').forEach(el => el.classList.toggle('active', el.dataset.t === t));
  document.getElementById('oc-pane-a').classList.toggle('visible', t === 'a');
  document.getElementById('oc-pane-b').classList.toggle('visible', t === 'b');
  if (t === 'b') pintarFilas();
}

function nuevaFila({ id = null, tipoOrden = '', descripcion = '', documento = null, stage = 'A' } = {}) {
  const uid = ++uidSeq;
  const campo = createAttachmentField({
    id: `oc-doc-${uid}`,
    nombreArchivo: 'orden',
    dropText: 'Subir la orden (PDF o foto)',
  });
  if (documento) campo.set(documento);
  return { uid, id, tipoOrden, descripcion, campo, documento, stage };
}

/** Vuelca al modelo lo escrito en el DOM. Se llama antes de cualquier redibujo. */
function leerFilas() {
  filas.forEach(f => {
    const tipo = document.getElementById(`oc-tipo-${f.uid}`);
    const desc = document.getElementById(`oc-desc-${f.uid}`);
    if (tipo) f.tipoOrden = tipo.value;
    if (desc) f.descripcion = desc.value.trim();
  });
}

function pintarFilas() {
  const cont = document.getElementById('oc-ordenes');
  if (!cont) return;

  cont.innerHTML = filas.map((f, i) => {
    // Una orden que ya avanzó de etapa no se puede quitar desde acá: se le
    // tramitó una solicitud, hay un número de radicado de por medio. Es la
    // misma regla que ya regía para borrar una orden suelta.
    const puedeQuitar = !f.id || f.stage === 'A';
    return `
    <div class="oc-orden" data-fila="${f.uid}">
      <div class="oc-orden-hd">
        <span class="oc-orden-num">Orden ${i + 1}${f.id && f.stage !== 'A' ? ` · en ${esc(f.stage)}` : ''}</span>
        ${puedeQuitar
          ? `<button type="button" class="oc-orden-quitar" data-quitar="${f.uid}" title="Quitar esta orden" aria-label="Quitar esta orden">✕</button>`
          : `<span class="oc-orden-fijo" title="Ya tiene solicitud tramitada">en trámite</span>`}
      </div>
      <div class="form-row cols-2">
        <div class="form-field">
          <label class="fl">Tipo de orden</label>
          <select class="fi" id="oc-tipo-${f.uid}">
            <option value="">Seleccione tipo</option>
            ${ORDER_TYPES.map(t => `<option ${f.tipoOrden === t ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
        </div>
        <div class="form-field">
          <label class="fl">Descripción</label>
          <input class="fi" id="oc-desc-${f.uid}" type="text" placeholder="Ej: Ecografía abdominal" value="${esc(f.descripcion)}"/>
        </div>
        <div class="form-field span2">
          <label class="fl">Documento de la orden</label>
          ${f.campo.html()}
        </div>
      </div>
    </div>`;
  }).join('');

  // Cada campo de adjunto guarda su estado en su propio cierre, así que
  // volver a conectarlo redibuja el PDF que ya se hubiera elegido.
  filas.forEach(f => f.campo.wire());

  cont.querySelectorAll('[data-quitar]').forEach(btn => btn.addEventListener('click', () => {
    leerFilas();
    const uid = Number(btn.dataset.quitar);
    const fila = filas.find(f => f.uid === uid);
    if (fila?.id) filasBorradas.push(fila.id);
    filas = filas.filter(f => f.uid !== uid);
    if (!filas.length) filas.push(nuevaFila());
    pintarFilas();
  }));
}

async function guardar(visitId, onSaved) {
  leerFilas();

  const fecha = document.getElementById('oc-fecha').value;
  if (!fecha) { showToast('La fecha de la consulta es obligatoria', 'err'); irAPestana('a'); return; }

  let medicoId;
  try {
    medicoId = leerDoctorField('oc-medico');
  } catch (err) {
    showToast(err.message, 'err');
    irAPestana('a');
    return;
  }

  // Una fila vacía del todo no es una orden a medio llenar: es una fila que
  // sobró de pulsar "Agregar". Se descarta en silencio. Lo que sí se avisa es
  // una fila a medias, sin tipo.
  const utiles = filas.filter(f => f.id || f.tipoOrden || f.descripcion || f.campo.get());
  const sinTipo = utiles.find(f => !f.tipoOrden);
  if (sinTipo) {
    showToast('Cada orden necesita un tipo', 'err');
    irAPestana('b');
    document.getElementById(`oc-tipo-${sinTipo.uid}`)?.focus();
    return;
  }

  const hh = state.household.id;
  const pat = state.activePatient.id;

  try {
    // ── 1. La consulta ──────────────────────────────────────────────
    // La historia clínica necesita el id de la consulta para su ruta en
    // Storage, así que una consulta nueva se guarda primero sin adjunto.
    const hc = campoHc.get();
    const hcPendiente = !!(hc && hc.data && !files.isStored(hc));

    let visita = await api.saveVisit(
      { id: visitId, medicoId, fecha, hc_archivo: hcPendiente ? null : hc },
      hh, pat,
    );

    if (hcPendiente) {
      const subida = await files.uploadAttachment(hh, visita.id, 'hc', hc);
      visita = await api.saveVisit({ id: visita.id, medicoId, fecha, hc_archivo: subida }, hh, pat);
    }

    // ── 2. Las órdenes ──────────────────────────────────────────────
    for (const f of utiles) {
      const doc = f.campo.get();
      const docPendiente = !!(doc && doc.data && !files.isStored(doc));

      let orden = await api.saveOrder({
        id: f.id || undefined,
        visitId: visita.id,
        tipoOrden: f.tipoOrden,
        descripcion: f.descripcion,
        orden_documento: docPendiente ? null : doc,
        // Las etapas B, C y D no se tocan acá. `saveOrder` reconstruye la fila
        // entera, así que en una orden que ya existía hay que devolverle lo que
        // este formulario no muestra, o se guardaría vacío encima.
        ...(f.id ? await camposDeSeguimiento(f.id) : {}),
      }, hh, pat);

      if (docPendiente) {
        const subido = await files.uploadAttachment(hh, orden.id, 'documento', doc);
        orden = await api.saveOrder({
          id: orden.id,
          visitId: visita.id,
          tipoOrden: f.tipoOrden,
          descripcion: f.descripcion,
          orden_documento: subido,
          ...(await camposDeSeguimiento(orden.id)),
        }, hh, pat);
      }
      f.id = orden.id;
    }

    // ── 3. Las que se quitaron ──────────────────────────────────────
    for (const id of filasBorradas) {
      const orden = await api.getOrder(id).catch(() => null);
      await api.deleteOrder(id).catch(() => {});
      // Solo los adjuntos PROPIOS de la orden: la historia clínica es de la
      // consulta y la comparten sus hermanas (ver files.attachmentPathsOfOrder).
      if (orden) files.removeAttachments(files.attachmentPathsOfOrder(orden));
    }
    filasBorradas = [];

    // La historia clínica anterior, si se reemplazó o se quitó. Mejor esfuerzo
    // y después de guardar: un huérfano en el bucket es preferible a borrar
    // algo que la consulta todavía referencia.
    const hcFinal = files.isStored(visita.hc_archivo) ? visita.hc_archivo.path : null;
    if (hcOriginalPath && hcOriginalPath !== hcFinal) files.removeAttachments([hcOriginalPath]);

    closeModal();
    showToast(visitId ? 'Consulta actualizada' : 'Consulta guardada');
    onSaved?.(visita);
  } catch (err) {
    showToast(err.message || 'Error al guardar la consulta', 'err');
  }
}

/**
 * Devuelve las etapas B, C y D de una orden ya existente, tal como están en la
 * base. El asistente de consulta no las muestra, y `saveOrder` hace un UPDATE
 * de la fila completa: sin esto, editar la descripción de una orden le borraría
 * la autorización. Es exactamente el fallo que la migración 0034 destapó en la
 * vista, y no vale la pena repetirlo por otro camino.
 */
async function camposDeSeguimiento(orderId) {
  const o = await api.getOrder(orderId);
  return {
    solicitud_fecha: o.solicitud_fecha,
    solicitud_hora: o.solicitud_hora,
    solicitud_numero: o.solicitud_numero,
    solicitud_imagen: o.solicitud_imagen,
    auth_fechaInicio: o.auth_fechaInicio,
    auth_fechaVence: o.auth_fechaVence,
    auth_numero: o.auth_numero,
    auth_centroId: o.auth_centroId,
    auth_imagen: o.auth_imagen,
    auth_meses: o.auth_meses,
    cita_fecha: o.cita_fecha,
    cita_hora: o.cita_hora,
    medicoId_cita: o.medicoId_cita,
    cita_consultorio: o.cita_consultorio,
    cita_direccion: o.cita_direccion,
    cita_indicaciones: o.cita_indicaciones,
    estadoCita: o.estadoCita,
  };
}
