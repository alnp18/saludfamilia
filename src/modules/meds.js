import { state } from '../state.js';
import * as api from '../lib/api.js';
import { showModal, closeModal, showToast } from '../lib/modal.js';
import { esc, fmtDate, today, daysFrom } from '../lib/utils.js';
import { catalogOptionsHtml, resolveCatalogValue, OTRA_VALUE } from '../lib/extensibleCatalog.js';
import { emptyStateHtml, errorStateHtml } from '../lib/emptyState.js';
import { Icons } from '../lib/icons.js';
import { dateRangeFieldHtml, wireDateRangeField, fillDateRangeField, readDateRangeField } from '../lib/dateRange.js';
import { liveSearchFieldHtml, wireLiveSearch, fillLiveSearch, readLiveSearch } from '../lib/liveSearch.js';
import { buscarMedicamentos, buscarSintomas } from '../lib/searches.js';
import { normalizar } from '../lib/searchSources.js';

// Vía de administración: fijas + "Otra…" extensible (ver nota transversal
// del plan — mismo patrón que Pólizas en Pacientes y Especialidad en
// Médicos, vía src/lib/extensibleCatalog.js).
const VIA_OPTIONS_FIJAS = ['Oral', 'Subcutánea', 'Intravenosa', 'Intramuscular', 'Tópica', 'Inhalatoria', 'Sublingual', 'Ótica', 'Oftálmica', 'Rectal', 'Nasal', 'Transdérmica', 'Vía sonda'];
const CATEGORIA_VIA = 'via_administracion';
// Unidad de dosis: mismo patrón "Otra… extensible" que Vía de administración
// — la lista fija cubre los casos comunes, pero no es exhaustiva (patrón
// transversal de desplegables, auditoría móvil 2026-07-25).
const UNIDAD_OPTIONS_FIJAS = ['mg', 'mcg', 'g', 'ml', 'UI', 'gotas', 'cápsulas', 'tabletas', 'sobres', 'parches', 'puffs'];
const CATEGORIA_UNIDAD = 'unidad_medicamento';

// Frecuencia: 5 opciones fijas (P1.5). Cada una define cuántas filas de
// "Horarios de toma" se auto-generan y cada cuántas horas se espacian —
// "A demanda" no genera filas automáticas (se pueden agregar a mano).
const FREQ_CONFIG = {
  'Una vez al día': { rows: 1, intervalHours: 24 },
  'Dos veces al día o cada 12 horas': { rows: 2, intervalHours: 12 },
  'Tres veces al día o cada 8 horas': { rows: 3, intervalHours: 8 },
  'Cuatro veces al día o cada 6 horas': { rows: 4, intervalHours: 6 },
  // Fase 3 (segunda tanda) — auditoría móvil 2026-07-26: dosis más frecuentes
  // que las 4 originales (antibióticos fuertes, esquemas de insulina
  // múltiple). Mismo patrón: generan sus horarios automáticamente espaciados.
  'Seis veces al día o cada 4 horas': { rows: 6, intervalHours: 4 },
  'Ocho veces al día o cada 3 horas': { rows: 8, intervalHours: 3 },
  'Doce veces al día o cada 2 horas': { rows: 12, intervalHours: 2 },
  'Cada hora': { rows: 24, intervalHours: 1 },
  'A demanda': { rows: 0, intervalHours: null },
};
const FREQ_OPTIONS = Object.keys(FREQ_CONFIG);

let medHorariosArr = []; // [{hora, dosis}]
let pendingViaOtra = false;
let pendingUnidadOtra = false;
let showHistory = false;
let showInactive = false;            // grupo colapsable de inactivos (auditoría 2026-07-17)
let usageByMed = {};                 // { medId: { count, last, events[] } } — usos "a demanda"
let pendingOptions = null;

export function setPendingOptions(opts) { pendingOptions = opts; }

const DEMANDA = 'A demanda';

/** Fecha + hora corta para los apuntes de uso (timestamptz → local). */
function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })
    + ' ' + d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}

