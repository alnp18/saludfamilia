import { state } from '../state.js';
import * as api from '../lib/api.js';
import * as files from '../lib/files.js';
import { openAttachmentViewer } from '../lib/viewer.js';
import { createAttachmentField } from '../lib/attachmentField.js';
import { showModal, closeModal, showToast, setModalMaxWidth } from '../lib/modal.js';
import { openViewOverlay, closeViewOverlay } from '../lib/viewModeOverlay.js';
import { esc, fmtDate, daysFrom } from '../lib/utils.js';
import { SPECIALTIES } from './doctors.js';
import { wireInlineNewCenter, wireInlineNewDoctor } from '../lib/inlineDirectory.js';
import { INTERVALOS, permisoNotificaciones, activarRecordatorio, desactivarRecordatorio, ETAPAS_RESUELTAS as ETAPAS_SIN_RECORDATORIO } from '../lib/reminders.js';
import { emptyStateHtml, errorStateHtml } from '../lib/emptyState.js';
import { Icons } from '../lib/icons.js';
import { dateRangeFieldHtml, wireDateRangeField, fillDateRangeField, readDateRangeField } from '../lib/dateRange.js';
import { callLinkHtml } from '../lib/phone.js';

const ORDER_TYPES = ['Cita de control', 'Nueva especialidad', 'Medicamentos/Insumos/Terapias', 'Examen', 'Laboratorio', 'Otro'];
const STAGE_ORDER = ['A', 'B', 'C', 'D', 'Finalizado'];
const STAGE_LABELS = { A: 'Orden', B: 'Solicitud', C: 'Autorización', D: 'Cita', Finalizado: 'Finalizado' };
// MI AUDITORIA Órdenes #4: este tipo de orden reemplaza la etapa C
// ("Autorización", un solo registro) por "Autorizaciones" (una fila por
// mes autorizado) y nunca pasa por la etapa D ("Cita") — se bloquea.
const AUTH_TABLE_TYPE = 'Medicamentos/Insumos/Terapias';
const isAuthTableType = (tipoOrden) => tipoOrden === AUTH_TABLE_TYPE;
const STAGE_LABELS_AUTH = { A: 'Orden', B: 'Solicitud', C: 'Autorizaciones' };
// Índice comparable de cada pestaña del asistente dentro de STAGE_ORDER —
// usado para la alerta de "vas a editar una etapa anterior" (ver switchWizTab).
const TAB_STAGE_IDX = { a: 0, b: 1, c: 2, d: 3 };
const TAB_BY_STAGE = { A: 'a', B: 'b', C: 'c', D: 'd', Finalizado: 'd' };

let activeFilter = 'all'; // etapa
let activeSpecialty = 'all'; // especialidad del médico tratante
let activeDoctor = 'all'; // médico tratante (MI AUDITORIA Órdenes #2)
let activeTipo = 'all'; // tipo de orden (MI AUDITORIA Órdenes #2)
let dateFrom = ''; // fecha de la orden, rango "desde" (MI AUDITORIA Órdenes #2)
let dateTo = ''; // fecha de la orden, rango "hasta"
// MI AUDITORIA Órdenes #5: pestaña "Flujo" — línea de tiempo minimalista
// que agrupa en un solo bloque las órdenes del mismo día + mismo médico
// (mismo médico implica misma especialidad). 'lista' es la vista clásica
// de tarjetas con filtros; 'flujo' es la nueva línea de tiempo.
let ordersViewMode = 'lista';
let expandedFlowGroups = new Set(); // claves de grupo abiertas (persiste entre renders)
// Campos de adjunto de esta orden. La historia clínica ya no está acá: subió a
// la consulta (migración 0035). Cada campo guarda su propio estado — ver
// src/lib/attachmentField.js, que es adonde se mudó toda la lógica de cámara,
// recorte y armado del PDF que antes vivía suelta en este módulo.
let campos = { documento: null, solicitud: null, autorizacion: null };
// Consulta de la orden que se está editando. Se guarda acá porque saveOrder
// reescribe la fila completa y visit_id es not null: hay que devolvérselo.
let currentVisitId = null;
let originalStoredPaths = []; // adjuntos en Storage al abrir el wizard (para limpiar reemplazados)
let pendingOptions = null; // { openWizard, openOrderId } pasado desde goView
// -1 = orden nueva (sin restricción de navegación); si no, índice de la
// etapa ya alcanzada por la orden que se está editando (ver switchWizTab).
let currentOrderStageIdx = -1;
// Filas de la tabla "Autorizaciones" (MI AUDITORIA Órdenes #4) en memoria
// mientras se edita el asistente: [{ mesNumero, numeroAutorizacion,
// fechaInicio, fechaVencimiento, cantidad, entregado }]. Se guardan todas
// juntas al enviar el formulario (ver replaceOrderAuthorizations).
let authRows = [];
// Meses que YA estaban marcados como "entregado" al abrir el asistente.
// Sirve para detectar, al guardar, si en ESTA edición se marcó una nueva
// entrega — y ahí ofrecer crear un medicamento (auditoría 2026-07-17).
let authOriginalEntregado = new Set();

export function setPendingOptions(opts) { pendingOptions = opts; }

/** Registrar empieza por la consulta, no por la orden (migración 0035). */
async function nuevaConsulta(visitId) {
  const { openConsultaWizard } = await import('./consultas.js');
  openConsultaWizard(visitId, { onSaved: () => render() });
}

