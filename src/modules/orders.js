import { state } from '../state.js';
import * as api from '../lib/api.js';
import * as files from '../lib/files.js';
import { showModal, closeModal, showToast, setModalMaxWidth } from '../lib/modal.js';
import { esc, fmtDate, today, daysFrom, readFileAsDataURL } from '../lib/utils.js';
import { SPECIALTIES } from './doctors.js';
import { wireInlineNewCenter, wireInlineNewDoctor } from '../lib/inlineDirectory.js';

const ORDER_TYPES = ['Cita de control', 'Nueva especialidad', 'Medicamento', 'Suministro médico', 'Examen', 'Laboratorio', 'Otro'];
const STAGE_ORDER = ['A', 'B', 'C', 'D', 'Finalizado'];
const STAGE_LABELS = { A: 'Orden', B: 'Solicitud', C: 'Autorización', D: 'Cita', Finalizado: 'Finalizado' };
// Índice comparable de cada pestaña del asistente dentro de STAGE_ORDER —
// usado para la alerta de "vas a editar una etapa anterior" (ver switchWizTab).
const TAB_STAGE_IDX = { a: 0, b: 1, c: 2, d: 3 };
const TAB_BY_STAGE = { A: 'a', B: 'b', C: 'c', D: 'd', Finalizado: 'd' };

let activeFilter = 'all'; // etapa
let activeSpecialty = 'all'; // especialidad del médico tratante
let orderFiles = { orden: null, solicitud: null, autorizacion: null };
let originalStoredPaths = []; // adjuntos en Storage al abrir el wizard (para limpiar reemplazados)
let pendingOptions = null; // { openWizard, openOrderId } pasado desde goView
// -1 = orden nueva (sin restricción de navegación); si no, índice de la
// etapa ya alcanzada por la orden que se está editando (ver switchWizTab).
let currentOrderStageIdx = -1;

export function setPendingOptions(opts) { pendingOptions = opts; }