export async function render() {
  const container = document.getElementById('view-meds');
  if (!container) return;

  container.innerHTML = `
    <div class="view-header">
      <div>
        <div class="view-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 6.5L6.5 10.5a5 5 0 007.07 7.07l4-4a5 5 0 00-7.07-7.07z"/><line x1="14" y1="10" x2="10" y2="14"/></svg> Medicamentos</div>
        <div class="view-sub" id="meds-sub">Medicamentos activos e historial de versiones</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn" id="btn-show-history" style="display:none">Historial</button>
        <button class="btn btn-primary" id="btn-new-med"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Nuevo medicamento</button>
      </div>
    </div>
    <div id="meds-active-section"></div>
    <div id="meds-history-section" style="display:none;margin-top:24px">
      <div class="meds-section-label" style="color:var(--ts)">Historial de versiones <span class="meds-count" id="meds-hist-count" style="background:var(--surface)">0</span></div>
      <div id="meds-history-list"></div>
    </div>
  `;
  document.getElementById('btn-new-med').addEventListener('click', () => openMedModal());
  document.getElementById('btn-show-history').addEventListener('click', toggleMedsHistory);

  const section = document.getElementById('meds-active-section');

  if (!state.activePatient) {
    section.innerHTML = emptyStateHtml({
      icon: Icons.users,
      title: 'Selecciona un paciente',
      action: { id: 'meds-goto-patients', label: 'Ir a Pacientes' },
    });
    document.getElementById('meds-goto-patients')?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('sf:goto', { detail: 'patients' })));
    return;
  }
  document.getElementById('meds-sub').textContent = 'Medicamentos de ' + state.activePatient.nombre;

  let all, usos;
  try {
    [all, usos] = await Promise.all([
      api.listMedsByPatient(state.activePatient.id),
      api.listMedUsageByPatient(state.activePatient.id),
    ]);
  } catch (err) {
    showToast(err.message || 'No se pudieron cargar los medicamentos', 'err');
    section.innerHTML = errorStateHtml({ retryId: 'btn-retry-meds', style: 'grid-column:1/-1' });
    document.getElementById('btn-retry-meds').addEventListener('click', () => render());
    return;
  }

  usageByMed = buildUsageIndex(usos);
  const active = all.filter(m => m.activo);
  const inactive = all.filter(m => !m.activo);

  document.getElementById('btn-show-history').style.display = inactive.length ? 'flex' : 'none';

  if (!active.length && !inactive.length) {
    section.innerHTML = emptyStateHtml({
      icon: Icons.pill,
      title: 'Sin medicamentos registrados',
      message: `Registra el primer medicamento de ${esc(state.activePatient.nombre)}.`,
      action: { id: 'btn-new-med-empty', label: 'Agregar medicamento' },
      style: 'grid-column:1/-1',
    });
    document.getElementById('btn-new-med-empty').addEventListener('click', () => openMedModal());
  } else {
    section.innerHTML = renderGroupedActive(active) + renderInactiveGroup(inactive);
    wireMedCardActions(section);
    const toggle = document.getElementById('meds-inactive-toggle');
    toggle?.addEventListener('click', () => {
      showInactive = !showInactive;
      document.getElementById('meds-inactive-body').style.display = showInactive ? 'grid' : 'none';
      toggle.classList.toggle('open', showInactive);
    });
  }

  if (showHistory) await renderMedsHistory();

  if (pendingOptions?.openModal) { pendingOptions = null; openMedModal(); }
}

/** Agrupa los usos "a demanda" por medicamento. `usos` viene ordenado del
 * más reciente al más antiguo, así que el primero de cada grupo es el último uso. */
function buildUsageIndex(usos) {
  const idx = {};
  usos.forEach(u => {
    const g = (idx[u.medicationId] ||= { count: 0, last: null, events: [] });
    g.count++;
    g.events.push(u);
    if (!g.last) g.last = u.usadoEn;
  });
  return idx;
}

// Jerarquía de la lista de activos (auditoría 2026-07-17): controlados
// primero, luego los de horario fijo, luego los "a demanda". Un controlado
// va al grupo de controlados aunque sea también "a demanda" (igual conserva
// su botón USADO en la tarjeta). Dentro de cada grupo, orden alfabético.
const ACTIVE_GROUPS = [
  { key: 'controlado', label: 'Medicamentos controlados', cls: 'g-red', test: m => m.controlado },
  { key: 'horario', label: 'Por horario', cls: 'g-primary', test: m => !m.controlado && m.frecuencia !== DEMANDA },
  { key: 'demanda', label: 'A demanda', cls: 'g-purple', test: m => !m.controlado && m.frecuencia === DEMANDA },
];

function byNombre(a, b) { return a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }); }

function renderGroupedActive(active) {
  return ACTIVE_GROUPS.map(g => {
    const items = active.filter(g.test).sort(byNombre);
    if (!items.length) return '';
    return `<div class="meds-group">
      <div class="meds-section-label ${g.cls}">${esc(g.label)} <span class="meds-count">${items.length}</span></div>
      <div class="meds-grid">${items.map(renderMedCard).join('')}</div>
    </div>`;
  }).join('');
}

function renderInactiveGroup(inactive) {
  if (!inactive.length) return '';
  const items = inactive.slice().sort(byNombre);
  return `<div class="meds-group meds-inactive-group">
    <button type="button" class="meds-inactive-toggle ${showInactive ? 'open' : ''}" id="meds-inactive-toggle">
      <svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
      Inactivos / con seguimiento previo <span class="meds-count" style="background:var(--surface)">${items.length}</span>
    </button>
    <div class="meds-grid" id="meds-inactive-body" style="display:${showInactive ? 'grid' : 'none'}">${items.map(renderMedCard).join('')}</div>
  </div>`;
}

function wireMedCardActions(root) {
  root.querySelectorAll('[data-edit-med]').forEach(b => b.addEventListener('click', () => openMedModal(b.dataset.editMed)));
  root.querySelectorAll('[data-suspend-med]').forEach(b => b.addEventListener('click', () => suspendMedConfirm(b.dataset.suspendMed)));
  root.querySelectorAll('[data-delete-med]').forEach(b => b.addEventListener('click', () => deleteMedConfirm(b.dataset.deleteMed)));
  root.querySelectorAll('[data-uso-med]').forEach(b => b.addEventListener('click', () => openMedUsoModal(b.dataset.usoMed, render)));
}

