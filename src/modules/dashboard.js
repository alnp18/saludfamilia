import { state } from '../state.js';
import { ThemeEngine } from '../lib/theme.js';
import * as api from '../lib/api.js';
import { esc, initials, avatarColor, fmtDate, today, daysFrom, calcAge } from '../lib/utils.js';
import { hydrateAvatar } from '../lib/avatar.js';
import { showToast } from '../lib/modal.js';
import { emptyStateHtml, errorStateHtml } from '../lib/emptyState.js';
import { Icons } from '../lib/icons.js';

let calYear, calMonth;
let clockTimer = null;
let calEventDates = [];

function initCalIfNeeded() {
  if (calYear == null) {
    const n = new Date();
    calYear = n.getFullYear();
    calMonth = n.getMonth();
  }
}

const MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const MONTHS_SHORT = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const DOW = ['Do','Lu','Ma','Mi','Ju','Vi','Sá'];

function renderMiniCal() {
  const todayStr = today();
  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const daysInPrev = new Date(calYear, calMonth, 0).getDate();

  const titleEl = document.getElementById('cal-title');
  if (titleEl) titleEl.textContent = `${MONTHS_ES[calMonth]} ${calYear}`;

  let cells = '';
  DOW.forEach(d => cells += `<div class="cal-dow">${d}</div>`);
  for (let i = firstDay - 1; i >= 0; i--) cells += `<div class="cal-day other-month">${daysInPrev - i}</div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isToday = iso === todayStr;
    const hasEvent = calEventDates.includes(iso);
    cells += `<div class="cal-day ${isToday ? 'today' : ''} ${hasEvent ? 'has-event' : ''}">${d}</div>`;
  }
  const total = firstDay + daysInMonth;
  const rem = total % 7 === 0 ? 0 : 7 - (total % 7);
  for (let d = 1; d <= rem; d++) cells += `<div class="cal-day other-month">${d}</div>`;

  const grid = document.getElementById('mini-cal');
  if (grid) grid.innerHTML = `<div class="mini-cal-grid">${cells}</div>`;
}

function calNav(dir) {
  calMonth += dir;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  if (calMonth < 0) { calMonth = 11; calYear--; }
  renderMiniCal();
}

function startClock() {
  clearInterval(clockTimer);
  function tick() {
    const el = document.getElementById('dpb-time');
    if (el) el.textContent = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  }
  tick();
  clockTimer = setInterval(tick, 10000);
}

function calcStage(o) {
  if (o.cita_fecha && o.estadoCita === 'Finalizado') return 'Finalizado';
  if (o.cita_fecha) return 'D';
  if (o.auth_numero || o.auth_fechaInicio) return 'C';
  if (o.solicitud_numero || o.solicitud_fecha) return 'B';
  return 'A';
}

const STAGE_ORDER = ['A', 'B', 'C', 'D'];
const STAGE_LABELS = { A: 'Orden', B: 'Solicitud', C: 'Autorización', D: 'Cita' };

let goViewCb = null;
/** main.js inyecta la función de navegación para no crear un ciclo de imports rígido */
export function setNavigator(fn) { goViewCb = fn; }

export async function render() {
  const container = document.getElementById('view-dashboard');
  if (!container) return;

  if (!state.activePatient) {
    container.innerHTML = emptyStateHtml({
      icon: Icons.users,
      title: 'Ningún paciente seleccionado',
      message: 'Crea o selecciona un paciente para ver su dashboard.',
      action: { id: 'dash-goto-patients', label: 'Gestionar pacientes' },
    });
    document.getElementById('dash-goto-patients')?.addEventListener('click', () => goViewCb?.('patients'));
    return;
  }

  const patient = state.activePatient;
  let orders, meds, doctors, centers;
  try {
    [orders, meds, doctors, centers] = await Promise.all([
      api.listOrdersByPatient(patient.id),
      api.listMedsByPatient(patient.id),
      api.listDoctors(state.household.id),
      api.listCenters(state.household.id),
    ]);
  } catch (err) {
    showToast(err.message || 'No se pudo cargar el dashboard', 'err');
    container.innerHTML = errorStateHtml({ retryId: 'btn-retry-dashboard' });
    document.getElementById('btn-retry-dashboard').addEventListener('click', () => render());
    return;
  }
  const docMap = Object.fromEntries(doctors.map(d => [d.id, d]));
  orders.forEach(o => { o._stage = o._stage || calcStage(o); });

  const age = patient.fechaNacimiento ? calcAge(patient.fechaNacimiento) + ' años' : '';
  const avc = avatarColor(patient.nombre);
  const now = new Date();
  const dayName = now.toLocaleDateString('es-CO', { weekday: 'long' });
  const dateStr = now.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
  const themeSpec = ThemeEngine.generate(patient);
  const dpbGrad = themeSpec ? themeSpec['--theme-gradient'] : 'var(--t-gradient)';

  const pending = orders.filter(o => o._stage === 'A').length;
  const withCita = orders.filter(o => o.cita_fecha && daysFrom(o.cita_fecha) >= 0 && daysFrom(o.cita_fecha) <= 30).length;
  const authExp = orders.filter(o => o.auth_fechaVence && daysFrom(o.auth_fechaVence) !== null && daysFrom(o.auth_fechaVence) >= 0 && daysFrom(o.auth_fechaVence) <= 15).length;
  const activeMed = meds.filter(m => m.activo).length;

  // ── ALERTS ──
  const alerts = [];
  orders.forEach(o => {
    if (o._stage === 'Finalizado') return;
    if (o.auth_fechaVence) {
      const d = daysFrom(o.auth_fechaVence);
      if (d < 0) alerts.push({ priority: 0, cls: 'alert-red', title: 'Autorización VENCIDA', sub: `${esc(o.descripcion || 'Orden')} — venció el ${fmtDate(o.auth_fechaVence)}`, id: o.id });
      else if (d <= 5) alerts.push({ priority: 1, cls: 'alert-red', title: `Autorización vence en ${d} día${d === 1 ? '' : 's'}`, sub: `${esc(o.descripcion || 'Orden')} — vence ${fmtDate(o.auth_fechaVence)}`, id: o.id });
      else if (d <= 15) alerts.push({ priority: 2, cls: 'alert-amber', title: `Autorización vence en ${d} días`, sub: `${esc(o.descripcion || 'Orden')} — vence ${fmtDate(o.auth_fechaVence)}`, id: o.id });
    }
    if (o._stage === 'A') alerts.push({ priority: 3, cls: 'alert-red', title: 'Orden sin tramitar', sub: `${esc(o.descripcion || 'Sin descripción')} — generada ${fmtDate(o.fechaOrden)}`, id: o.id });
    if (o.cita_fecha) {
      const d = daysFrom(o.cita_fecha);
      if (d !== null && d >= 0 && d <= 3) alerts.push({ priority: 1, cls: 'alert-teal', title: `Cita en ${d === 0 ? 'HOY' : d === 1 ? 'mañana' : d + ' días'}`, sub: `${esc(o.descripcion || 'Cita médica')} — ${fmtDate(o.cita_fecha)} ${o.cita_hora || ''}`, id: o.id });
    }
  });
  alerts.sort((a, b) => a.priority - b.priority);

  // ── UPCOMING ──
  const upcoming = orders
    .filter(o => o.cita_fecha && daysFrom(o.cita_fecha) !== null && daysFrom(o.cita_fecha) >= 0 && daysFrom(o.cita_fecha) <= 60)
    .sort((a, b) => a.cita_fecha.localeCompare(b.cita_fecha))
    .slice(0, 6);

  // ── PIPELINE ──
  const activeOrders = orders.filter(o => o._stage !== 'Finalizado');

  // ── CALENDAR EVENTS ──
  calEventDates = orders
    .filter(o => o.cita_fecha && daysFrom(o.cita_fecha) !== null && daysFrom(o.cita_fecha) >= 0)
    .map(o => o.cita_fecha);
  initCalIfNeeded();

  const fields = [
    ['Fecha de nac.', patient.fechaNacimiento ? fmtDate(patient.fechaNacimiento) : '—'],
    ['Edad', age || '—'],
    ['Tipo de sangre', patient.tipoSangre || '—'],
    ['EPS', patient.eps || '—'],
    ['No. afiliado', patient.numeroAfiliado || '—'],
    ['Contacto emerg.', patient.contactoEmergencia || '—'],
  ].filter(([, v]) => v !== '—');

  container.innerHTML = `
    <div class="dpb" id="dash-patient-bar">
      <div class="dpb-avatar" data-avatar-id="${patient.id}" style="background:${dpbGrad};font-size:22px;">${initials(patient.nombre)}</div>
      <div>
        <div class="dpb-title">Hola · ${esc(patient.primerNombre || patient.nombre.split(' ')[0])}</div>
        <div class="dpb-sub">${esc(patient.nombre)}</div>
        <div class="dpb-chips">
          ${age ? `<span class="dpb-chip">${age}</span>` : ''}
          ${patient.tipoSangre ? `<span class="dpb-chip">${esc(patient.tipoSangre)}</span>` : ''}
          ${patient.eps ? `<span class="dpb-chip">${esc(patient.eps)}</span>` : ''}
          ${patient.sexo ? `<span class="dpb-chip">${esc(patient.sexo)}</span>` : ''}
        </div>
      </div>
      <div class="dpb-right">
        <div class="dpb-date">${dayName.charAt(0).toUpperCase() + dayName.slice(1)}, ${dateStr}</div>
        <div class="dpb-time" id="dpb-time"></div>
      </div>
    </div>

    <div class="dash-kpi">
      <div class="dash-stat" data-goto="orders"><div class="dash-stat-ic" style="background:var(--t-primary-dim)"><svg viewBox="0 0 24 24" fill="none" stroke="var(--t-primary-lt)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div><div><div class="dash-stat-n">${withCita}</div><div class="dash-stat-l">Citas próximas</div></div></div>
      <div class="dash-stat" data-goto="orders"><div class="dash-stat-ic" style="background:var(--amber-dim)"><svg viewBox="0 0 24 24" fill="none" stroke="var(--amber-lt)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div><div><div class="dash-stat-n">${authExp}</div><div class="dash-stat-l">Auth por vencer</div></div></div>
      <div class="dash-stat" data-goto="orders"><div class="dash-stat-ic" style="background:var(--red-dim)"><svg viewBox="0 0 24 24" fill="none" stroke="var(--red-lt)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></div><div><div class="dash-stat-n">${pending}</div><div class="dash-stat-l">Sin tramitar</div></div></div>
      <div class="dash-stat" data-goto="meds"><div class="dash-stat-ic" style="background:var(--purple-dim)"><svg viewBox="0 0 24 24" fill="none" stroke="var(--purple-lt)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 6.5L6.5 10.5a5 5 0 007.07 7.07l4-4a5 5 0 00-7.07-7.07z"/><line x1="14" y1="10" x2="10" y2="14"/></svg></div><div><div class="dash-stat-n">${activeMed}</div><div class="dash-stat-l">Medicamentos</div></div></div>
    </div>

    <div class="dash3">
      <div style="display:flex;flex-direction:column;gap:14px;grid-column:span 2">
        ${alerts.length ? `<div class="card">
          <div class="card-hd"><div class="card-icon" style="background:var(--red-dim);color:var(--red-lt)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div><h2>Alertas</h2><span class="card-meta">${alerts.length} alerta${alerts.length > 1 ? 's' : ''}</span></div>
          <div style="padding:12px 18px;display:flex;flex-direction:column;gap:7px">
            ${alerts.map(a => `<div class="alert-item ${a.cls}" data-order-id="${a.id}">
              <svg class="alert-icon" width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>
              <div class="alert-msg"><strong>${a.title}</strong><span>${a.sub}</span></div>
            </div>`).join('')}
          </div>
        </div>` : ''}
        <div class="card">
          <div class="card-hd"><div class="card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div><h2>Próximas citas</h2>
            <button class="btn btn-sm" id="dash-new-order" style="margin-left:auto">+ Nueva orden</button>
          </div>
          <div style="padding:12px 18px">
            ${!upcoming.length ? `<div class="empty-state" style="padding:24px 0"><p>Sin citas en los próximos 60 días</p></div>` : upcoming.map(o => {
              const d = daysFrom(o.cita_fecha);
              const [, m, day] = o.cita_fecha.split('-');
              const urgent = d <= 2;
              const doc = docMap[o.medicoId_cita] || docMap[o.medicoId];
              const label = d === 0 ? 'Hoy' : d === 1 ? 'Mañana' : `En ${d}d`;
              return `<div class="upcoming-item" data-order-id="${o.id}">
                <div class="udate ${urgent ? 'urgent' : ''}"><span class="udate-day">${parseInt(day)}</span><span class="udate-mon">${MONTHS_SHORT[parseInt(m) - 1]}</span></div>
                <div class="uinfo"><div class="uinfo-title">${esc(o.descripcion || o.tipoOrden || 'Cita médica')}</div><div class="uinfo-sub">${o.cita_hora ? o.cita_hora + ' · ' : ''}${doc ? esc(doc.nombre) : ''}${o.cita_consultorio ? ' · ' + esc(o.cita_consultorio) : ''}</div></div>
                <span class="tag ${urgent ? 'tag-red' : 'tag-teal'}">${label}</span>
              </div>`;
            }).join('')}
          </div>
        </div>
        <div class="card">
          <div class="card-hd"><div class="card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2"/></svg></div><h2>Estado de órdenes</h2><span class="card-meta">${activeOrders.length} activa${activeOrders.length !== 1 ? 's' : ''}</span></div>
          <div style="padding:12px 18px">
            ${!activeOrders.length ? `<div class="empty-state" style="padding:18px 0"><p>Sin órdenes activas</p></div>` : `<div class="pipeline-strip">${STAGE_ORDER.map(s => {
              const items = activeOrders.filter(o => o._stage === s);
              const itemsHtml = items.length
                ? items.map(o => `<div class="pipe-item" data-order-id="${o.id}"><div class="pipe-item-title">${esc(o.descripcion || o.tipoOrden || 'Orden')}</div><div style="font-size:10.5px;color:var(--ts)">${fmtDate(o.fechaOrden)}</div></div>`).join('')
                : `<div style="font-size:11px;color:var(--tm);text-align:center;padding:8px 0">—</div>`;
              return `<div class="pipe-col"><div class="pipe-col-label">${STAGE_LABELS[s]}<span class="pipe-count">${items.length}</span></div>${itemsHtml}</div>`;
            }).join('')}</div>`}
          </div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:14px">
        <div class="card">
          <div class="card-hd"><div class="card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div><h2 id="cal-title">Mes</h2>
            <div style="margin-left:auto;display:flex;gap:2px">
              <button class="btn btn-sm btn-icon btn-ghost" id="cal-prev"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg></button>
              <button class="btn btn-sm btn-icon btn-ghost" id="cal-next"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg></button>
            </div>
          </div>
          <div style="padding:10px 14px 14px" id="mini-cal"></div>
        </div>
        <div class="card">
          <div class="card-hd"><div class="card-icon" style="background:var(--purple-dim);color:var(--purple-lt)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></div><h2>Acciones rápidas</h2></div>
          <div style="padding:10px 14px">
            <div class="quick-action" id="qa-new-order"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/><path d="M9 14l2 2 4-4"/></svg> Nueva orden médica</div>
            <div class="quick-action" data-goto="orders"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg> Ver todas las órdenes</div>
            <div class="quick-action" id="qa-new-med"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 6.5L6.5 10.5a5 5 0 007.07 7.07l4-4a5 5 0 00-7.07-7.07z"/><line x1="14" y1="10" x2="10" y2="14"/></svg> Agregar medicamento</div>
            <div class="quick-action" id="qa-new-vital"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> Registrar signos vitales</div>
          </div>
        </div>
        ${fields.length ? `<div class="card">
          <div class="card-hd"><div class="card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div><h2>Datos del paciente</h2>
            <button class="btn btn-sm" id="dash-edit-patient" style="margin-left:auto">Editar</button>
          </div>
          <div style="padding:8px 16px 12px">
            ${fields.map(([l, v]) => `<div class="pir"><span class="pir-label">${l}</span><span class="pir-val">${esc(v)}</span></div>`).join('')}
            ${patient.notas ? `<div style="margin-top:10px;font-size:12px;color:var(--ts);line-height:1.5;background:var(--surface);border-radius:6px;padding:8px 10px">${esc(patient.notas)}</div>` : ''}
          </div>
        </div>` : ''}
      </div>
    </div>
  `;

  startClock();
  renderMiniCal();
  hydrateAvatar(document.getElementById('dash-patient-bar')?.querySelector('[data-avatar-id]'), patient);

  container.querySelectorAll('[data-goto]').forEach(el =>
    el.addEventListener('click', () => goViewCb?.(el.dataset.goto)));
  container.querySelectorAll('[data-order-id]').forEach(el =>
    el.addEventListener('click', () => goViewCb?.('orders', { openOrderId: el.dataset.orderId })));
  document.getElementById('dash-new-order')?.addEventListener('click', () => goViewCb?.('orders', { openWizard: true }));
  document.getElementById('qa-new-order')?.addEventListener('click', () => goViewCb?.('orders', { openWizard: true }));
  document.getElementById('qa-new-med')?.addEventListener('click', () => goViewCb?.('meds', { openModal: true }));
  document.getElementById('qa-new-vital')?.addEventListener('click', () => goViewCb?.('vitals', { openModal: true }));
  document.getElementById('dash-edit-patient')?.addEventListener('click', () => goViewCb?.('patients'));
  document.getElementById('cal-prev')?.addEventListener('click', () => calNav(-1));
  document.getElementById('cal-next')?.addEventListener('click', () => calNav(1));
}