export async function render() {
  const container = document.getElementById('view-orders');
  if (!container) return;

  container.innerHTML = `
    <div class="view-header">
      <div>
        <div class="view-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/><path d="M9 14l2 2 4-4"/></svg> Órdenes médicas</div>
        <div class="view-sub" id="orders-sub">Flujo completo Orden → Solicitud → Autorización → Cita</div>
      </div>
      <button class="btn btn-primary" id="btn-new-order"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Nueva orden</button>
    </div>
    <div class="orders-filters-row" id="orders-filters-row">
      <div class="filter-pills" id="orders-filters"></div>
      <select class="fi" id="orders-filter-especialidad" style="max-width:220px"></select>
    </div>
    <div id="orders-list" style="display:flex;flex-direction:column;gap:12px"></div>
  `;
  document.getElementById('btn-new-order').addEventListener('click', () => openOrderWizard());

  const sub = document.getElementById('orders-sub');
  const list = document.getElementById('orders-list');
  const filtersEl = document.getElementById('orders-filters');
  const espSelect = document.getElementById('orders-filter-especialidad');

  if (!state.activePatient) {
    sub.textContent = 'Selecciona un paciente para ver sus órdenes';
    filtersEl.innerHTML = '';
    espSelect.innerHTML = '';
    list.innerHTML = `<div class="empty-state"><div class="es-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg></div><h3>Selecciona un paciente</h3></div>`;
    document.getElementById('sb-badge-orders').style.display = 'none';
    return;
  }
  sub.textContent = `Órdenes de ${state.activePatient.nombre}`;

  const [orders, doctors] = await Promise.all([
    api.listOrdersByPatient(state.activePatient.id),
    api.listDoctors(state.household.id),
  ]);
  const docMap = Object.fromEntries(doctors.map(d => [d.id, d]));

  const pendingCount = orders.filter(o => o._stage === 'A' || o._stage === 'B').length;
  const badge = document.getElementById('sb-badge-orders');
  if (pendingCount) { badge.style.display = 'flex'; badge.textContent = pendingCount; } else { badge.style.display = 'none'; }

  const counts = { all: orders.length };
  STAGE_ORDER.forEach(s => counts[s] = orders.filter(o => o._stage === s).length);
  const pillDefs = [
    ['all', 'Todas', counts.all], ['A', 'Orden', counts.A], ['B', 'Solicitud', counts.B],
    ['C', 'Autorización', counts.C], ['D', 'Cita', counts.D], ['Finalizado', 'Finalizadas', counts.Finalizado],
  ];
  filtersEl.innerHTML = pillDefs.map(([key, label, n]) =>
    `<div class="filter-pill ${activeFilter === key ? 'active' : ''}" data-filter="${key}">${label} <span class="count">${n}</span></div>`
  ).join('');
  filtersEl.querySelectorAll('[data-filter]').forEach(el =>
    el.addEventListener('click', () => { activeFilter = el.dataset.filter; render(); }));

  // Filtro combinado: además de la etapa, por especialidad del médico
  // tratante — solo se listan las especialidades que de verdad aparecen
  // entre las órdenes de este paciente (no todo el directorio).
  const specialtiesPresent = [...new Set(orders.map(o => docMap[o.medicoId]?.especialidad).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  if (!specialtiesPresent.includes(activeSpecialty)) activeSpecialty = 'all';
  espSelect.innerHTML = `<option value="all">Todas las especialidades</option>${specialtiesPresent.map(s => `<option value="${esc(s)}" ${activeSpecialty === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}`;
  espSelect.style.display = specialtiesPresent.length ? '' : 'none';
  espSelect.addEventListener('change', () => { activeSpecialty = espSelect.value; render(); });

  let filtered = orders.filter(o =>
    (activeFilter === 'all' || o._stage === activeFilter) &&
    (activeSpecialty === 'all' || docMap[o.medicoId]?.especialidad === activeSpecialty)
  );
  // "Que ordena": agrupa por especialidad del tratante y, dentro de cada
  // grupo, por fecha de la orden (más reciente primero).
  filtered = filtered.slice().sort((a, b) => {
    const espA = docMap[a.medicoId]?.especialidad || '';
    const espB = docMap[b.medicoId]?.especialidad || '';
    if (espA !== espB) return espA.localeCompare(espB);
    return (b.fechaOrden || '').localeCompare(a.fechaOrden || '');
  });

  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state">
      <svg width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.2"><path stroke-linecap="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z"/></svg>
      <h3>${orders.length ? 'Sin resultados para este filtro' : 'Sin órdenes registradas'}</h3>
      <p>${orders.length ? 'Prueba con otro filtro de etapa o especialidad.' : 'Registra la primera orden médica de ' + esc(state.activePatient.nombre) + '.'}</p>
      ${!orders.length ? '<button class="btn btn-primary" id="btn-new-order-empty" style="margin-top:8px">Nueva orden</button>' : ''}
    </div>`;
    document.getElementById('btn-new-order-empty')?.addEventListener('click', () => openOrderWizard());
  } else {
    list.innerHTML = filtered.map(o => renderOrderCard(o, docMap)).join('');
    list.querySelectorAll('[data-view-order]').forEach(el => el.addEventListener('click', (e) => {
      if (e.target.closest('[data-delete-order]')) return;
      openOrderModal(el.dataset.viewOrder);
    }));
    list.querySelectorAll('[data-delete-order]').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteOrderConfirm(b.dataset.deleteOrder);
    }));
  }

  // Manejar navegación entrante desde el dashboard
  if (pendingOptions?.openWizard) { pendingOptions = null; openOrderWizard(); }
  else if (pendingOptions?.openOrderId) { const id = pendingOptions.openOrderId; pendingOptions = null; openOrderModal(id); }
}

function renderOrderCard(o, docMap) {
  const doc = docMap[o.medicoId];
  const stageIdx = STAGE_ORDER.indexOf(o._stage);
  const tags = [];

  const dExp = o.auth_fechaVence ? daysFrom(o.auth_fechaVence) : null;
  if (dExp !== null && dExp >= 0 && dExp <= 15 && o._stage !== 'Finalizado') {
    tags.push(`<span class="tag ${dExp <= 5 ? 'tag-red' : 'tag-amber'}">Autorización vence en ${dExp}d</span>`);
  }
  if (dExp !== null && dExp < 0 && o._stage !== 'Finalizado') tags.push(`<span class="tag tag-red">Autorización vencida</span>`);
  if (o.cita_fecha) {
    const dCita = daysFrom(o.cita_fecha);
    if (dCita !== null && dCita >= 0 && dCita <= 7 && o._stage !== 'Finalizado') tags.push(`<span class="tag tag-teal">Cita en ${dCita === 0 ? 'hoy' : dCita + 'd'}</span>`);
  }
  if (o._stage === 'A') tags.push(`<span class="tag tag-red">Sin tramitar</span>`);
  if (o._stage === 'Finalizado') tags.push(`<span class="tag tag-green">Completado</span>`);

  const steps = STAGE_ORDER.slice(0, 4).map((s, i) => {
    const cls = i < stageIdx || o._stage === 'Finalizado' ? 'done' : (i === stageIdx ? 'current' : '');
    return `<div class="step ${cls}"><div class="step-line"></div><div class="step-dot">${cls === 'done' ? '✓' : (i + 1)}</div><div class="step-label">${STAGE_LABELS[s]}</div></div>`;
  }).join('');

  return `<div class="order-card" data-view-order="${o.id}" style="cursor:pointer">
    <div class="order-card-top">
      <div class="order-type-ic"><svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="var(--t-primary-lt)" stroke-width="1.7"><path stroke-linecap="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z"/></svg></div>
      <div style="flex:1;min-width:0">
        <div class="order-title">${esc(o.tipoOrden || 'Orden médica')}${doc ? ' · ' + esc(doc.nombre) : ''}</div>
        <div class="order-sub">${esc(o.descripcion || 'Sin descripción')} · Generada ${fmtDate(o.fechaOrden)}</div>
      </div>
      <div class="order-card-actions">
        <button class="btn btn-sm btn-icon btn-danger" data-delete-order="${o.id}" title="Eliminar"><svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862"/></svg></button>
      </div>
    </div>
    <div class="order-card-body">
      <div class="stepper">${steps}</div>
      ${tags.length ? `<div class="order-tags">${tags.join('')}</div>` : ''}
    </div>
  </div>`;
}