function renderMedCard(m) {
  const daysLeft = m.fechaFin ? daysFrom(m.fechaFin) : null;
  let ribbonCls = 'active', ribbonTxt = 'Activo';
  if (!m.activo) { ribbonCls = 'inactive'; ribbonTxt = 'Suspendido / Histórico'; }
  else if (daysLeft !== null && daysLeft >= 0 && daysLeft <= 7) { ribbonCls = 'ending'; ribbonTxt = `Finaliza en ${daysLeft} día${daysLeft !== 1 ? 's' : ''}`; }
  else if (daysLeft !== null && daysLeft < 0) { ribbonCls = 'inactive'; ribbonTxt = 'Período finalizado'; }

  const horarios = (m.horarios || []).filter(h => h?.hora).map(h =>
    `<span class="horario-chip">${esc(h.hora)}${h.dosis ? ' · ' + esc(h.dosis) : ''}</span>`
  ).join('');

  // Bloque de uso "a demanda": contador + último uso + botón USADO. Solo en
  // medicamentos activos con frecuencia "A demanda" (auditoría 2026-07-17).
  const esDemanda = m.frecuencia === DEMANDA;
  const uso = usageByMed[m.id];
  const usoN = uso?.count || 0;
  const usoBlock = (esDemanda && m.activo) ? `
    <div class="med-uso-block">
      <div class="med-uso-info">
        <span class="med-uso-count">${usoN}</span>
        <span class="med-uso-label">uso${usoN === 1 ? '' : 's'} registrado${usoN === 1 ? '' : 's'}${uso?.last ? ' · último ' + esc(fmtDateTime(uso.last)) : ''}</span>
      </div>
      <button class="btn btn-sm btn-uso" data-uso-med="${m.id}" title="Registrar un uso">USADO</button>
    </div>` : '';

  return `<div class="med-card ${m.activo ? '' : 'inactive'}${m.controlado ? ' controlado' : ''}">
    <div class="med-card-top">
      <div class="med-avatar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 6.5L6.5 10.5a5 5 0 007.07 7.07l4-4a5 5 0 00-7.07-7.07z"/></svg></div>
      <div style="flex:1;min-width:0">
        <div class="med-name">${esc(m.nombre)}${m.controlado ? '<span class="med-badge-controlado" title="Medicamento controlado">Controlado</span>' : ''}</div>
        <div class="med-via">${esc(m.via || '')}${m.version > 1 ? ' · v' + m.version : ''}</div>
      </div>
      <div class="med-card-actions">
        <button class="btn btn-sm btn-icon btn-ghost" data-edit-med="${m.id}" title="Editar"><svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5"/></svg></button>
        ${m.activo ? `<button class="btn btn-sm btn-icon" style="color:var(--amber-lt);background:var(--amber-dim);border-color:rgba(217,119,6,.25)" data-suspend-med="${m.id}" title="Suspender"><svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg></button>` : ''}
        <button class="btn btn-sm btn-icon btn-danger" data-delete-med="${m.id}" title="Eliminar"><svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862"/></svg></button>
      </div>
    </div>
    <div class="med-card-body">
      <div class="med-dosis-block">
        <div class="med-dosis-num">${esc(m.dosis || '—')}</div>
        <div><div class="med-dosis-unit">${esc(m.unidad || '')}</div><div class="med-dosis-freq">${esc(m.frecuencia || '')}</div></div>
      </div>
      ${m.indicacion ? `<div class="med-indicacion"><span class="med-indicacion-label">Para</span> ${esc(m.indicacion)}</div>` : ''}
      ${horarios ? `<div><div class="fl" style="margin-bottom:5px">Horarios</div><div class="horarios-row">${horarios}</div></div>` : ''}
      ${usoBlock}
      <div class="med-dates">
        <span>Inicio: <strong>${fmtDate(m.fechaInicio)}</strong></span>
        ${m.fechaFin ? `<span>Fin: <strong>${fmtDate(m.fechaFin)}</strong></span>` : ''}
      </div>
      ${m.observaciones ? `<div style="font-size:12px;color:var(--ts);background:var(--surface);border-radius:6px;padding:8px 10px;line-height:1.5">${esc(m.observaciones)}</div>` : ''}
    </div>
    <div class="med-status-ribbon ${ribbonCls}">${ribbonTxt}</div>
  </div>`;
}

async function toggleMedsHistory() {
  showHistory = !showHistory;
  document.getElementById('meds-history-section').style.display = showHistory ? 'block' : 'none';
  document.getElementById('btn-show-history').textContent = showHistory ? 'Ocultar historial' : 'Historial';
  if (showHistory) await renderMedsHistory();
}