export async function render() {
  const container = document.getElementById('view-orders');
  if (!container) return;

  container.innerHTML = `
    <div class="view-header">
      <div>
        <div class="view-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/><path d="M9 14l2 2 4-4"/></svg> Órdenes médicas</div>
        <div class="view-sub" id="orders-sub">Consulta → Orden → Solicitud → Autorización → Cita</div>
      </div>
      <button class="btn btn-primary" id="btn-new-order"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Nueva consulta</button>
    </div>
    <div class="filter-pills" id="orders-view-tabs" style="margin-bottom:12px">
      <div class="filter-pill ${ordersViewMode === 'lista' ? 'active' : ''}" data-view-mode="lista">Lista</div>
      <div class="filter-pill ${ordersViewMode === 'flujo' ? 'active' : ''}" data-view-mode="flujo">Flujo</div>
    </div>
    <div class="orders-filters-row" id="orders-filters-row">
      <div class="filter-pills" id="orders-filters"></div>
      <select class="fi" id="orders-filter-especialidad" style="max-width:190px"></select>
      <select class="fi" id="orders-filter-medico" style="max-width:190px"></select>
      <select class="fi" id="orders-filter-tipo" style="max-width:170px"></select>
      <div class="orders-filter-dates" id="orders-filter-dates">
        <input class="fi" id="orders-filter-desde" type="date" title="Desde"/>
        <span>–</span>
        <input class="fi" id="orders-filter-hasta" type="date" title="Hasta"/>
        <button type="button" class="btn btn-sm btn-icon" id="orders-filter-dates-clear" title="Limpiar fechas">✕</button>
      </div>
    </div>
    <div id="orders-list" style="display:flex;flex-direction:column;gap:12px"></div>
    <div id="orders-flow"></div>
  `;
  document.getElementById('btn-new-order').addEventListener('click', () => nuevaConsulta());
  document.getElementById('orders-view-tabs').querySelectorAll('[data-view-mode]').forEach(el =>
    el.addEventListener('click', () => { ordersViewMode = el.dataset.viewMode; render(); }));

  const sub = document.getElementById('orders-sub');
  const list = document.getElementById('orders-list');
  const flow = document.getElementById('orders-flow');
  const filtersRow = document.getElementById('orders-filters-row');
  const filtersEl = document.getElementById('orders-filters');
  const espSelect = document.getElementById('orders-filter-especialidad');
  const docSelect = document.getElementById('orders-filter-medico');
  const tipoSelect = document.getElementById('orders-filter-tipo');
  const desdeInput = document.getElementById('orders-filter-desde');
  const hastaInput = document.getElementById('orders-filter-hasta');

  if (!state.activePatient) {
    sub.textContent = 'Selecciona un paciente para ver sus órdenes';
    filtersEl.innerHTML = '';
    espSelect.innerHTML = '';
    docSelect.innerHTML = '';
    tipoSelect.innerHTML = '';
    list.innerHTML = emptyStateHtml({ icon: Icons.users, title: 'Selecciona un paciente' });
    flow.innerHTML = '';
    document.getElementById('sb-badge-orders').style.display = 'none';
    return;
  }
  sub.textContent = `Órdenes de ${state.activePatient.nombre}`;

  // La pestaña Flujo tiene su propia vista agrupada (MI AUDITORIA Órdenes
  // #5) y no usa los filtros de etapa/especialidad/médico/tipo de la Lista.
  filtersRow.style.display = ordersViewMode === 'flujo' ? 'none' : '';
  list.style.display = ordersViewMode === 'flujo' ? 'none' : '';
  flow.style.display = ordersViewMode === 'flujo' ? '' : 'none';

  let orders, doctors;
  try {
    [orders, doctors] = await Promise.all([
      api.listOrdersByPatient(state.activePatient.id),
      api.listDoctors(state.household.id),
    ]);
  } catch (err) {
    showToast(err.message || 'No se pudieron cargar las órdenes', 'err');
    const errHtml = errorStateHtml({ retryId: 'btn-retry-orders' });
    if (ordersViewMode === 'flujo') flow.innerHTML = errHtml; else list.innerHTML = errHtml;
    document.getElementById('btn-retry-orders').addEventListener('click', () => render());
    return;
  }
  const docMap = Object.fromEntries(doctors.map(d => [d.id, d]));

  const pendingCount = orders.filter(o => o._stage === 'A' || o._stage === 'B').length;
  const badge = document.getElementById('sb-badge-orders');
  if (pendingCount) { badge.style.display = 'flex'; badge.textContent = pendingCount; } else { badge.style.display = 'none'; }

  if (ordersViewMode === 'flujo') {
    renderFlowView(orders, docMap, flow);
    if (pendingOptions?.openWizard) { pendingOptions = null; nuevaConsulta(); }
    else if (pendingOptions?.openOrderId) { const id = pendingOptions.openOrderId; pendingOptions = null; openOrderModal(id); }
    return;
  }

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

  // MI AUDITORIA Órdenes #2: especialidad/médico/tipo son "extensibles" a
  // la etapa activa — solo se listan las opciones presentes entre las
  // órdenes de la etapa actualmente seleccionada (no todo el histórico ni
  // todo el directorio), así el filtro no muestra opciones vacías.
  const stageScoped = orders.filter(o => activeFilter === 'all' || o._stage === activeFilter);

  const specialtiesPresent = [...new Set(stageScoped.map(o => docMap[o.medicoId]?.especialidad).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  if (!specialtiesPresent.includes(activeSpecialty)) activeSpecialty = 'all';
  espSelect.innerHTML = `<option value="all">Todas las especialidades</option>${specialtiesPresent.map(s => `<option value="${esc(s)}" ${activeSpecialty === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}`;
  espSelect.style.display = specialtiesPresent.length ? '' : 'none';
  espSelect.onchange = () => { activeSpecialty = espSelect.value; render(); };

  const doctorsPresent = [...new Map(stageScoped.map(o => [o.medicoId, docMap[o.medicoId]]).filter(([mid, d]) => mid && d)).values()]
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
  if (!doctorsPresent.some(d => d.id === activeDoctor)) activeDoctor = 'all';
  docSelect.innerHTML = `<option value="all">Todos los médicos</option>${doctorsPresent.map(d => `<option value="${d.id}" ${activeDoctor === d.id ? 'selected' : ''}>${esc(d.nombre)}</option>`).join('')}`;
  docSelect.style.display = doctorsPresent.length ? '' : 'none';
  docSelect.onchange = () => { activeDoctor = docSelect.value; render(); };

  const tiposPresent = [...new Set(stageScoped.map(o => o.tipoOrden).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  if (!tiposPresent.includes(activeTipo)) activeTipo = 'all';
  tipoSelect.innerHTML = `<option value="all">Todos los tipos</option>${tiposPresent.map(t => `<option value="${esc(t)}" ${activeTipo === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}`;
  tipoSelect.style.display = tiposPresent.length ? '' : 'none';
  tipoSelect.onchange = () => { activeTipo = tipoSelect.value; render(); };

  desdeInput.value = dateFrom;
  hastaInput.value = dateTo;
  desdeInput.onchange = () => { dateFrom = desdeInput.value; render(); };
  hastaInput.onchange = () => { dateTo = hastaInput.value; render(); };
  document.getElementById('orders-filter-dates-clear').onclick = () => { dateFrom = ''; dateTo = ''; render(); };

  let filtered = stageScoped.filter(o =>
    (activeSpecialty === 'all' || docMap[o.medicoId]?.especialidad === activeSpecialty) &&
    (activeDoctor === 'all' || o.medicoId === activeDoctor) &&
    (activeTipo === 'all' || o.tipoOrden === activeTipo) &&
    (!dateFrom || (o.fechaOrden && o.fechaOrden >= dateFrom)) &&
    (!dateTo || (o.fechaOrden && o.fechaOrden <= dateTo))
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
    list.innerHTML = emptyStateHtml({
      icon: Icons.clipboard,
      title: orders.length ? 'Sin resultados para este filtro' : 'Sin órdenes registradas',
      message: orders.length ? 'Prueba con otro filtro de etapa o especialidad.' : 'Registra la primera orden médica de ' + esc(state.activePatient.nombre) + '.',
      action: orders.length ? null : { id: 'btn-new-order-empty', label: 'Nueva orden' },
    });
    document.getElementById('btn-new-order-empty')?.addEventListener('click', () => nuevaConsulta());
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
  if (pendingOptions?.openWizard) { pendingOptions = null; nuevaConsulta(); }
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

  // MI AUDITORIA Órdenes #4: "Medicamentos/Insumos/Terapias" no pasa por
  // Cita — su stepper muestra solo 3 etapas (Orden/Solicitud/Autorizaciones)
  // en vez de 4.
  const authType = isAuthTableType(o.tipoOrden);
  const stageLabels = authType ? STAGE_LABELS_AUTH : STAGE_LABELS;
  const stepCount = authType ? 3 : 4;
  const steps = STAGE_ORDER.slice(0, stepCount).map((s, i) => {
    const cls = i < stageIdx || o._stage === 'Finalizado' ? 'done' : (i === stageIdx ? 'current' : '');
    return `<div class="step ${cls}"><div class="step-line"></div><div class="step-dot">${cls === 'done' ? '✓' : (i + 1)}</div><div class="step-label">${stageLabels[s]}</div></div>`;
  }).join('');

  return `<div class="order-card" data-view-order="${o.id}" style="cursor:pointer">
    <div class="order-card-top">
      <div class="order-type-ic"><svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="var(--t-primary-lt)" stroke-width="1.7"><path stroke-linecap="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z"/></svg></div>
      <div style="flex:1;min-width:0">
        <div class="order-title">${esc(o.tipoOrden || 'Orden médica')}${doc ? ' · ' + esc(doc.nombre) : ''}</div>
        <div class="order-sub">${esc(o.descripcion || 'Sin descripción')} · Generada ${fmtDate(o.fechaOrden)}</div>
      </div>
      <div class="order-card-actions">
        ${o._stage === 'A' ? `<button class="btn btn-sm btn-icon btn-danger" data-delete-order="${o.id}" title="Eliminar"><svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862"/></svg></button>` : ''}
      </div>
    </div>
    <div class="order-card-body">
      <div class="stepper">${steps}</div>
      ${tags.length ? `<div class="order-tags">${tags.join('')}</div>` : ''}
    </div>
  </div>`;
}

// ─────────────────────────────────────────
// Pestaña "Flujo" (MI AUDITORIA Órdenes #5) — línea de tiempo minimalista.
// Un bloque por CONSULTA: en colapsado, especialidad + fecha; al hacer click,
// el médico y todo lo que se ordenó ese día.
//
// Hasta la migración 0035 el agrupamiento se calculaba acá, por fecha + médico:
// era una aproximación, y fundía en un solo bloque dos consultas del mismo
// médico el mismo día. Ahora la consulta existe en la base y el agrupamiento es
// exacto — de hecho fue esta pantalla la que mostró que la consulta hacía falta.
// ─────────────────────────────────────────
function flowGroupKey(o) { return o.visitId || `sin-consulta-${o.id}`; }

function renderFlowView(orders, docMap, container) {
  if (!orders.length) {
    container.innerHTML = emptyStateHtml({
      icon: Icons.clipboard,
      title: 'Sin órdenes registradas',
      message: `Registra la primera orden médica de ${esc(state.activePatient.nombre)}.`,
      action: { id: 'btn-new-order-empty-flow', label: 'Nueva consulta' },
    });
    document.getElementById('btn-new-order-empty-flow')?.addEventListener('click', () => nuevaConsulta());
    return;
  }

  const groups = new Map();
  orders.forEach(o => {
    const key = flowGroupKey(o);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  });
  const groupList = [...groups.entries()]
    .map(([key, items]) => ({ key, items, fecha: items[0].fechaOrden || '' }))
    .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));

  container.innerHTML = `<div class="flow-timeline">${groupList.map(g => {
    const doc = docMap[g.items[0].medicoId];
    const especialidad = doc?.especialidad || 'Sin especialidad';
    const expanded = expandedFlowGroups.has(g.key);
    return `<div class="flow-group ${expanded ? 'expanded' : ''}">
      <div class="flow-dot"></div>
      <div class="flow-body">
        <div class="flow-head" data-flow-toggle="${g.key}">
          <div class="flow-head-main">
            <span class="flow-esp">${esc(especialidad)}</span>
            <span class="flow-date">${fmtDate(g.fecha)}</span>
          </div>
          <div class="flow-head-side">
            <span class="flow-count">${g.items.length} ${g.items.length === 1 ? 'orden' : 'órdenes'}</span>
            <svg class="flow-chevron" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 9l6 6 6-6"/></svg>
          </div>
        </div>
        <div class="flow-detail">
          <div class="flow-detail-doc">${doc ? esc(doc.nombre) : 'Médico no asignado'}</div>
          <div class="flow-detail-items">${g.items.map(o => `<div class="flow-detail-item" data-flow-view-order="${o.id}">
            <span class="flow-item-tipo">${esc(o.tipoOrden || 'Orden médica')}</span>
            <span class="flow-item-desc">${esc(o.descripcion || 'Sin descripción')}</span>
            <span class="tag ${o._stage === 'Finalizado' ? 'tag-green' : 'tag-amber'}">${esc((isAuthTableType(o.tipoOrden) ? STAGE_LABELS_AUTH : STAGE_LABELS)[o._stage] || o._stage)}</span>
          </div>`).join('')}</div>
        </div>
      </div>
    </div>`;
  }).join('')}</div>`;

  container.querySelectorAll('[data-flow-toggle]').forEach(el => el.addEventListener('click', () => {
    const key = el.dataset.flowToggle;
    if (expandedFlowGroups.has(key)) expandedFlowGroups.delete(key); else expandedFlowGroups.add(key);
    renderFlowView(orders, docMap, container);
  }));
  container.querySelectorAll('[data-flow-view-order]').forEach(el => el.addEventListener('click', (e) => {
    e.stopPropagation();
    openOrderModal(el.dataset.flowViewOrder);
  }));
}

/** MI AUDITORIA (Órdenes #1): una orden solo puede eliminarse mientras
 * sigue en la etapa A (recién creada, nada tramitado todavía). Se
 * revalida contra el servidor (no solo el botón visible en la tarjeta)
 * para cubrir el caso de otra pestaña/dispositivo que ya la haya hecho
 * avanzar de etapa. */
async function deleteOrderConfirm(id) {
  let o;
  try { o = await api.getOrder(id); } catch { showToast('No se pudo verificar la orden', 'err'); return; }
  if (o._stage !== 'A') {
    showToast('Esta orden ya avanzó de etapa: solo puede editarse, no eliminarse', 'err');
    render();
    return;
  }
  if (!confirm('¿Eliminar esta orden médica? Se perderá todo su seguimiento.')) return;
  try {
    const paths = files.attachmentPathsOfOrder(o);
    await api.deleteOrder(id);
    files.removeAttachments(paths);
    showToast('Orden eliminada', 'warn');
    render();
  } catch (err) {
    showToast(err.message || 'Error al eliminar la orden', 'err');
  }
}

// ─────────────────────────────────────────
// Vista de solo lectura (por defecto al abrir una orden existente — P1.5)
// ─────────────────────────────────────────
function roField(label, valueHtml) {
  return `<div class="ro-field"><div class="ro-label">${label}</div><div class="ro-value">${valueHtml ?? '<span class="ro-empty">—</span>'}</div></div>`;
}

/** Sección "pendiente" (etapa aún sin datos). `stageLetter` es la etapa que
 * representa esta sección (B/C/D); si coincide con la PRÓXIMA etapa a
 * tramitar (la inmediatamente después de la ya alcanzada), se agrega un
 * botón "Actualizar" — MI AUDITORIA Órdenes #3c — para abrir el asistente
 * directamente en esa pestaña. Las etapas más allá de la próxima quedan
 * sin botón: no tiene sentido saltarlas antes de completar la anterior. */
function pendingSectionHtml(stageLetter, title, message, nextStage) {
  const showUpdateBtn = stageLetter === nextStage;
  return `<div class="ro-section ro-pending">
    <div class="ro-section-title">${title}</div>
    <p class="ro-empty-msg">${message}</p>
    ${showUpdateBtn ? `<button type="button" class="btn btn-sm btn-primary" data-pv-update-stage="${TAB_BY_STAGE[stageLetter]}">Actualizar</button>` : ''}
  </div>`;
}

/** Tabla de solo lectura de las filas de "Autorizaciones" (una por mes). */
function authTableReadHtml(authList) {
  if (!authList.length) return '<p class="ro-empty-msg">Sin meses registrados.</p>';
  return `<table class="auth-table auth-table-ro">
    <thead><tr><th>Mes</th><th>N° autorización</th><th>Inicio</th><th>Vence</th><th>Cantidad</th><th>Entregado</th></tr></thead>
    <tbody>${authList.map(r => `<tr>
      <td>${r.mesNumero}</td>
      <td>${r.numeroAutorizacion ? esc(r.numeroAutorizacion) : '—'}</td>
      <td>${r.fechaInicio ? fmtDate(r.fechaInicio) : '—'}</td>
      <td>${r.fechaVencimiento ? fmtDate(r.fechaVencimiento) : '—'}</td>
      <td>${r.cantidad ? esc(r.cantidad) : '—'}</td>
      <td style="text-align:center">${r.entregado ? '✓' : '—'}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

function renderOrderReadView(o, docMap, centerMap, authList) {
  const doc = docMap[o.medicoId];
  const docCita = docMap[o.medicoId_cita];
  const centro = centerMap[o.auth_centroId];
  const stageIdx = STAGE_ORDER.indexOf(o._stage);
  const authType = isAuthTableType(o.tipoOrden);
  // Próxima etapa a tramitar: la que sigue a la ya alcanzada. Si ya se
  // llegó a "Cita" (o a Finalizado), no hay una próxima pestaña del
  // asistente a la que saltar — se marca Finalizado desde la propia
  // pestaña D (o, en este tipo de orden, desde la propia pestaña C), no
  // con un botón "Actualizar" aparte.
  let nextStage = stageIdx >= 0 && stageIdx < 3 ? STAGE_ORDER[stageIdx + 1] : null;
  if (authType && nextStage === 'D') nextStage = null; // este tipo de orden no pasa por Cita

  const seccionA = `<div class="ro-section">
    <div class="ro-section-title">A · Orden</div>
    ${roField('Médico tratante', doc ? esc(doc.nombre) + (doc.especialidad ? ' — ' + esc(doc.especialidad) : '') : null)}
    ${roField('Fecha', o.fechaOrden ? fmtDate(o.fechaOrden) : null)}
    ${roField('Tipo de orden', o.tipoOrden ? esc(o.tipoOrden) : null)}
    ${roField('Descripción', o.descripcion ? esc(o.descripcion) : null)}
    ${o.orden_archivo ? `<button type="button" class="btn btn-sm btn-ghost" data-view-file="orden">Ver historia clínica</button>` : roField('Historia clínica', null)}
    ${o.orden_documento ? `<button type="button" class="btn btn-sm btn-ghost" data-view-file="documento">Ver orden</button>` : roField('Orden', null)}
    <div class="ro-consulta-add">
      <button type="button" class="btn btn-sm" data-pv-consulta="1">Ver la consulta completa</button>
      <p class="ro-empty-msg">La fecha, el médico y la historia clínica son de la consulta y se editan allá. Desde ahí se le agregan más órdenes.</p>
    </div>
  </div>`;

  const seccionB = stageIdx >= 1 ? `<div class="ro-section">
    <div class="ro-section-title">B · Solicitud</div>
    ${roField('Fecha', o.solicitud_fecha ? fmtDate(o.solicitud_fecha) : null)}
    ${roField('Hora', o.solicitud_hora ? esc(o.solicitud_hora) : null)}
    ${roField('Número de solicitud', o.solicitud_numero ? esc(o.solicitud_numero) : null)}
    ${o.solicitud_imagen ? `<button type="button" class="btn btn-sm btn-ghost" data-view-file="solicitud">Ver imagen</button>` : ''}
  </div>` : pendingSectionHtml('B', 'B · Solicitud', 'Aún no se ha tramitado la solicitud.', nextStage);

  const seccionC = stageIdx >= 2
    ? (authType ? `<div class="ro-section">
        <div class="ro-section-title">C · Autorizaciones ${o._stage === 'Finalizado' ? '<span class="tag tag-green" style="margin-left:6px">Finalizada</span>' : ''}</div>
        ${roField('Meses autorizados', o.auth_meses ? String(o.auth_meses) : null)}
        ${roField('Proveedor', centro ? esc(centro.nombre) : null)}
        ${authTableReadHtml(authList || [])}
        ${o.auth_imagen ? `<button type="button" class="btn btn-sm btn-ghost" data-view-file="autorizacion">Ver imagen</button>` : ''}
      </div>` : `<div class="ro-section">
        <div class="ro-section-title">C · Autorización</div>
        ${roField('Fecha de inicio', o.auth_fechaInicio ? fmtDate(o.auth_fechaInicio) : null)}
        ${roField('Fecha de vencimiento', o.auth_fechaVence ? fmtDate(o.auth_fechaVence) : null)}
        ${roField('Número de autorización', o.auth_numero ? esc(o.auth_numero) : null)}
        ${roField('Centro médico', centro ? esc(centro.nombre) : null)}
        ${centro && centro.tel1 ? roField('Teléfono', `${esc(centro.tel1)} ${callLinkHtml(centro.tel1)}`) : ''}
        ${centro && centro.tel2 ? roField('Teléfono 2', `${esc(centro.tel2)} ${callLinkHtml(centro.tel2)}`) : ''}
        ${centro && centro.dir ? roField('Dirección', esc(centro.dir)) : ''}
        ${o.auth_imagen ? `<button type="button" class="btn btn-sm btn-ghost" data-view-file="autorizacion">Ver imagen</button>` : ''}
      </div>`)
    : pendingSectionHtml('C', authType ? 'C · Autorizaciones' : 'C · Autorización', authType ? 'Aún no se ha registrado la autorización.' : 'Aún no hay autorización registrada.', nextStage);

  // Este tipo de orden nunca pasa por "Cita" — se omite la sección D en
  // vez de mostrarla como "pendiente" (nunca dejaría de estarlo).
  const seccionD = authType ? '' : (stageIdx >= 3 ? `<div class="ro-section">
    <div class="ro-section-title">D · Cita ${o._stage === 'Finalizado' ? '<span class="tag tag-green" style="margin-left:6px">Finalizada</span>' : ''}</div>
    ${roField('Fecha', o.cita_fecha ? fmtDate(o.cita_fecha) : null)}
    ${roField('Hora', o.cita_hora ? esc(o.cita_hora) : null)}
    ${roField('Médico', docCita ? esc(docCita.nombre) : null)}
    ${roField('Consultorio', o.cita_consultorio ? esc(o.cita_consultorio) : null)}
    ${roField('Dirección', o.cita_direccion ? esc(o.cita_direccion) : null)}
    ${roField('Indicaciones', o.cita_indicaciones ? esc(o.cita_indicaciones) : null)}
  </div>` : pendingSectionHtml('D', 'D · Cita', 'Aún no hay cita programada.', nextStage));

  return `<div class="order-readview">${seccionA}${seccionB}${seccionC}${seccionD}</div>`;
}

/** Entrada por defecto al abrir una orden ya existente: solo lectura, en
 * ventana sobrepuesta con barra fija (Editar al lado de Cerrar, nunca se
 * mueve al hacer scroll — MI AUDITORIA Órdenes #3a/#3b, mismo helper que
 * el Modo vista de Pacientes). La edición sigue siendo una acción
 * explícita, nunca el estado inicial. */
async function openOrderModal(id) {
  if (!state.activePatient) { showToast('Selecciona un paciente primero', 'err'); return; }

  let o, doctors, centers, authList;
  try {
    [o, doctors, centers] = await Promise.all([
      api.getOrder(id), api.listDoctors(state.household.id), api.listCenters(state.household.id),
    ]);
    authList = isAuthTableType(o.tipoOrden) ? await api.listOrderAuthorizations(id) : [];
  } catch (err) {
    showToast(err.message || 'No se pudo abrir la orden', 'err');
    return;
  }
  const docMap = Object.fromEntries(doctors.map(d => [d.id, d]));
  const centerMap = Object.fromEntries(centers.map(c => [c.id, c]));
  const doc = docMap[o.medicoId];

  const { root } = openViewOverlay({
    title: o.tipoOrden || 'Orden médica',
    subtitle: [doc?.nombre, o.descripcion].filter(Boolean).join(' · ') || 'Orden médica',
    bodyHtml: renderOrderReadView(o, docMap, centerMap, authList),
    actions: [
      { label: 'Editar', cls: 'btn-primary', onClick: (close) => { close(); openOrderWizard(id); } },
    ],
  });

  root.querySelectorAll('[data-view-file]').forEach(btn => btn.addEventListener('click', () => {
    const field = FILE_SLOTS[btn.dataset.viewFile];
    openAttachmentViewer(o[field]);
  }));
  // MI AUDITORIA Órdenes #3c: "Actualizar" cierra el modo vista y abre el
  // asistente directo en la próxima etapa pendiente (no en la etapa ya
  // alcanzada, como hace "Editar").
  root.querySelectorAll('[data-pv-update-stage]').forEach(btn => btn.addEventListener('click', () => {
    closeViewOverlay();
    openOrderWizard(id, btn.dataset.pvUpdateStage);
  }));
  // Ir a la consulta de la que salió esta orden: para agregarle otra, o para
  // corregir de una vez la fecha, el médico o la historia clínica de todas.
  root.querySelector('[data-pv-consulta]')?.addEventListener('click', async () => {
    const { openConsultaWizard } = await import('./consultas.js');
    closeViewOverlay();
    openConsultaWizard(o.visitId, { onSaved: () => render() });
  });
}

/** Abre el asistente de edición. `id` ausente = orden nueva (sin
 * restricciones de navegación entre etapas). `prefill` — ver estado
 * "Finalizado" en la sección D, para la orden de seguimiento. `forceTab`
 * (MI AUDITORIA Órdenes #3c, botón "Actualizar") abre directo en esa
 * pestaña en vez de en la etapa ya alcanzada — siempre hacia adelante,
 * así que nunca dispara el aviso de "etapa anterior" de switchWizTab. */
/**
 * Aviso temporal de la etapa B (Fase 3): recuerda radicar la orden ante la
 * aseguradora, nombrándola cuando se sabe cuál es. Desaparece en cuanto la
 * solicitud queda registrada — ver `refrescarAvisoSolicitud()`.
 *
 * El nombre sale de la EPS del paciente activo. Si el paciente no la tiene
 * cargada se usa una redacción genérica en vez de omitir el aviso: el
 * recordatorio sirve igual, y decir "tu EPS" es preferible a dejar un hueco
 * o, peor, escribir "undefined".
 */
function avisoSolicitudHtml() {
  const eps = state.activePatient?.eps?.trim();
  const ante = eps ? `ante ${esc(eps)}` : 'ante tu EPS';
  return `<div class="info-box info-box-warn hidden" id="of-aviso-solicitud" style="margin-bottom:12px">
    <span class="ib-icon">${Icons.alertTriangle}</span>
    <span>Esta orden todavía no se ha radicado ${ante}. Registra abajo la fecha y el número de la solicitud cuando lo hagas — mientras tanto, la autorización no empieza a contar.</span>
  </div>`;
}

/** ¿Ya se registró la solicitud? Basta la fecha o el número: son los dos
 *  datos que prueban que la orden se radicó. */
function solicitudEstaRegistrada() {
  return !!(document.getElementById('of-sol-fecha')?.value
    || document.getElementById('of-sol-num')?.value.trim());
}

/** Muestra u oculta el aviso según se haya llenado la solicitud. Se llama al
 *  cargar el formulario y en cada cambio de esos campos, para que el aviso
 *  se vaya en el momento, sin esperar a guardar. */
function refrescarAvisoSolicitud() {
  document.getElementById('of-aviso-solicitud')
    ?.classList.toggle('hidden', solicitudEstaRegistrada());
}

/**
 * Bloque "¿Recordarme cada 3 días?" de la etapa B — Fase 3.
 *
 * Solo aparece al editar una orden ya creada: el recordatorio se guarda
 * contra el id de la orden, que en una orden nueva todavía no existe.
 */
function recordatorioFieldHtml() {
  return `
    <div class="form-field span2" id="of-recordatorio-wrap" style="margin-bottom:14px">
      <label class="ck-row"><input type="checkbox" id="of-recordar"/> <span>Recordarme hacer seguimiento hasta que llegue la autorización</span></label>
      <div class="hidden" id="of-recordar-opts" style="margin-top:8px">
        <select class="fi" id="of-recordar-cada">
          ${INTERVALOS.map(i => `<option value="${i.dias}" ${i.dias === 3 ? 'selected' : ''}>${i.label}</option>`).join('')}
        </select>
        <p style="font-size:11.5px;color:var(--tm);margin:6px 0 0" id="of-recordar-nota"></p>
      </div>
    </div>`;
}

/**
 * Conecta el recordatorio: carga el estado guardado y aplica los cambios al
 * momento (no al guardar la orden), porque activar un recordatorio y que no
 * pase nada visible hasta apretar "Guardar cambios" se siente roto.
 */
async function wireRecordatorio(orderId) {
  const check = document.getElementById('of-recordar');
  if (!check || !orderId) return;
  const opts = document.getElementById('of-recordar-opts');
  const cada = document.getElementById('of-recordar-cada');
  const nota = document.getElementById('of-recordar-nota');

  const pintarNota = () => {
    const permiso = permisoNotificaciones();
    nota.textContent = permiso === 'granted'
      ? 'Te avisaremos con una notificación y verás el aviso al abrir la app.'
      : permiso === 'denied'
        ? 'Las notificaciones están bloqueadas en este navegador: el aviso aparecerá dentro de la app. Puedes desbloquearlas desde la configuración del sitio.'
        : 'Se te pedirá permiso para enviarte notificaciones. Si no lo das, el aviso aparecerá dentro de la app.';
  };

  try {
    const actual = await api.getOrderReminder(orderId);
    if (actual?.activo) {
      check.checked = true;
      opts.classList.remove('hidden');
      cada.value = String(actual.cadaDias);
    }
  } catch { /* si no se puede leer, queda apagado; activarlo lo reescribe */ }
  pintarNota();

  // Activar pide el permiso de notificaciones, que puede quedarse esperando
  // una respuesta varios segundos. Sin serializar, marcar y desmarcar rápido
  // deja la casilla apagada y el recordatorio encendido en la base: el
  // usuario seguiría recibiendo avisos de algo que apagó. La cola garantiza
  // que la última intención sea la que quede escrita.
  let enCurso = Promise.resolve();
  const aplicar = () => {
    enCurso = enCurso.then(async () => {
      const quiere = check.checked;
      try {
        if (!quiere) {
          await desactivarRecordatorio(orderId);
          // Solo se avisa si en el ínterin no volvió a encenderse.
          if (!check.checked) showToast('Recordatorio desactivado', 'warn');
          return;
        }
        const { notificaciones } = await activarRecordatorio(orderId, cada.value);
        pintarNota();
        if (check.checked) {
          showToast(notificaciones
            ? 'Recordatorio activado'
            : 'Recordatorio activado (verás el aviso al abrir la app)');
        }
      } catch (err) {
        if (quiere) {
          check.checked = false;
          opts.classList.add('hidden');
        }
        showToast(err.message || 'No se pudo cambiar el recordatorio', 'err');
      }
    });
    return enCurso;
  };

  check.addEventListener('change', () => {
    opts.classList.toggle('hidden', !check.checked);
    aplicar();
  });
  cada.addEventListener('change', () => { if (check.checked) aplicar(); });
}

/** Cómo se lee un médico en el campo: nombre y, si se sabe, especialidad. */
async function openOrderWizard(id, forceTab) {
  campos = {
    documento: createAttachmentField({ id: 'of-documento', nombreArchivo: 'orden', dropText: 'Haz clic para subir la orden médica (PDF o foto — se convierte a PDF automáticamente)' }),
    solicitud: createAttachmentField({ id: 'of-solicitud', nombreArchivo: 'solicitud', dropText: 'Haz clic para subir imagen (se convierte a PDF automáticamente)', accept: 'image/*' }),
    autorizacion: createAttachmentField({ id: 'of-autorizacion', nombreArchivo: 'autorizacion', dropText: 'Haz clic para subir imagen (se convierte a PDF automáticamente)', accept: 'image/*' }),
  };
  originalStoredPaths = [];
  currentVisitId = null;
  currentOrderStageIdx = -1;
  authRows = [];
  authOriginalEntregado = new Set();

  if (!state.activePatient) { showToast('Selecciona un paciente primero', 'err'); return; }

  // Este asistente ya no CREA órdenes: una orden nace dentro de su consulta
  // (ver consultas.js). Acá solo se edita una que ya existe y se le hace el
  // seguimiento — solicitud, autorización y cita.
  if (!id) { showToast('Las órdenes se crean desde la consulta', 'err'); return; }

  let doctors, centers, o = null;
  try {
    doctors = await api.listDoctors(state.household.id);
    centers = await api.listCenters(state.household.id);
    o = await api.getOrder(id);
    currentVisitId = o.visitId;
    campos.documento.set(o.orden_documento);
    campos.solicitud.set(o.solicitud_imagen);
    campos.autorizacion.set(o.auth_imagen);
    originalStoredPaths = files.attachmentPathsOfOrder(o);
    currentOrderStageIdx = STAGE_ORDER.indexOf(o._stage);
    if (isAuthTableType(o.tipoOrden)) {
      authRows = await api.listOrderAuthorizations(id);
      authOriginalEntregado = new Set(authRows.filter(r => r.entregado).map(r => r.mesNumero));
    }
  } catch (err) {
    showToast(err.message || 'No se pudo abrir el asistente de la orden', 'err');
    return;
  }
  // Este tipo de orden no tiene pestaña D — si la etapa alcanzada fuera
  // "D" o "Finalizado" (dato legado de antes de esta fusión de tipos), se
  // aterriza en "c" en vez de en una pestaña inexistente/oculta.
  let startTab = TAB_BY_STAGE[o._stage];
  if (isAuthTableType(o.tipoOrden) && startTab === 'd') startTab = 'c';

  // Médico de la CONSULTA, solo para mostrarlo. Se edita en la consulta.
  const docConsulta = doctors.find(d => d.id === o.medicoId) || null;

  const docOptionsCita = doctors.map(d => `<option value="${d.id}" ${o?.medicoId_cita === d.id ? 'selected' : ''}>${esc(d.nombre)}${d.especialidad ? ' — ' + esc(d.especialidad) : ''}</option>`).join('');
  const centerOptions = centers.map(c => `<option value="${c.id}" ${o?.auth_centroId === c.id ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('');

  const body = `
    <div class="wiz-tabs" id="wiz-tabs">
      <button class="wiz-tab ${startTab === 'a' ? 'active' : ''}" data-t="a" type="button"><span class="wiz-dot"></span>A · Orden</button>
      <button class="wiz-tab ${startTab === 'b' ? 'active' : ''}" data-t="b" type="button"><span class="wiz-dot"></span>B · Solicitud</button>
      <button class="wiz-tab ${startTab === 'c' ? 'active' : ''}" data-t="c" type="button"><span class="wiz-dot"></span><span id="wiz-tab-c-label">C · Autorización</span></button>
      <button class="wiz-tab ${startTab === 'd' ? 'active' : ''} ${isAuthTableType(o.tipoOrden) ? 'hidden' : ''}" id="wiz-tab-d" data-t="d" type="button"><span class="wiz-dot"></span>D · Cita</button>
    </div>
    <div class="wiz-pane ${startTab === 'a' ? 'visible' : ''}" id="pane-a">
      ${o._stage === 'A' ? `<div class="info-box" style="margin-bottom:16px">Una vez que esta orden avance a la etapa "Solicitud", ya no podrá eliminarse — solo editarse. Revisa bien los datos antes de continuar.</div>` : ''}
      <div class="consulta-ref" id="of-consulta-ref">
        <div class="consulta-ref-txt">
          <span class="consulta-ref-label">De la consulta</span>
          <span class="consulta-ref-valor">${esc(fmtDate(o.fechaOrden))}${docConsulta ? ' · ' + esc(docConsulta.nombre) : ''}</span>
        </div>
        <button type="button" class="btn btn-sm" id="of-editar-consulta">Editar consulta</button>
      </div>
      <div class="form-row cols-2">
        <div class="form-field span2"><label class="fl">Tipo de orden</label><select class="fi" id="of-tipo"><option value="">Seleccione tipo de orden</option>${ORDER_TYPES.map(t => `<option ${o?.tipoOrden === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="form-field span2"><label class="fl">Descripción</label><textarea class="fi" id="of-desc" rows="2" placeholder="Descripción de la orden…">${esc(o?.descripcion || '')}</textarea></div>
        <div class="form-field span2"><label class="fl">Orden</label>
          ${campos.documento.html()}
        </div>
      </div>
    </div>
    <div class="wiz-pane ${startTab === 'b' ? 'visible' : ''}" id="pane-b">
      ${avisoSolicitudHtml()}
      <div class="info-box" style="margin-bottom:16px">Registra aquí cuando envíes la orden a la aseguradora para solicitar autorización.</div>
      ${id ? recordatorioFieldHtml() : ''}
      <div class="form-row cols-2">
        <div class="form-field"><label class="fl">Fecha de solicitud</label><input class="fi" id="of-sol-fecha" type="date"/></div>
        <div class="form-field"><label class="fl">Hora</label><input class="fi" id="of-sol-hora" type="time"/></div>
        <div class="form-field span2"><label class="fl">Número de solicitud</label><input class="fi" id="of-sol-num" type="text" placeholder="SOL-2025-XXXXX" style="font-family:'JetBrains Mono',monospace"/></div>
        <div class="form-field span2"><label class="fl">Imagen o captura de pantalla</label>
          ${campos.solicitud.html()}
        </div>
      </div>
    </div>
    <div class="wiz-pane ${startTab === 'c' ? 'visible' : ''}" id="pane-c">
      <div id="pane-c-inner"></div>
    </div>
    <div class="wiz-pane ${startTab === 'd' ? 'visible' : ''}" id="pane-d">
      <div class="form-row cols-2">
        <div class="form-field"><label class="fl">Fecha de la cita</label><input class="fi" id="of-cita-fecha" type="date"/></div>
        <div class="form-field"><label class="fl">Hora</label><input class="fi" id="of-cita-hora" type="time"/></div>
        <div class="form-field">
          <label class="fl">Médico</label>
          <div style="display:flex;gap:6px">
            <select class="fi" id="of-cita-medico" style="flex:1"><option value="">Seleccione médico</option>${docOptionsCita}</select>
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
          <label class="cb-row"><input type="checkbox" id="of-followup"/> Agregar una orden de control a esta consulta al guardar</label>
        </div>
      </div>
    </div>
  `;

  showModal('Editar orden médica', body, [
    { label: 'Cancelar', cls: 'btn', action: closeModal },
    { label: 'Guardar cambios', cls: 'btn btn-primary', action: () => saveOrderForm(id) },
  ]);
  setModalMaxWidth('680px');

  document.querySelectorAll('.wiz-tab').forEach(t => t.addEventListener('click', () => switchWizTab(t.dataset.t)));
  campos.documento.wire();
  campos.solicitud.wire();

  document.getElementById('of-editar-consulta').addEventListener('click', async () => {
    const { openConsultaWizard } = await import('./consultas.js');
    closeModal();
    openConsultaWizard(o.visitId, { onSaved: () => render() });
  });

  wireInlineNewDoctor({ primarySelectId: 'of-cita-medico', otherSelectIds: [], addBtnId: 'of-cita-medico-add-btn', formContainerId: 'of-cita-medico-newform', specialties: SPECIALTIES });

  document.getElementById('of-estado').addEventListener('change', (e) => {
    document.getElementById('of-followup-field').classList.toggle('hidden', e.target.value !== 'Finalizado');
  });

  ['of-sol-fecha', 'of-sol-num'].forEach(fid =>
    document.getElementById(fid).addEventListener('input', refrescarAvisoSolicitud));

  document.getElementById('of-sol-fecha').value = o.solicitud_fecha || '';
  document.getElementById('of-sol-hora').value = o.solicitud_hora || '';
  document.getElementById('of-sol-num').value = o.solicitud_numero || '';
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
  // Los `value =` de arriba no disparan 'input', así que el aviso de la
  // etapa B se evalúa a mano una vez cargados los datos.
  refrescarAvisoSolicitud();
  wireRecordatorio(id);

  // Pane C (Autorización / Autorizaciones) depende del tipo de orden — se
  // arma aparte y se reconstruye si el usuario cambia el tipo en vivo
  // (MI AUDITORIA Órdenes #4).
  renderPaneC(o.tipoOrden || '', o, centerOptions);
  document.getElementById('of-tipo').addEventListener('change', (e) => {
    const newTipo = e.target.value;
    document.getElementById('wiz-tab-d').classList.toggle('hidden', isAuthTableType(newTipo));
    document.getElementById('wiz-tab-c-label').textContent = isAuthTableType(newTipo) ? 'C · Autorizaciones' : 'C · Autorización';
    if (isAuthTableType(newTipo) && document.getElementById('pane-d').classList.contains('visible')) switchWizTab('c');
    authRows = [];
    authOriginalEntregado = new Set();
    renderPaneC(newTipo, null, centerOptions);
  });

  if (forceTab && forceTab !== startTab) switchWizTab(forceTab);
}

/** Arma y conecta el contenido de la pestaña C, que difiere según el tipo
 * de orden (MI AUDITORIA Órdenes #4). `o` solo se usa para precargar
 * valores ya guardados — se pasa `null` cuando el tipo cambia en vivo,
 * para no mezclar datos de una variante con la otra. */
function renderPaneC(tipoOrden, o, centerOptions) {
  const inner = document.getElementById('pane-c-inner');
  if (!inner) return;
  inner.innerHTML = isAuthTableType(tipoOrden) ? `
    <div class="info-box" style="margin-bottom:16px">Este tipo de orden no incluye la etapa "Cita": se autoriza por varios meses y se hace seguimiento mes a mes hasta marcarla como finalizada.</div>
    <div class="form-row cols-2">
      <div class="form-field">
        <label class="fl">Número de meses autorizados</label>
        <input class="fi" id="of-auth-meses" type="number" min="1" max="36" placeholder="Ej: 6"/>
      </div>
      <div class="form-field">
        <label class="fl">Proveedor</label>
        <div style="display:flex;gap:6px">
          <select class="fi" id="of-auth-centro" style="flex:1"><option value="">Seleccione proveedor</option>${centerOptions}</select>
          <button type="button" class="btn btn-sm btn-icon" id="of-centro-add-btn" title="Agregar proveedor al directorio">+</button>
        </div>
      </div>
    </div>
    <div id="of-auth-rows-container" style="margin-top:6px"></div>
    <div id="of-auth-completo-aviso"></div>
    <div class="form-row cols-2" style="margin-top:14px">
      <div class="form-field span2"><label class="fl">Imagen de la autorización (opcional)</label>
        ${campos.autorizacion.html()}
      </div>
      <div class="form-field span2">
        <label class="cb-row"><input type="checkbox" id="of-auth-finalizado"/> Todas las entregas completadas — marcar esta orden como finalizada</label>
      </div>
    </div>
  ` : `
    <div class="info-box" style="margin-bottom:16px">Registra aquí la autorización que te entregó la aseguradora: el número, la vigencia y, si quieres, una foto del documento.</div>
    <div class="form-row cols-2">
      ${dateRangeFieldHtml('of-auth-vigencia', { label: 'Vigencia de la autorización', span: true })}
      <div class="form-field span2"><label class="fl">Número de autorización</label><input class="fi" id="of-auth-num" type="text" placeholder="AUT-2025-XXXXX" style="font-family:'JetBrains Mono',monospace"/></div>
      <div class="form-field span2">
        <label class="fl">Centro médico</label>
        <div style="display:flex;gap:6px">
          <select class="fi" id="of-auth-centro" style="flex:1"><option value="">Seleccione centro médico</option>${centerOptions}</select>
          <button type="button" class="btn btn-sm btn-icon" id="of-centro-add-btn" title="Agregar centro médico al directorio">+</button>
        </div>
      </div>
      <div class="form-field span2"><label class="fl">Imagen de la autorización</label>
        ${campos.autorizacion.html()}
      </div>
    </div>
  `;

  campos.autorizacion.wire();
  wireInlineNewCenter('of-auth-centro', 'of-centro-add-btn');

  if (isAuthTableType(tipoOrden)) {
    const mesesInput = document.getElementById('of-auth-meses');
    if (o) {
      mesesInput.value = o.auth_meses || '';
      document.getElementById('of-auth-centro').value = o.auth_centroId || '';
      document.getElementById('of-auth-finalizado').checked = o.estadoCita === 'Finalizado';
    }
    mesesInput.addEventListener('input', () => regenerateAuthRows(mesesInput.value));
    regenerateAuthRows(mesesInput.value);
    document.getElementById('of-auth-finalizado').addEventListener('change', refrescarAvisoEntregasCompletas);
  } else {
    wireDateRangeField('of-auth-vigencia');
    if (o) {
      fillDateRangeField('of-auth-vigencia', o.auth_fechaInicio, o.auth_fechaVence);
      document.getElementById('of-auth-num').value = o.auth_numero || '';
      document.getElementById('of-auth-centro').value = o.auth_centroId || '';
    }
  }
}

/** Ajusta `authRows` a `meses` filas (1..N), conservando los valores ya
 * escritos para los meses que se mantienen, y vuelve a pintar la tabla. */
function regenerateAuthRows(mesesValue) {
  const n = Math.max(0, Math.min(36, parseInt(mesesValue, 10) || 0));
  const next = [];
  for (let i = 1; i <= n; i++) {
    next.push(authRows.find(r => r.mesNumero === i) || {
      mesNumero: i, numeroAutorizacion: '', fechaInicio: '', fechaVencimiento: '', cantidad: '', entregado: false,
    });
  }
  authRows = next;
  renderAuthRowsTable();
}

/**
 * Aviso condicional (Fase 3, segunda tanda): cuando ya se marcaron
 * "Entregado" todos los meses de la tabla, sugiere terminar de una vez
 * marcando la orden como finalizada — en vez de que la persona tenga que
 * acordarse de bajar y marcar esa casilla por su cuenta.
 *
 * Solo se muestra con al menos una fila (una tabla vacía no está "completa",
 * está sin datos) y desaparece apenas se destilda cualquier entrega o se
 * finaliza la orden a mano.
 */
function refrescarAvisoEntregasCompletas() {
  const cont = document.getElementById('of-auth-completo-aviso');
  if (!cont) return;
  const yaFinalizado = document.getElementById('of-auth-finalizado')?.checked;
  const todasEntregadas = authRows.length > 0 && authRows.every(r => r.entregado);
  cont.innerHTML = (todasEntregadas && !yaFinalizado)
    ? `<div class="info-box info-box-warn" style="margin:10px 0">
        <span class="ib-icon">${Icons.alertTriangle}</span>
        <span>Todas las entregas de esta orden ya están marcadas. Si no falta ninguna más, marca abajo la orden como finalizada.</span>
      </div>`
    : '';
}

function renderAuthRowsTable() {
  const container = document.getElementById('of-auth-rows-container');
  if (!container) return;
  if (!authRows.length) {
    container.innerHTML = '<p style="font-size:12.5px;color:var(--ts);margin:0">Escribe el número de meses para generar la tabla mes a mes.</p>';
    refrescarAvisoEntregasCompletas();
    return;
  }
  container.innerHTML = `<table class="auth-table">
    <thead><tr><th>Mes</th><th>N° autorización</th><th>Fecha inicio</th><th>Fecha vencimiento</th><th>Cantidad</th><th>Entregado</th></tr></thead>
    <tbody>${authRows.map(r => `<tr>
      <td>${r.mesNumero}</td>
      <td><input class="fi" data-auth-mes="${r.mesNumero}" data-auth-field="numeroAutorizacion" type="text" value="${esc(r.numeroAutorizacion || '')}"/></td>
      <td><input class="fi" data-auth-mes="${r.mesNumero}" data-auth-field="fechaInicio" type="date" value="${r.fechaInicio || ''}"/></td>
      <td><input class="fi" data-auth-mes="${r.mesNumero}" data-auth-field="fechaVencimiento" type="date" value="${r.fechaVencimiento || ''}"/></td>
      <td><input class="fi" data-auth-mes="${r.mesNumero}" data-auth-field="cantidad" type="text" value="${esc(r.cantidad || '')}"/></td>
      <td style="text-align:center"><input type="checkbox" data-auth-mes="${r.mesNumero}" data-auth-field="entregado" ${r.entregado ? 'checked' : ''}/></td>
    </tr>`).join('')}</tbody>
  </table>`;
  container.querySelectorAll('[data-auth-mes]').forEach(el => {
    el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => {
      const row = authRows.find(r => r.mesNumero === Number(el.dataset.authMes));
      if (!row) return;
      row[el.dataset.authField] = el.type === 'checkbox' ? el.checked : el.value;
      if (el.dataset.authField === 'entregado') refrescarAvisoEntregasCompletas();
    });
  });
  refrescarAvisoEntregasCompletas();
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
// Slot del wizard → campo jsonb de la orden. Ojo: `orden_archivo` guarda la
// HISTORIA CLÍNICA y `orden_documento` la orden — el nombre de la primera es
// histórico, era el único adjunto de la etapa (ver migración 0033).
const FILE_SLOTS = { documento: 'orden_documento', solicitud: 'solicitud_imagen', autorizacion: 'auth_imagen' };

/**
 * ¿Este adjunto todavía está en el navegador y hay que subirlo? Lo que ya vive
 * en Storage llega sin `data` y no se vuelve a tocar.
 */
function needsUpload(att) {
  return !!(att && att.data && !files.isStored(att));
}

/**
 * Sube los adjuntos recién elegidos y deja en `obj` el formato persistible
 * {name,type,size,path}. La orden ya existe siempre —este asistente no crea—,
 * así que su id está disponible para armar la ruta desde el primer momento.
 */
async function uploadNewAttachments(obj, orderId) {
  for (const [slot, field] of Object.entries(FILE_SLOTS)) {
    const f = campos[slot]?.get();
    if (!needsUpload(f)) continue;
    obj[field] = await files.uploadAttachment(state.household.id, orderId, slot, f);
  }
}

async function saveOrderForm(editId) {
  if (!state.activePatient) { showToast('Selecciona un paciente primero', 'err'); return; }

  const tipoOrden = document.getElementById('of-tipo').value;
  const authType = isAuthTableType(tipoOrden);

  const obj = {
    id: editId,
    // La consulta de la que cuelga. No se edita acá, pero saveOrder reconstruye
    // la fila entera y sin esto el UPDATE la dejaría huérfana (visit_id es not
    // null: en realidad fallaría, que al menos se nota).
    visitId: currentVisitId,
    tipoOrden,
    descripcion: document.getElementById('of-desc').value.trim(),
    orden_documento: campos.documento.get(),
    solicitud_fecha: document.getElementById('of-sol-fecha').value,
    solicitud_hora: document.getElementById('of-sol-hora').value,
    solicitud_numero: document.getElementById('of-sol-num').value.trim(),
    solicitud_imagen: campos.solicitud.get(),
    // Etapa C: "Autorización" (un registro) vs "Autorizaciones" (tabla
    // mes a mes, MI AUDITORIA Órdenes #4) — solo uno de los dos juegos de
    // campos existe en el DOM según el tipo de orden actual.
    auth_fechaInicio: authType ? '' : readDateRangeField('of-auth-vigencia').inicio,
    auth_fechaVence: authType ? '' : readDateRangeField('of-auth-vigencia').fin,
    auth_numero: authType ? '' : document.getElementById('of-auth-num').value.trim(),
    auth_centroId: document.getElementById('of-auth-centro').value,
    auth_imagen: campos.autorizacion.get(),
    auth_meses: authType ? (parseInt(document.getElementById('of-auth-meses').value, 10) || null) : null,
    cita_fecha: document.getElementById('of-cita-fecha').value,
    cita_hora: document.getElementById('of-cita-hora').value,
    medicoId_cita: document.getElementById('of-cita-medico').value,
    cita_consultorio: document.getElementById('of-cita-consul').value.trim(),
    cita_direccion: document.getElementById('of-cita-dir').value.trim(),
    cita_indicaciones: document.getElementById('of-cita-ind').value.trim(),
    estadoCita: authType
      ? (document.getElementById('of-auth-finalizado')?.checked ? 'Finalizado' : '')
      : document.getElementById('of-estado').value,
  };
  const wantsFollowUp = !authType && obj.estadoCita === 'Finalizado' && !!document.getElementById('of-followup')?.checked;

  // Unificación Órdenes → Medicamento (auditoría 2026-07-17): si en esta
  // edición se marcó como "entregado" algún mes que antes no lo estaba, se
  // ofrece crear un nuevo medicamento a partir de la orden.
  const nuevaEntrega = authType && authRows.some(r => r.entregado && !authOriginalEntregado.has(r.mesNumero));

  if (!obj.tipoOrden) { showToast('Selecciona el tipo de orden', 'err'); switchWizTab('a'); return; }

  try {
    await uploadNewAttachments(obj, editId);
    const saved = await api.saveOrder(obj, state.household.id, state.activePatient.id);

    // Limpiar del Storage los adjuntos que quedaron fuera (reemplazados o
    // quitados en esta edición). Mejor esfuerzo, después de guardar.
    const keptPaths = files.attachmentPathsOfOrder(saved);
    files.removeAttachments(originalStoredPaths.filter(p => !keptPaths.includes(p)));

    // Tabla "Autorizaciones" (una fila por mes, MI AUDITORIA Órdenes #4): se
    // reemplaza el set completo. Si la orden ya existía y cambió de tipo
    // dejando de ser "Medicamentos/Insumos/Terapias", se limpian filas viejas.
    if (authType) {
      await api.replaceOrderAuthorizations(saved.id, state.household.id, authRows);
    } else {
      await api.replaceOrderAuthorizations(saved.id, state.household.id, []);
    }

    // Si esta edición llevó la orden a Autorización o más allá, el
    // recordatorio ya cumplió: se apaga acá y no en el próximo arranque,
    // para que no alcance a sonar una vez de más. Mejor esfuerzo — que
    // falle no puede tumbar el guardado de la orden.
    if (ETAPAS_SIN_RECORDATORIO.includes(saved._stage)) {
      api.desactivarOrderReminder(saved.id).catch(() => {});
    }

    closeModal();
    showToast('Orden actualizada');
    render();
    if (state.currentView === 'dashboard') {
      const { render: renderDashboard } = await import('./dashboard.js');
      renderDashboard();
    }
    if (wantsFollowUp) {
      // La cita de control sale de la MISMA consulta que se acaba de atender,
      // así que la orden nueva se agrega ahí y no en una consulta suelta.
      const { openConsultaWizard } = await import('./consultas.js');
      openConsultaWizard(currentVisitId, {
        filaNueva: { tipoOrden: 'Cita de control' },
        onSaved: () => render(),
      });
    } else if (nuevaEntrega) {
      // Se marcó una nueva entrega en una orden de Medicamentos/Insumos/
      // Terapias: ofrecer registrar el medicamento, precargando el nombre
      // con la descripción de la orden.
      if (confirm('Marcaste una entrega como entregada en esta orden.\n\n¿Quieres registrar un nuevo medicamento a partir de ella?')) {
        const { openMedModal } = await import('./meds.js');
        openMedModal(null, { nombre: obj.descripcion || '' });
      }
    }
  } catch (err) {
    showToast(err.message || 'Error al guardar la orden', 'err');
  }
}