async function deleteOrderConfirm(id) {
  if (!confirm('¿Eliminar esta orden médica? Se perderá todo su seguimiento.')) return;
  // Recoger las rutas de adjuntos ANTES de borrar la fila, para limpiar
  // el Storage después (mejor esfuerzo).
  let paths = [];
  try { paths = files.attachmentPathsOfOrder(await api.getOrder(id)); } catch { /* sin limpieza */ }
  await api.deleteOrder(id);
  files.removeAttachments(paths);
  showToast('Orden eliminada', 'warn');
  render();
}

// ─────────────────────────────────────────
// Vista de solo lectura (por defecto al abrir una orden existente — P1.5)
// ─────────────────────────────────────────
function roField(label, valueHtml) {
  return `<div class="ro-field"><div class="ro-label">${label}</div><div class="ro-value">${valueHtml ?? '<span class="ro-empty">—</span>'}</div></div>`;
}

function renderOrderReadView(o, docMap, centerMap) {
  const doc = docMap[o.medicoId];
  const docCita = docMap[o.medicoId_cita];
  const centro = centerMap[o.auth_centroId];
  const stageIdx = STAGE_ORDER.indexOf(o._stage);

  const seccionA = `<div class="ro-section">
    <div class="ro-section-title">A · Orden</div>
    ${roField('Médico tratante', doc ? esc(doc.nombre) + (doc.especialidad ? ' — ' + esc(doc.especialidad) : '') : null)}
    ${roField('Fecha', o.fechaOrden ? fmtDate(o.fechaOrden) : null)}
    ${roField('Tipo de orden', o.tipoOrden ? esc(o.tipoOrden) : null)}
    ${roField('Descripción', o.descripcion ? esc(o.descripcion) : null)}
    ${o.orden_archivo ? `<button type="button" class="btn btn-sm btn-ghost" data-view-file="orden">Ver historia clínica</button>` : roField('Historia clínica', null)}
  </div>`;

  const seccionB = stageIdx >= 1 ? `<div class="ro-section">
    <div class="ro-section-title">B · Solicitud</div>
    ${roField('Fecha', o.solicitud_fecha ? fmtDate(o.solicitud_fecha) : null)}
    ${roField('Hora', o.solicitud_hora ? esc(o.solicitud_hora) : null)}
    ${roField('Número de solicitud', o.solicitud_numero ? esc(o.solicitud_numero) : null)}
    ${o.solicitud_imagen ? `<button type="button" class="btn btn-sm btn-ghost" data-view-file="solicitud">Ver imagen</button>` : ''}
  </div>` : `<div class="ro-section ro-pending"><div class="ro-section-title">B · Solicitud</div><p class="ro-empty-msg">Aún no se ha tramitado la solicitud.</p></div>`;

  const seccionC = stageIdx >= 2 ? `<div class="ro-section">
    <div class="ro-section-title">C · Autorización</div>
    ${roField('Fecha de inicio', o.auth_fechaInicio ? fmtDate(o.auth_fechaInicio) : null)}
    ${roField('Fecha de vencimiento', o.auth_fechaVence ? fmtDate(o.auth_fechaVence) : null)}
    ${roField('Número de autorización', o.auth_numero ? esc(o.auth_numero) : null)}
    ${roField('Centro médico', centro ? esc(centro.nombre) : null)}
    ${centro && (centro.tel1 || centro.tel2) ? roField('Teléfono', [centro.tel1, centro.tel2].filter(Boolean).map(esc).join(' · ')) : ''}
    ${centro && centro.dir ? roField('Dirección', esc(centro.dir)) : ''}
    ${o.auth_imagen ? `<button type="button" class="btn btn-sm btn-ghost" data-view-file="autorizacion">Ver imagen</button>` : ''}
  </div>` : `<div class="ro-section ro-pending"><div class="ro-section-title">C · Autorización</div><p class="ro-empty-msg">Aún no hay autorización registrada.</p></div>`;

  const seccionD = stageIdx >= 3 ? `<div class="ro-section">
    <div class="ro-section-title">D · Cita ${o._stage === 'Finalizado' ? '<span class="tag tag-green" style="margin-left:6px">Finalizada</span>' : ''}</div>
    ${roField('Fecha', o.cita_fecha ? fmtDate(o.cita_fecha) : null)}
    ${roField('Hora', o.cita_hora ? esc(o.cita_hora) : null)}
    ${roField('Médico', docCita ? esc(docCita.nombre) : null)}
    ${roField('Consultorio', o.cita_consultorio ? esc(o.cita_consultorio) : null)}
    ${roField('Dirección', o.cita_direccion ? esc(o.cita_direccion) : null)}
    ${roField('Indicaciones', o.cita_indicaciones ? esc(o.cita_indicaciones) : null)}
  </div>` : `<div class="ro-section ro-pending"><div class="ro-section-title">D · Cita</div><p class="ro-empty-msg">Aún no hay cita programada.</p></div>`;

  return `<div class="order-readview">${seccionA}${seccionB}${seccionC}${seccionD}</div>`;
}