async function renderMedsHistory() {
  const listEl = document.getElementById('meds-history-list');
  let all;
  try {
    all = await api.listMedsByPatient(state.activePatient.id);
  } catch (err) {
    showToast(err.message || 'No se pudo cargar el historial', 'err');
    listEl.innerHTML = errorStateHtml({ retryId: 'btn-retry-meds-history', style: 'padding:24px 0' });
    document.getElementById('btn-retry-meds-history').addEventListener('click', renderMedsHistory);
    return;
  }
  const inactive = all.filter(m => !m.activo).sort((a, b) => (b.version || 1) - (a.version || 1));
  document.getElementById('meds-hist-count').textContent = inactive.length;

  if (!inactive.length) {
    listEl.innerHTML = emptyStateHtml({ title: 'Sin registros en el historial aún', style: 'padding:24px 0' });
    return;
  }

  const groups = {};
  inactive.forEach(m => (groups[m.nombre] ||= []).push(m));

  document.getElementById('meds-history-list').innerHTML = Object.entries(groups).map(([name, items]) => {
    const sorted = items.sort((a, b) => (b.version || 1) - (a.version || 1));
    return `<div class="hist-group">
      <div class="hist-group-name">${esc(name)} <span style="font-size:11px;color:var(--ts);font-weight:400">${sorted.length} versión${sorted.length > 1 ? 'es' : ''}</span></div>
      <div class="hist-timeline">
        ${sorted.map((m, i) => `<div class="hist-item ${i === 0 ? 'current' : ''}">
          <div class="hist-item-head">
            <span class="hist-version">v${m.version || 1}</span>
            ${i === 0 ? '<span class="hist-badge">Última versión archivada</span>' : ''}
            <span class="hist-date">Inicio ${fmtDate(m.fechaInicio)}${m.fechaFin ? ' — ' + fmtDate(m.fechaFin) : ''}</span>
          </div>
          <div style="display:flex;gap:16px;font-size:12px;color:var(--ts);flex-wrap:wrap">
            <span><strong style="color:var(--tp)">${esc(m.dosis || '—')} ${esc(m.unidad || '')}</strong></span>
            <span>${esc(m.frecuencia || '—')}</span>
            ${m.via ? `<span>${esc(m.via)}</span>` : ''}
            ${(m.horarios || []).filter(h => h?.hora).length ? `<span>${m.horarios.filter(h => h?.hora).map(h => h.dosis ? `${esc(h.hora)} (${esc(h.dosis)})` : esc(h.hora)).join(' · ')}</span>` : ''}
          </div>
          ${m.observaciones ? `<div style="margin-top:5px;font-size:11.5px;color:var(--tm)">${esc(m.observaciones)}</div>` : ''}
          ${m.motivoCambio ? `<div style="margin-top:4px;font-size:11px;color:var(--amber)">↳ Motivo: ${esc(m.motivoCambio)}</div>` : ''}
        </div>`).join('')}
      </div>
    </div>`;
  }).join('');
}

/** Recalcula los horarios de la posición 1 en adelante a partir del
 * horario base (posición 0), espaciados cada `intervalHours` — se llama
 * al elegir/cambiar la frecuencia y al editar el horario base (P1.5:
 * "si se cambia el primer horario, los siguientes se recalculan
 * automáticamente"; ante una edición manual previa de un horario
 * intermedio, la base siempre manda y lo sobreescribe). */
function recalcularHorariosDesdeBase(intervalHours) {
  if (!medHorariosArr.length || !intervalHours) return;
  const base = medHorariosArr[0].hora || '00:00';
  medHorariosArr[0].hora = base;
  const [bh, bm] = base.split(':').map(Number);
  for (let i = 1; i < medHorariosArr.length; i++) {
    const totalMin = (bh * 60 + bm + i * intervalHours * 60) % (24 * 60);
    const hh = String(Math.floor(totalMin / 60)).padStart(2, '0');
    const mm = String(totalMin % 60).padStart(2, '0');
    medHorariosArr[i].hora = `${hh}:${mm}`;
  }
}

/** Ajusta la cantidad de filas al número que corresponde a la frecuencia
 * elegida y recalcula los horarios automáticos. No se llama al abrir el
 * modal (los horarios ya guardados se respetan tal cual), solo cuando la
 * persona cambia la frecuencia activamente. */
function applyFrequencyChange(freq) {
  const cfg = FREQ_CONFIG[freq];
  if (!freq || !cfg || cfg.rows === 0) return; // sin selección o "A demanda": no se autogeneran filas
  const prev = medHorariosArr;
  medHorariosArr = Array.from({ length: cfg.rows }, (_, i) => prev[i] ? { ...prev[i] } : { hora: '', dosis: '' });
  recalcularHorariosDesdeBase(cfg.intervalHours);
}

function currentFreqValue() {
  return document.getElementById('mf-freq')?.value || '';
}

function initHorariosBuilder(existing = [], freq) {
  medHorariosArr = existing.length ? existing.map(h => ({ hora: h.hora || '', dosis: h.dosis || '' })) : [];
  renderHorariosBuilder(freq);
}

