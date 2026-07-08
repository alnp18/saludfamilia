import { state } from '../state.js';
import * as api from '../lib/api.js';
import { showModal, closeModal, showToast, setModalMaxWidth } from '../lib/modal.js';
import { esc, fmtDate, today, daysFrom } from '../lib/utils.js';

const ORDER_TYPES = ['Cita de control', 'Nueva especialidad', 'Medicamento', 'Suministro médico', 'Examen', 'Laboratorio', 'Otro'];
const STAGE_ORDER = ['A', 'B', 'C', 'D', 'Finalizado'];
const STAGE_LABELS = { A: 'Orden', B: 'Solicitud', C: 'Autorización', D: 'Cita', Finalizado: 'Finalizado' };

let activeFilter = 'all';
let orderFiles = { orden: null, solicitud: null, autorizacion: null };
let pendingOptions = null; // { openWizard, openOrderId } pasado desde goView

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
    <div class="filter-pills" id="orders-filters"></div>
    <div id="orders-list" style="display:flex;flex-direction:column;gap:12px"></div>
  `;
  document.getElementById('btn-new-order').addEventListener('click', () => openOrderWizard());

  const sub = document.getElementById('orders-sub');
  const list = document.getElementById('orders-list');
  const filtersEl = document.getElementById('orders-filters');

  if (!state.activePatient) {
    sub.textContent = 'Selecciona un paciente para ver sus órdenes';
    filtersEl.innerHTML = '';
    list.innerHTML = `<div class="empty-state"><div class="es-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg></div><h3>Selecciona un paciente</h3></div>`;
    document.getElementById('sb-badge-orders').style.display = 'none';
    return;
  }
  sub.textContent = `Órdenes de ${state.activePatient.nombre}`;

  const orders = await api.listOrdersByPatient(state.activePatient.id);

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

  const filtered = activeFilter === 'all' ? orders : orders.filter(o => o._stage === activeFilter);

  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state">
      <svg width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.2"><path stroke-linecap="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z"/></svg>
      <h3>${orders.length ? 'Sin resultados para este filtro' : 'Sin órdenes registradas'}</h3>
      <p>${orders.length ? 'Prueba con otro filtro de etapa.' : 'Registra la primera orden médica de ' + esc(state.activePatient.nombre) + '.'}</p>
      ${!orders.length ? '<button class="btn btn-primary" id="btn-new-order-empty" style="margin-top:8px">Nueva orden</button>' : ''}
    </div>`;
    document.getElementById('btn-new-order-empty')?.addEventListener('click', () => openOrderWizard());
  } else {
    const doctors = await api.listDoctors(state.household.id);
    const docMap = Object.fromEntries(doctors.map(d => [d.id, d]));
    list.innerHTML = filtered.map(o => renderOrderCard(o, docMap)).join('');
    list.querySelectorAll('[data-edit-order]').forEach(b => b.addEventListener('click', () => openOrderWizard(b.dataset.editOrder)));
    list.querySelectorAll('[data-delete-order]').forEach(b => b.addEventListener('click', () => deleteOrderConfirm(b.dataset.deleteOrder)));
  }

  // Manejar navegación entrante desde el dashboard
  if (pendingOptions?.openWizard) { pendingOptions = null; openOrderWizard(); }
  else if (pendingOptions?.openOrderId) { const id = pendingOptions.openOrderId; pendingOptions = null; openOrderWizard(id); }
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

  return `<div class="order-card">
    <div class="order-card-top">
      <div class="order-type-ic"><svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="var(--t-primary-lt)" stroke-width="1.7"><path stroke-linecap="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z"/></svg></div>
      <div style="flex:1;min-width:0">
        <div class="order-title">${esc(o.tipoOrden || 'Orden médica')}${doc ? ' · ' + esc(doc.nombre) : ''}</div>
        <div class="order-sub">${esc(o.descripcion || 'Sin descripción')} · Generada ${fmtDate(o.fechaOrden)}</div>
      </div>
      <div class="order-card-actions">
        <button class="btn btn-sm btn-icon btn-ghost" data-edit-order="${o.id}" title="Editar"><svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5"/></svg></button>
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
  await api.deleteOrder(id);
  showToast('Orden eliminada', 'warn');
  render();
}

function readFileAsDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

async function handleFileInput(inputEl, slot) {
  const file = inputEl.files[0];
  if (!file) return;
  if (file.size > 4 * 1024 * 1024) { showToast('Archivo muy grande (máx. 4MB)', 'err'); return; }
  const dataUrl = await readFileAsDataURL(file);
  orderFiles[slot] = { name: file.name, type: file.type, data: dataUrl };
  renderFilePreview(slot);
}

function renderFilePreview(slot) {
  const el = document.getElementById(`fp-${slot}`);
  const f = orderFiles[slot];
  if (!el) return;
  if (!f) { el.innerHTML = ''; return; }
  const isImg = f.type.startsWith('image/');
  el.innerHTML = `<div class="file-preview">
    ${isImg ? `<img src="${f.data}" style="width:32px;height:32px;object-fit:cover;border-radius:4px"/>` : `<div class="fp-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/></svg></div>`}
    <div class="fp-name">${esc(f.name)}</div>
    <span class="fp-remove" data-remove-slot="${slot}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span>
  </div>`;
  el.querySelector('[data-remove-slot]')?.addEventListener('click', () => { orderFiles[slot] = null; renderFilePreview(slot); });
}

async function openOrderWizard(id) {
  orderFiles = { orden: null, solicitud: null, autorizacion: null };

  if (!state.activePatient) { showToast('Selecciona un paciente primero', 'err'); return; }

  const doctors = await api.listDoctors(state.household.id);
  const centers = await api.listCenters(state.household.id);
  let o = null;
  if (id) {
    o = await api.getOrder(id);
    if (o.orden_archivo) orderFiles.orden = o.orden_archivo;
    if (o.solicitud_imagen) orderFiles.solicitud = o.solicitud_imagen;
    if (o.auth_imagen) orderFiles.autorizacion = o.auth_imagen;
  }

  const docOptions = doctors.map(d => `<option value="${d.id}" ${o?.medicoId === d.id ? 'selected' : ''}>${esc(d.nombre)}${d.especialidad ? ' — ' + esc(d.especialidad) : ''}</option>`).join('');
  const docOptionsCita = doctors.map(d => `<option value="${d.id}" ${o?.medicoId_cita === d.id ? 'selected' : ''}>${esc(d.nombre)}${d.especialidad ? ' — ' + esc(d.especialidad) : ''}</option>`).join('');
  const centerOptions = centers.map(c => `<option value="${c.id}" ${o?.auth_centroId === c.id ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('');

  const body = `
    <div class="wiz-tabs" id="wiz-tabs">
      <button class="wiz-tab active" data-t="a" type="button"><span class="wiz-dot"></span>A · Orden</button>
      <button class="wiz-tab" data-t="b" type="button"><span class="wiz-dot"></span>B · Solicitud</button>
      <button class="wiz-tab" data-t="c" type="button"><span class="wiz-dot"></span>C · Autorización</button>
      <button class="wiz-tab" data-t="d" type="button"><span class="wiz-dot"></span>D · Cita</button>
    </div>
    <div class="wiz-pane visible" id="pane-a">
      <div class="form-row cols-2">
        <div class="form-field"><label class="fl">Médico tratante</label><select class="fi" id="of-medico"><option value="">Seleccionar médico…</option>${docOptions}</select></div>
        <div class="form-field"><label class="fl">Fecha de la orden</label><input class="fi" id="of-fecha" type="date"/></div>
        <div class="form-field span2"><label class="fl">Tipo de orden</label><select class="fi" id="of-tipo"><option value="">Seleccionar…</option>${ORDER_TYPES.map(t => `<option ${o?.tipoOrden === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="form-field span2"><label class="fl">Descripción</label><textarea class="fi" id="of-desc" rows="2" placeholder="Descripción de la orden…">${esc(o?.descripcion || '')}</textarea></div>
        <div class="form-field span2"><label class="fl">Archivo PDF de la orden</label>
          <div class="file-drop" id="drop-orden">Haz clic para subir PDF o imagen</div>
          <input type="file" id="of-file" accept=".pdf,image/*" style="display:none"/>
          <div id="fp-orden"></div>
        </div>
      </div>
    </div>
    <div class="wiz-pane" id="pane-b">
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
    <div class="wiz-pane" id="pane-c">
      <div class="form-row cols-2">
        <div class="form-field"><label class="fl">Fecha de inicio</label><input class="fi" id="of-auth-inicio" type="date"/></div>
        <div class="form-field"><label class="fl">Fecha de vencimiento</label><input class="fi" id="of-auth-vence" type="date"/></div>
        <div class="form-field span2"><label class="fl">Número de autorización</label><input class="fi" id="of-auth-num" type="text" placeholder="AUT-2025-XXXXX" style="font-family:'JetBrains Mono',monospace"/></div>
        <div class="form-field span2"><label class="fl">Centro médico</label><select class="fi" id="of-auth-centro"><option value="">Seleccionar centro…</option>${centerOptions}</select></div>
        <div class="form-field span2"><label class="fl">Imagen de la autorización</label>
          <div class="file-drop" id="drop-autorizacion">Haz clic para subir imagen</div>
          <input type="file" id="of-auth-file" accept="image/*" style="display:none"/>
          <div id="fp-autorizacion"></div>
        </div>
      </div>
    </div>
    <div class="wiz-pane" id="pane-d">
      <div class="form-row cols-2">
        <div class="form-field"><label class="fl">Fecha de la cita</label><input class="fi" id="of-cita-fecha" type="date"/></div>
        <div class="form-field"><label class="fl">Hora</label><input class="fi" id="of-cita-hora" type="time"/></div>
        <div class="form-field"><label class="fl">Médico</label><select class="fi" id="of-cita-medico"><option value="">Seleccionar médico…</option>${docOptionsCita}</select></div>
        <div class="form-field"><label class="fl">Consultorio</label><input class="fi" id="of-cita-consul" type="text" placeholder="Piso, número…"/></div>
        <div class="form-field span2"><label class="fl">Dirección (opcional, si es distinta)</label><input class="fi" id="of-cita-dir" type="text" placeholder="Dirección de la cita"/></div>
        <div class="form-field span2"><label class="fl">Indicaciones para asistir</label><textarea class="fi" id="of-cita-ind" rows="2" placeholder="Ayuno, documentos a llevar, llegar con anticipación…"></textarea></div>
        <div class="form-field span2"><label class="fl">Estado del proceso</label>
          <select class="fi" id="of-estado"><option value="">En curso</option><option value="Finalizado">Finalizado (cita ya asistida)</option></select>
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
    document.getElementById('of-medico').value = o.medicoId || '';
  } else {
    document.getElementById('of-fecha').value = today();
  }
  renderFilePreview('orden'); renderFilePreview('solicitud'); renderFilePreview('autorizacion');
}

function switchWizTab(t) {
  document.querySelectorAll('.wiz-tab').forEach(el => el.classList.toggle('active', el.dataset.t === t));
  document.querySelectorAll('.wiz-pane').forEach(el => el.classList.remove('visible'));
  document.getElementById(`pane-${t}`).classList.add('visible');
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

  if (!obj.fechaOrden) { showToast('La fecha de la orden es obligatoria', 'err'); switchWizTab('a'); return; }
  if (!obj.tipoOrden) { showToast('Selecciona el tipo de orden', 'err'); switchWizTab('a'); return; }

  try {
    await api.saveOrder(obj, state.household.id, state.activePatient.id);
    closeModal();
    showToast(editId ? 'Orden actualizada' : 'Orden creada correctamente');
    render();
    if (state.currentView === 'dashboard') {
      const { render: renderDashboard } = await import('./dashboard.js');
      renderDashboard();
    }
  } catch (err) {
    showToast(err.message || 'Error al guardar la orden', 'err');
  }
}