/** Entrada por defecto al abrir una orden ya existente: solo lectura. La
 * edición es una acción explícita ("Editar"), nunca el estado inicial. */
async function openOrderModal(id) {
  if (!state.activePatient) { showToast('Selecciona un paciente primero', 'err'); return; }

  const [o, doctors, centers] = await Promise.all([
    api.getOrder(id), api.listDoctors(state.household.id), api.listCenters(state.household.id),
  ]);
  const docMap = Object.fromEntries(doctors.map(d => [d.id, d]));
  const centerMap = Object.fromEntries(centers.map(c => [c.id, c]));

  showModal('Orden médica', renderOrderReadView(o, docMap, centerMap), [
    { label: 'Cerrar', cls: 'btn', action: closeModal },
    { label: 'Editar', cls: 'btn btn-primary', action: () => openOrderWizard(id) },
  ]);
  setModalMaxWidth('680px');

  document.querySelectorAll('[data-view-file]').forEach(btn => btn.addEventListener('click', () => {
    const field = FILE_SLOTS[btn.dataset.viewFile];
    files.openAttachment(o[field]).catch(err => showToast(err.message || 'No se pudo abrir el archivo', 'err'));
  }));
}

async function handleFileInput(inputEl, slot) {
  const file = inputEl.files[0];
  if (!file) return;
  if (file.size > files.MAX_FILE_MB * 1024 * 1024) {
    showToast(`Archivo muy grande (máx. ${files.MAX_FILE_MB}MB)`, 'err');
    return;
  }
  let dataUrl = await readFileAsDataURL(file);
  let name = file.name, type = file.type;

  // Sección A ("Historia clínica"): si se sube una foto en vez de un PDF ya
  // existente, se convierte automáticamente a PDF de una página.
  if (slot === 'orden' && type.startsWith('image/')) {
    try {
      dataUrl = await files.imageToPdfDataUrl(dataUrl);
      type = 'application/pdf';
      name = name.replace(/\.[^.]+$/, '') + '.pdf';
    } catch {
      showToast('No se pudo convertir la foto a PDF; se subirá tal cual', 'warn');
    }
  }

  // En memoria hasta guardar la orden: recién ahí se sube a Storage.
  orderFiles[slot] = { name, type, data: dataUrl };
  renderFilePreview(slot);
}