function renderHorariosBuilder(freq) {
  const cont = document.getElementById('horarios-builder');
  const wrap = document.getElementById('horarios-builder-wrap');
  if (!cont || !wrap) return;

  wrap.classList.toggle('hidden', !freq);
  if (!freq) { cont.innerHTML = ''; return; }

  const cfg = FREQ_CONFIG[freq];
  const header = `<div class="horarios-builder-head"><span>Horario de toma</span><span>Dosis de ese horario</span></div>`;
  const rows = medHorariosArr.map((h, i) => `
    <div class="horarios-builder-row">
      <input class="fi" type="time" value="${esc(h.hora)}" data-horario-idx="${i}"/>
      <input class="fi" type="text" value="${esc(h.dosis)}" placeholder="Ej: 1 tableta, 500mg" data-horario-dosis-idx="${i}"/>
      <button class="btn btn-sm btn-icon btn-danger" type="button" data-remove-horario="${i}" title="Quitar"><svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M6 18L18 6M6 6l12 12"/></svg></button>
    </div>`).join('');
  const emptyMsg = !medHorariosArr.length
    ? `<p class="horarios-builder-empty-msg">${cfg?.rows === 0 ? 'Sin horarios fijos — agrega uno solo si quieres dejar una referencia.' : 'Sin horarios agregados.'}</p>`
    : '';

  cont.innerHTML = (medHorariosArr.length ? header : '') + rows + emptyMsg
    + `<button class="add-horario-btn" type="button" id="add-horario-btn">+ Agregar horario</button>`;

  cont.querySelectorAll('[data-horario-idx]').forEach(inp => inp.addEventListener('input', () => {
    const i = Number(inp.dataset.horarioIdx);
    medHorariosArr[i].hora = inp.value;
    if (i === 0) {
      recalcularHorariosDesdeBase(FREQ_CONFIG[currentFreqValue()]?.intervalHours);
      renderHorariosBuilder(currentFreqValue());
    }
  }));
  cont.querySelectorAll('[data-horario-dosis-idx]').forEach(inp => inp.addEventListener('input', () => {
    medHorariosArr[Number(inp.dataset.horarioDosisIdx)].dosis = inp.value;
  }));
  cont.querySelectorAll('[data-remove-horario]').forEach(btn => btn.addEventListener('click', () => {
    medHorariosArr.splice(Number(btn.dataset.removeHorario), 1);
    renderHorariosBuilder(currentFreqValue());
  }));
  document.getElementById('add-horario-btn')?.addEventListener('click', () => {
    medHorariosArr.push({ hora: '', dosis: '' });
    renderHorariosBuilder(currentFreqValue());
  });
}

export async function openMedModal(id, prefill = null) {
  let m = null, customVia, customUnidad;
  try {
    if (id) m = await api.getMed(id);
    [customVia, customUnidad] = await Promise.all([
      api.listCatalogOptions(state.household.id, CATEGORIA_VIA),
      api.listCatalogOptions(state.household.id, CATEGORIA_UNIDAD),
    ]);
  } catch (err) {
    showToast(err.message || 'No se pudo abrir el formulario del medicamento', 'err');
    return;
  }
  const isEdit = !!m;
  const willVersion = isEdit && m.activo;

  const knownVia = [...VIA_OPTIONS_FIJAS, ...customVia];
  // Compatibilidad: si el vía guardado no está en las fijas ni en el
  // catálogo (por ejemplo, un registro viejo con el "Otra" plano de antes
  // de este cambio), se preselecciona "Otra…" con el valor ya escrito.
  pendingViaOtra = !!(m?.via && !knownVia.includes(m.via));
  const viaSelected = pendingViaOtra ? OTRA_VALUE : (m?.via || '');

  const knownUnidad = [...UNIDAD_OPTIONS_FIJAS, ...customUnidad];
  pendingUnidadOtra = !!(m?.unidad && !knownUnidad.includes(m.unidad));
  const unidadSelected = pendingUnidadOtra ? OTRA_VALUE : (m?.unidad || '');

  showModal(
    isEdit ? (willVersion ? 'Editar medicamento — nueva versión' : 'Editar medicamento') : 'Nuevo medicamento',
    `<div class="form-body">
      ${willVersion ? `<div class="info-box" style="margin-bottom:4px">Si cambias dosis, unidad, frecuencia, vía u horarios se creará automáticamente una nueva versión. El registro anterior queda en el historial.</div>` : ''}
      <div class="form-row cols-2">
        ${liveSearchFieldHtml('mf-med', {
          label: 'Nombre del medicamento *',
          placeholder: 'Ej: Metformina, Enalapril, Aspirina…',
          span: true,
          hint: 'Se buscan los que ya registraste y, con conexión, el registro del INVIMA. Si no aparece, escríbelo y se guarda igual.',
        })}
        <div class="form-field span2">
          <label class="ck-row"><input type="checkbox" id="mf-controlado" ${m?.controlado ? 'checked' : ''}/> <span>Medicamento controlado</span></label>
        </div>
        ${liveSearchFieldHtml('mf-indic', {
          label: 'Indicación — enfermedad o síntoma que trata',
          placeholder: 'Ej: presión alta, diabetes, dolor de espalda…',
          span: true,
          hint: 'Puedes escribirlo como lo dices normalmente. Si no aparece en la lista, escríbelo y se guarda igual.',
        })}
        <div class="form-field"><label class="fl">Dosis diaria *</label><input class="fi" id="mf-dosis" type="text" placeholder="Ej: 500, 10, 0.25" value="${esc(m?.dosis || '')}"/></div>
        <div class="form-field"><label class="fl">Unidad</label><select class="fi" id="mf-unidad"><option value="">Seleccione unidad</option>${catalogOptionsHtml(UNIDAD_OPTIONS_FIJAS, customUnidad, unidadSelected)}</select></div>
        <div class="form-field ${pendingUnidadOtra ? '' : 'hidden'}" id="mf-unidad-otra-field"><label class="fl">Especificar unidad</label><input class="fi" id="mf-unidad-otra" type="text" placeholder="Ej: ampollas" value="${esc(pendingUnidadOtra ? m.unidad : '')}"/></div>
        <div class="form-field span2"><label class="fl">Frecuencia</label><select class="fi" id="mf-freq"><option value="">Seleccione frecuencia</option>${FREQ_OPTIONS.map(f => `<option ${m?.frecuencia === f ? 'selected' : ''}>${f}</option>`).join('')}</select></div>
        <div class="form-field span2 hidden" id="horarios-builder-wrap"><label class="fl">Horarios de toma</label><div class="horarios-builder" id="horarios-builder"></div></div>
        <div class="form-field"><label class="fl">Vía de administración</label><select class="fi" id="mf-via"><option value="">Seleccione vía de administración</option>${catalogOptionsHtml(VIA_OPTIONS_FIJAS, customVia, viaSelected)}</select></div>
        <div class="form-field ${pendingViaOtra ? '' : 'hidden'}" id="mf-via-otra-field"><label class="fl">Especificar vía</label><input class="fi" id="mf-via-otra" type="text" placeholder="Ej: Vía intraósea" value="${esc(pendingViaOtra ? m.via : '')}"/></div>
        ${dateRangeFieldHtml('mf-vigencia', { label: 'Vigencia (fin opcional)', span: true })}
        <div class="form-field span2"><label class="fl">Observaciones</label><textarea class="fi" id="mf-obs" rows="2" placeholder="Tomar con alimentos, no suspender sin consultar…">${esc(m?.observaciones || '')}</textarea></div>
        ${willVersion ? `<div class="form-field span2"><label class="fl">Motivo del cambio (opcional)</label><input class="fi" id="mf-motivo" type="text" placeholder="Ej: Ajuste de dosis por control médico 15/jun"/></div>` : ''}
      </div>
    </div>`,
    [
      { label: 'Cancelar', cls: 'btn', action: closeModal },
      { label: isEdit ? (willVersion ? 'Guardar nueva versión' : 'Guardar cambios') : 'Agregar medicamento', cls: 'btn btn-primary', action: () => saveMedForm(id) },
    ]
  );
  wireLiveSearch('mf-med', {
    buscar: (q) => buscarMedicamentos(q),
    // Un medicamento que no está en ningún registro debe poder guardarse
    // igual: hay preparaciones magistrales y productos importados que no
    // figuran en el INVIMA.
    permitirLibre: true,
    textoLibre: 'Registrar',
  });
  fillLiveSearch('mf-med', { label: m?.nombre || prefill?.nombre || '' });

  wireLiveSearch('mf-indic', {
    buscar: (q) => buscarSintomas(q),
    // Igual que el nombre del medicamento: la lista es una ayuda, no una
    // camisa de fuerza. Nadie puede quedarse sin registrar una indicación
    // porque no esté en la tabla.
    permitirLibre: true,
    textoLibre: 'Usar',
  });
  fillLiveSearch('mf-indic', { label: m?.indicacion || '' });

  wireDateRangeField('mf-vigencia');
  fillDateRangeField('mf-vigencia', m?.fechaInicio || (!m ? today() : ''), m?.fechaFin || '');

  document.getElementById('mf-freq').addEventListener('change', (e) => {
    applyFrequencyChange(e.target.value);
    renderHorariosBuilder(e.target.value);
  });
  document.getElementById('mf-via').addEventListener('change', (e) => {
    pendingViaOtra = e.target.value === OTRA_VALUE;
    document.getElementById('mf-via-otra-field').classList.toggle('hidden', !pendingViaOtra);
  });
  document.getElementById('mf-unidad').addEventListener('change', (e) => {
    pendingUnidadOtra = e.target.value === OTRA_VALUE;
    document.getElementById('mf-unidad-otra-field').classList.toggle('hidden', !pendingUnidadOtra);
  });

  initHorariosBuilder(m?.horarios || [], m?.frecuencia || '');
}