function renderFilePreview(slot) {
  const el = document.getElementById(`fp-${slot}`);
  const f = orderFiles[slot];
  if (!el) return;
  if (!f) { el.innerHTML = ''; return; }
  const isImg = (f.type || '').startsWith('image/');
  el.innerHTML = `<div class="file-preview">
    ${isImg ? `<img id="fp-img-${slot}" ${f.data ? `src="${f.data}"` : ''} style="width:32px;height:32px;object-fit:cover;border-radius:4px"/>` : `<div class="fp-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/></svg></div>`}
    <div class="fp-name" data-open-slot="${slot}" title="Ver archivo">${esc(f.name)}</div>
    <span class="fp-remove" data-remove-slot="${slot}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span>
  </div>`;
  // Miniatura de un adjunto ya en Storage: URL firmada (asíncrona).
  if (isImg && !f.data && files.isStored(f)) {
    files.getSignedUrl(f.path).then(url => {
      const img = document.getElementById(`fp-img-${slot}`);
      if (img) img.src = url;
    }).catch(() => {});
  }
  el.querySelector('[data-open-slot]')?.addEventListener('click', () =>
    files.openAttachment(orderFiles[slot]).catch(err =>
      showToast(err.message || 'No se pudo abrir el archivo', 'err')));
  el.querySelector('[data-remove-slot]')?.addEventListener('click', () => { orderFiles[slot] = null; renderFilePreview(slot); });
}

/** Abre el asistente de edición. `id` ausente = orden nueva (sin
 * restricciones de navegación entre etapas). `prefill` — ver estado
 * "Finalizado" en la sección D, para la orden de seguimiento. */
async function openOrderWizard(id, prefill) {
  orderFiles = { orden: null, solicitud: null, autorizacion: null };
  originalStoredPaths = [];
  currentOrderStageIdx = -1;

  if (!state.activePatient) { showToast('Selecciona un paciente primero', 'err'); return; }

  const doctors = await api.listDoctors(state.household.id);
  const centers = await api.listCenters(state.household.id);
  let o = null;
  if (id) {
    o = await api.getOrder(id);
    if (o.orden_archivo) orderFiles.orden = o.orden_archivo;
    if (o.solicitud_imagen) orderFiles.solicitud = o.solicitud_imagen;
    if (o.auth_imagen) orderFiles.autorizacion = o.auth_imagen;
    originalStoredPaths = files.attachmentPathsOfOrder(o);
    currentOrderStageIdx = STAGE_ORDER.indexOf(o._stage);
  }
  const startTab = o ? TAB_BY_STAGE[o._stage] : 'a';

  const docOptions = doctors.map(d => `<option value="${d.id}" ${o?.medicoId === d.id ? 'selected' : ''}>${esc(d.nombre)}${d.especialidad ? ' — ' + esc(d.especialidad) : ''}</option>`).join('');
  const docOptionsCita = doctors.map(d => `<option value="${d.id}" ${o?.medicoId_cita === d.id ? 'selected' : ''}>${esc(d.nombre)}${d.especialidad ? ' — ' + esc(d.especialidad) : ''}</option>`).join('');
  const centerOptions = centers.map(c => `<option value="${c.id}" ${o?.auth_centroId === c.id ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('');

  const body = `
    <div class="wiz-tabs" id="wiz-tabs">
      <button class="wiz-tab ${startTab === 'a' ? 'active' : ''}" data-t="a" type="button"><span class="wiz-dot"></span>A · Orden</button>
      <button class="wiz-tab ${startTab === 'b' ? 'active' : ''}" data-t="b" type="button"><span class="wiz-dot"></span>B · Solicitud</button>
      <button class="wiz-tab ${startTab === 'c' ? 'active' : ''}" data-t="c" type="button"><span class="wiz-dot"></span>C · Autorización</button>
      <button class="wiz-tab ${startTab === 'd' ? 'active' : ''}" data-t="d" type="button"><span class="wiz-dot"></span>D · Cita</button>
    </div>
    <div class="wiz-pane ${startTab === 'a' ? 'visible' : ''}" id="pane-a">
      <div class="form-row cols-2">
        <div class="form-field">
          <label class="fl">Médico tratante</label>
          <div style="display:flex;gap:6px">
            <select class="fi" id="of-medico" style="flex:1"><option value="">Seleccionar médico…</option>${docOptions}</select>
            <button type="button" class="btn btn-sm btn-icon" id="of-medico-add-btn" title="Agregar médico al directorio">+</button>
          </div>
          <div id="of-medico-newform" class="hidden"></div>
        </div>
        <div class="form-field"><label class="fl">Fecha de la orden</label><input class="fi" id="of-fecha" type="date"/></div>
        <div class="form-field span2"><label class="fl">Tipo de orden</label><select class="fi" id="of-tipo"><option value="">Seleccionar…</option>${ORDER_TYPES.map(t => `<option ${o?.tipoOrden === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="form-field span2"><label class="fl">Descripción</label><textarea class="fi" id="of-desc" rows="2" placeholder="Descripción de la orden…">${esc(o?.descripcion || '')}</textarea></div>
        <div class="form-field span2"><label class="fl">Historia clínica</label>
          <div class="file-drop" id="drop-orden">Haz clic para subir la historia clínica (PDF o foto — se convierte a PDF automáticamente)</div>
          <input type="file" id="of-file" accept=".pdf,image/*" style="display:none"/>
          <div id="fp-orden"></div>
        </div>
      </div>
    </div>
    <div class="wiz-pane ${startTab === 'b' ? 'visible' : ''}" id="pane-b">
      <div class="info-box" style="margin-bottom:16px">Registra aquí cuando envíes la orden a la aseguradora para solicitar autorización.</div>
      <div class="form-row cols-2">
        <div class="form-field"><label class="fl">Fecha de solicitud</label><input class="fi" id="of-sol-fecha" type="date"/></div>
        <div class="form-field"><label class="fl">Hora</label><input class="fi" id="of-sol-hora" type="time"/></div>
        <div class="form-field span2"><label class="fl">Número de solicitud</label><input class="fi" id="of-sol-num" type="text" placeholder="SOL-2025-XXXXX" style="font-family:'JetBrains Mono',monospace"/></div>
        <div class="form-field span2"><label class="fl">Imagen o captura de pantalla</label>
          <div class="file-drop" id="drop-solicitud">Haz clic para subir imagen</div>
          <input type="file" id="of-sol-file" accept="image/*" style="display:none"/>
          <div id="fp-solicitud"></div>
        </div>
      </div>
    </div>
    <div class="wiz-pane ${startTab === 'c' ? 'visible' : ''}" id="pane-c">
      <div class="form-row cols-2">
        <div class="form-field"><label class="fl">Fecha de inicio</label><input class="fi" id="of-auth-inicio" type="date"/></div>
        <div class="form-field"><label class="fl">Fecha de vencimiento</label><input class="fi" id="of-auth-vence" type="date"/></div>
        <div class="form-field span2"><label class="fl">Número de autorización</label><input class="fi" id="of-auth-num" type="text" placeholder="AUT-2025-XXXXX" style="font-family:'JetBrains Mono',monospace"/></div>
        <div class="form-field span2">
          <label class="fl">Centro médico</label>
          <div style="display:flex;gap:6px">
            <select class="fi" id="of-auth-centro" style="flex:1"><option value="">Seleccionar centro…</option>${centerOptions}</select>
            <button type="button" class="btn btn-sm btn-icon" id="of-centro-add-btn" title="Agregar centro médico al directorio">+</button>
          </div>
          <div id="of-centro-newform" class="hidden"></div>
        </div>
        <div class="form-field span2"><label class="fl">Imagen de la autorización</label>
          <div class="file-drop" id="drop-autorizacion">Haz clic para subir imagen</div>
          <input type="file" id="of-auth-file" accept="image/*" style="display:none"/>
          <div id="fp-autorizacion"></div>
        </div>
      </div>
    </div>
    <div class="wiz-pane ${startTab === 'd' ? 'visible' : ''}" id="pane-d">
      <div class="form-row cols-2">
        <div class="form-field"><label class="fl">Fecha de la cita</label><input class="fi" id="of-cita-fecha" type="date"/></div>
        <div class="form-field"><label class="fl">Hora</label><input class="fi" id="of-cita-hora" type="time"/></div>
        <div class="form-field">
          <label class="fl">Médico</label>
          <div style="display:flex;gap:6px">
            <select class="fi" id="of-cita-medico" style="flex:1"><option value="">Seleccionar médico…</option>${docOptionsCita}</select>
            <button type="button" class="btn btn-sm btn-icon" id="of-cita-medico-add-btn" title="Agregar médico al directorio">+</button>
          </div>
          <div id="of-cita-medico-newform" class="hidden"></div>
        </div>
        <div class="form-field"><label class="fl">Consultorio</label><input class="fi" id="of-cita-consul" type="text" placeholder="Piso, número…"/></div>
        <div class="form-field span2"><label class="fl">Dirección (opcional, si es distinta)</label><input class="fi" id="of-cita-dir" type="text" placeholder="Dirección de la cita"/></div>
        <div class="form-field span2"><label class="fl">Indicaciones para asistir</label><textarea class="fi" id="of-cita-ind" rows="2" placeholder="Ayuno, documentos a llevar, llegar con anticipación…"></textarea></div>
        <div class="form-field span2"><label class="fl">Estado del proceso</label>
          <select class="fi" id="of-estado"><option value="">En curso</option><option value="Finalizado">Finalizado (cita ya asistida)</option></select>
        </div>
        <div class="form-field span2 hidden" id="of-followup-field">
          <label class="cb-row"><input type="checkbox" id="of-followup"/> Crear una nueva orden de seguimiento al guardar</label>
        </div>
      </div>
    </div>
  `;

  showModal(id ? 'Editar orden médica' : 'Nueva orden médica', body, [
    { label: 'Cancelar', cls: 'btn', action: closeModal },
    { label: id ? 'Guardar cambios' : 'Crear orden', cls: 'btn btn-primary', action: () => saveOrderForm(id) },
  ]);
  setModalMaxWidth('680px');

  document.querySelectorAll('.wiz-tab').forEach(t => t.addEventListener('click', () => switchWizTab(t.dataset.t)));
  document.getElementById('drop-orden').addEventListener('click', () => document.getElementById('of-file').click());
  document.getElementById('of-file').addEventListener('change', function () { handleFileInput(this, 'orden'); });
  document.getElementById('drop-solicitud').addEventListener('click', () => document.getElementById('of-sol-file').click());
  document.getElementById('of-sol-file').addEventListener('change', function () { handleFileInput(this, 'solicitud'); });
  document.getElementById('drop-autorizacion').addEventListener('click', () => document.getElementById('of-auth-file').click());
  document.getElementById('of-auth-file').addEventListener('change', function () { handleFileInput(this, 'autorizacion'); });

  wireInlineNewDoctor({ primarySelectId: 'of-medico', otherSelectIds: ['of-cita-medico'], addBtnId: 'of-medico-add-btn', formContainerId: 'of-medico-newform', specialties: SPECIALTIES });
  wireInlineNewDoctor({ primarySelectId: 'of-cita-medico', otherSelectIds: ['of-medico'], addBtnId: 'of-cita-medico-add-btn', formContainerId: 'of-cita-medico-newform', specialties: SPECIALTIES });
  wireInlineNewCenter('of-auth-centro', 'of-centro-add-btn', 'of-centro-newform');

  document.getElementById('of-estado').addEventListener('change', (e) => {
    document.getElementById('of-followup-field').classList.toggle('hidden', e.target.value !== 'Finalizado');
  });

  if (o) {
    document.getElementById('of-fecha').value = o.fechaOrden || '';
    document.getElementById('of-sol-fecha').value = o.solicitud_fecha || '';
    document.getElementById('of-sol-hora').value = o.solicitud_hora || '';
    document.getElementById('of-sol-num').value = o.solicitud_numero || '';
    document.getElementById('of-auth-inicio').value = o.auth_fechaInicio || '';
    document.getElementById('of-auth-vence').value = o.auth_fechaVence || '';
    document.getElementById('of-auth-num').value = o.auth_numero || '';
    document.getElementById('of-auth-centro').value = o.auth_centroId || '';
    document.getElementById('of-cita-fecha').value = o.cita_fecha || '';
    document.getElementById('of-cita-hora').value = o.cita_hora || '';
    document.getElementById('of-cita-medico').value = o.medicoId_cita || '';
    document.getElementById('of-cita-consul').value = o.cita_consultorio || '';
    document.getElementById('of-cita-dir').value = o.cita_direccion || '';
    document.getElementById('of-cita-ind').value = o.cita_indicaciones || '';
    document.getElementById('of-estado').value = o.estadoCita || '';
    // Set programático: no dispara 'change', así que el toggle de
    // #of-followup-field se replica acá a mano (ver listener más arriba).
    document.getElementById('of-followup-field').classList.toggle('hidden', o.estadoCita !== 'Finalizado');
    document.getElementById('of-medico').value = o.medicoId || '';
  } else {
    document.getElementById('of-fecha').value = today();
    if (prefill?.medicoId) document.getElementById('of-medico').value = prefill.medicoId;
    if (prefill?.tipoOrden) document.getElementById('of-tipo').value = prefill.tipoOrden;
  }
  renderFilePreview('orden'); renderFilePreview('solicitud'); renderFilePreview('autorizacion');
}

/** Las etapas se navegan como páginas. Editar una etapa anterior a la ya
 * alcanzada por la orden requiere confirmación explícita (P1.5) — no aplica
 * a una orden nueva (currentOrderStageIdx === -1: nada ha avanzado todavía). */
function switchWizTab(t) {
  const targetIdx = TAB_STAGE_IDX[t];
  if (currentOrderStageIdx >= 0 && targetIdx < currentOrderStageIdx) {
    const etapaActual = STAGE_LABELS[STAGE_ORDER[currentOrderStageIdx]];
    const etapaDestino = STAGE_LABELS[STAGE_ORDER[targetIdx]];
    const ok = confirm(
      `Esta orden ya avanzó hasta la etapa "${etapaActual}". Estás por editar "${etapaDestino}", una etapa anterior — ` +
      'los cambios aquí no se aplican solos a las etapas posteriores ya registradas y podrían generar inconsistencias ' +
      '(por ejemplo, cambiar la fecha de la orden después de ya tener una cita agendada). ¿Deseas continuar?'
    );
    if (!ok) return;
  }
  document.querySelectorAll('.wiz-tab').forEach(el => el.classList.toggle('active', el.dataset.t === t));
  document.querySelectorAll('.wiz-pane').forEach(el => el.classList.remove('visible'));
  document.getElementById(`pane-${t}`).classList.add('visible');
}

// Slot del wizard → campo jsonb de la orden
const FILE_SLOTS = { orden: 'orden_archivo', solicitud: 'solicitud_imagen', autorizacion: 'auth_imagen' };

/**
 * Sube a Storage los adjuntos recién elegidos (los que aún tienen `data`
 * en memoria) y deja en `obj` el formato persistible {name,type,size,path}.
 */
async function uploadNewAttachments(obj, orderId) {
  for (const [slot, field] of Object.entries(FILE_SLOTS)) {
    const f = orderFiles[slot];
    if (f && f.data && !files.isStored(f)) {
      obj[field] = await files.uploadAttachment(state.household.id, orderId, slot, f);
    }
  }
}

async function saveOrderForm(editId) {
  if (!state.activePatient) { showToast('Selecciona un paciente primero', 'err'); return; }

  const obj = {
    id: editId || undefined,
    medicoId: document.getElementById('of-medico').value,
    fechaOrden: document.getElementById('of-fecha').value,
    tipoOrden: document.getElementById('of-tipo').value,
    descripcion: document.getElementById('of-desc').value.trim(),
    orden_archivo: orderFiles.orden,
    solicitud_fecha: document.getElementById('of-sol-fecha').value,
    solicitud_hora: document.getElementById('of-sol-hora').value,
    solicitud_numero: document.getElementById('of-sol-num').value.trim(),
    solicitud_imagen: orderFiles.solicitud,
    auth_fechaInicio: document.getElementById('of-auth-inicio').value,
    auth_fechaVence: document.getElementById('of-auth-vence').value,
    auth_numero: document.getElementById('of-auth-num').value.trim(),
    auth_centroId: document.getElementById('of-auth-centro').value,
    auth_imagen: orderFiles.autorizacion,
    cita_fecha: document.getElementById('of-cita-fecha').value,
    cita_hora: document.getElementById('of-cita-hora').value,
    medicoId_cita: document.getElementById('of-cita-medico').value,
    cita_consultorio: document.getElementById('of-cita-consul').value.trim(),
    cita_direccion: document.getElementById('of-cita-dir').value.trim(),
    cita_indicaciones: document.getElementById('of-cita-ind').value.trim(),
    estadoCita: document.getElementById('of-estado').value,
  };
  const wantsFollowUp = obj.estadoCita === 'Finalizado' && !!document.getElementById('of-followup')?.checked;

  if (!obj.fechaOrden) { showToast('La fecha de la orden es obligatoria', 'err'); switchWizTab('a'); return; }
  if (!obj.tipoOrden) { showToast('Selecciona el tipo de orden', 'err'); switchWizTab('a'); return; }

  try {
    let saved;
    if (editId) {
      await uploadNewAttachments(obj, editId);
      saved = await api.saveOrder(obj, state.household.id, state.activePatient.id);
    } else {
      // Orden nueva: se necesita su id para la ruta en Storage. Se crea
      // primero (con los adjuntos aún fuera), se suben, y se actualiza.
      const hasNewFiles = Object.values(orderFiles).some(f => f && f.data && !files.isStored(f));
      if (hasNewFiles) {
        const draft = { ...obj, orden_archivo: null, solicitud_imagen: null, auth_imagen: null };
        saved = await api.saveOrder(draft, state.household.id, state.activePatient.id);
        obj.id = saved.id;
        await uploadNewAttachments(obj, saved.id);
        saved = await api.saveOrder(obj, state.household.id, state.activePatient.id);
      } else {
        saved = await api.saveOrder(obj, state.household.id, state.activePatient.id);
      }
    }

    // Limpiar del Storage los adjuntos que quedaron fuera (reemplazados o
    // quitados en esta edición). Mejor esfuerzo, después de guardar.
    const keptPaths = files.attachmentPathsOfOrder(saved);
    files.removeAttachments(originalStoredPaths.filter(p => !keptPaths.includes(p)));

    closeModal();
    showToast(editId ? 'Orden actualizada' : 'Orden creada correctamente');
    render();
    if (state.currentView === 'dashboard') {
      const { render: renderDashboard } = await import('./dashboard.js');
      renderDashboard();
    }
    if (wantsFollowUp) {
      openOrderWizard(undefined, { medicoId: obj.medicoId, tipoOrden: 'Cita de control' });
    }
  } catch (err) {
    showToast(err.message || 'Error al guardar la orden', 'err');
  }
}