async function saveMedForm(editId) {
  if (!state.activePatient) return;
  const nombre = readLiveSearch('mf-med').texto;
  const dosis = document.getElementById('mf-dosis').value.trim();
  if (!nombre) { showToast('El nombre es obligatorio', 'err'); return; }
  if (!dosis) { showToast('La dosis diaria es obligatoria', 'err'); return; }

  const viaSel = document.getElementById('mf-via').value;
  if (viaSel === OTRA_VALUE && !document.getElementById('mf-via-otra').value.trim()) {
    showToast('Escribe la vía de administración', 'err'); return;
  }
  const unidadSel = document.getElementById('mf-unidad').value;
  if (unidadSel === OTRA_VALUE && !document.getElementById('mf-unidad-otra').value.trim()) {
    showToast('Escribe la unidad', 'err'); return;
  }
  const via = await resolveCatalogValue(state.household.id, CATEGORIA_VIA, viaSel, document.getElementById('mf-via-otra').value);
  const unidad = await resolveCatalogValue(state.household.id, CATEGORIA_UNIDAD, unidadSel, document.getElementById('mf-unidad-otra').value);
  const vigencia = readDateRangeField('mf-vigencia');

  const newData = {
    nombre, dosis,
    unidad,
    frecuencia: document.getElementById('mf-freq').value,
    horarios: medHorariosArr.filter(h => h.hora),
    via,
    // Solo el texto: la indicación se guarda como se lee. El código CIE-10
    // que pueda traer la opción elegida es una ayuda para estandarizar el
    // nombre, no un dato que esta tabla almacene (sí lo hace la sección de
    // condiciones crónicas del paciente, que tiene columna propia).
    indicacion: readLiveSearch('mf-indic').texto,
    controlado: document.getElementById('mf-controlado').checked,
    fechaInicio: vigencia.inicio,
    fechaFin: vigencia.fin,
    observaciones: document.getElementById('mf-obs').value.trim(),
  };
  const motivo = document.getElementById('mf-motivo')?.value?.trim() || '';

  try {
    if (editId) {
      const old = await api.getMed(editId);
      const coreChanged = old.activo && (
        old.dosis !== newData.dosis || old.unidad !== newData.unidad ||
        old.frecuencia !== newData.frecuencia || old.via !== newData.via ||
        JSON.stringify(old.horarios || []) !== JSON.stringify(newData.horarios)
      );
      if (coreChanged) {
        await api.updateMed(editId, { ...old, activo: false }, state.household.id, state.activePatient.id);
        await api.insertMed({
          ...newData, activo: true, version: (old.version || 1) + 1,
          medicamentoPadreId: old.medicamentoPadreId || old.id, motivoCambio: motivo,
        }, state.household.id, state.activePatient.id);
        showToast('Nueva versión creada y guardada');
      } else {
        await api.updateMed(editId, { ...old, ...newData }, state.household.id, state.activePatient.id);
        showToast('Medicamento actualizado');
      }
    } else {
      await api.insertMed({ ...newData, activo: true, version: 1 }, state.household.id, state.activePatient.id);
      showToast('Medicamento agregado');
    }
    closeModal();
    render();
    if (state.currentView === 'dashboard') {
      const { render: renderDashboard } = await import('./dashboard.js');
      renderDashboard();
    }
  } catch (err) {
    showToast(err.message || 'Error al guardar el medicamento', 'err');
  }
}

async function suspendMedConfirm(id) {
  if (!confirm('¿Suspender este medicamento? Se moverá al historial pero sus datos quedarán guardados.')) return;
  try {
    const m = await api.getMed(id);
    await api.updateMed(id, { ...m, activo: false, fechaFin: m.fechaFin || today() }, state.household.id, state.activePatient.id);
    showToast('Medicamento suspendido', 'warn');
    render();
  } catch (err) {
    showToast(err.message || 'Error al suspender el medicamento', 'err');
  }
}

async function deleteMedConfirm(id) {
  if (!confirm('¿Eliminar este medicamento permanentemente? Esta acción no se puede deshacer.')) return;
  try {
    await api.deleteMed(id);
    showToast('Medicamento eliminado', 'warn');
    render();
  } catch (err) {
    showToast(err.message || 'Error al eliminar el medicamento', 'err');
  }
}

// ─────────────────────────────────────────
// Registro de uso "a demanda" (auditoría 2026-07-17)
// Se invoca desde la tarjeta del medicamento y desde el widget del
// dashboard. `onDone` refresca la vista de origen tras registrar/eliminar
// un uso. Exportado para que el dashboard lo reutilice.
// ─────────────────────────────────────────
export async function openMedUsoModal(medId, onDone) {
  if (!state.activePatient) return;
  let m, eventos;
  try {
    m = await api.getMed(medId);
    eventos = (await api.listMedUsageByPatient(state.activePatient.id)).filter(e => e.medicationId === medId);
  } catch (err) {
    showToast(err.message || 'No se pudo abrir el registro de uso', 'err');
    return;
  }
  renderUsoModal(m, eventos, onDone);
}

/**
 * Motivos que ya se registraron para este medicamento, del más reciente al
 * más viejo y sin repetir — Fase 3, desplegable "Cómo se ha usado".
 *
 * Las opciones salen del propio historial y no de un catálogo del household
 * (como sí hacen Vía o Unidad): un motivo de uso es específico del
 * medicamento — "subida de tensión" no tiene sentido ofrecerlo al registrar
 * un analgésico. La indicación del medicamento se suma de primera porque es
 * la razón por la que existe la fórmula, y suele ser la respuesta.
 */
function motivosPrevios(m, eventos) {
  const vistos = new Set();
  const opciones = [];
  const agregar = (razon) => {
    const texto = (razon || '').trim();
    // El valor del <select> es el propio texto, así que un motivo guardado
    // que fuera idéntico al centinela de "Por otro motivo…" sería
    // indistinguible de él. Improbable, pero se descarta y no se pierde
    // nada: sigue estando en el historial de abajo.
    if (!texto || texto === OTRA_VALUE) return;
    const clave = normalizar(texto);
    if (vistos.has(clave)) return;
    vistos.add(clave);
    opciones.push(texto);
  };
  agregar(m.indicacion);
  // `eventos` viene del más viejo al más nuevo; se recorre al revés para que
  // lo último que se usó quede arriba, que es lo más probable que se repita.
  [...eventos].reverse().forEach(e => agregar(e.razon));
  return opciones;
}

function renderUsoModal(m, eventos, onDone) {
  const motivos = motivosPrevios(m, eventos);
  // Sin historial no se muestra el desplegable: un <select> cuya única
  // opción es "Por otro motivo…" no ofrece nada, solo un clic de más.
  const campoRazonHtml = motivos.length ? `
      <div class="form-field">
        <label class="fl">¿Por qué se usó ahora? *</label>
        <select class="fi" id="uso-razon-sel">
          <option value="">Seleccione el motivo</option>
          ${motivos.map(o => `<option>${esc(o)}</option>`).join('')}
          <option value="${OTRA_VALUE}">Por otro motivo…</option>
        </select>
      </div>
      <div class="form-field hidden" id="uso-razon-otra-field">
        <label class="fl">¿Cuál fue el motivo? *</label>
        <textarea class="fi" id="uso-razon" rows="3" placeholder="Ej: Subida de tensión 145/95, crisis convulsiva de más de 3 min, dolor agudo en el pecho, glucosa alta 240…"></textarea>
      </div>` : `
      <div class="form-field">
        <label class="fl">¿Por qué se usó ahora? *</label>
        <textarea class="fi" id="uso-razon" rows="3" placeholder="Ej: Subida de tensión 145/95, crisis convulsiva de más de 3 min, dolor agudo en el pecho, glucosa alta 240…"></textarea>
      </div>`;

  const listaHtml = eventos.length ? `
    <div class="uso-list">
      <div class="fl" style="margin-bottom:6px">Usos registrados (${eventos.length})</div>
      ${eventos.map(e => `<div class="uso-item">
        <div style="flex:1;min-width:0">
          <div class="uso-item-date">${esc(fmtDateTime(e.usadoEn))}</div>
          <div class="uso-item-razon">${esc(e.razon)}</div>
        </div>
        <button class="btn btn-sm btn-icon btn-danger" data-del-uso="${e.id}" title="Eliminar apunte"><svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6"/></svg></button>
      </div>`).join('')}
    </div>` : '<p style="font-size:12.5px;color:var(--ts);margin:2px 0 0">Aún no hay usos registrados para este medicamento.</p>';

  showModal(
    'Registrar uso — ' + m.nombre,
    `<div class="form-body">
      ${campoRazonHtml}
      <p style="font-size:11px;color:var(--tm);margin:5px 0 0">Se guarda con la fecha y hora actuales.</p>
      ${listaHtml}
    </div>`,
    [
      { label: 'Cerrar', cls: 'btn', action: () => { closeModal(); onDone?.(); } },
      { label: 'Registrar uso', cls: 'btn btn-primary', action: () => saveUso(m.id, onDone) },
    ]
  );
  document.querySelectorAll('[data-del-uso]').forEach(b =>
    b.addEventListener('click', () => deleteUso(b.dataset.delUso, m.id, onDone)));

  const sel = document.getElementById('uso-razon-sel');
  sel?.addEventListener('change', () => {
    const otra = sel.value === OTRA_VALUE;
    document.getElementById('uso-razon-otra-field').classList.toggle('hidden', !otra);
    if (otra) document.getElementById('uso-razon').focus();
  });
  setTimeout(() => (sel || document.getElementById('uso-razon'))?.focus(), 50);
}

/** Motivo elegido: la opción del desplegable, o lo escrito si se eligió
 *  "Por otro motivo…" (o si no había desplegable por falta de historial). */
function leerRazonUso() {
  const sel = document.getElementById('uso-razon-sel');
  if (sel && sel.value !== OTRA_VALUE) return sel.value.trim();
  return document.getElementById('uso-razon')?.value.trim() || '';
}

async function saveUso(medId, onDone) {
  const razon = leerRazonUso();
  if (!razon) { showToast('Indica por qué se usó el medicamento', 'err'); return; }
  try {
    await api.addMedUsageEvent({ medicationId: medId, razon }, state.household.id, state.activePatient.id);
    showToast('Uso registrado');
    onDone?.();
    await refreshUsoModal(medId, onDone);
  } catch (err) {
    showToast(err.message || 'Error al registrar el uso', 'err');
  }
}

async function deleteUso(usoId, medId, onDone) {
  if (!confirm('¿Eliminar este apunte de uso?')) return;
  try {
    await api.deleteMedUsageEvent(usoId);
    showToast('Apunte eliminado', 'warn');
    onDone?.();
    await refreshUsoModal(medId, onDone);
  } catch (err) {
    showToast(err.message || 'Error al eliminar el apunte', 'err');
  }
}

/** Re-pinta el modal con los apuntes actualizados sin cerrarlo. */
async function refreshUsoModal(medId, onDone) {
  try {
    const m = await api.getMed(medId);
    const eventos = (await api.listMedUsageByPatient(state.activePatient.id)).filter(e => e.medicationId === medId);
    renderUsoModal(m, eventos, onDone);
  } catch { /* si falla el refresco, el modal anterior queda visible */ }
}
