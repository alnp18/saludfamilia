import { state } from '../state.js';
import * as api from '../lib/api.js';
import { showModal, closeModal, showToast } from '../lib/modal.js';
import { esc, fmtDate, today, daysFrom } from '../lib/utils.js';

const VIA_OPTIONS = ['Oral', 'Subcutánea', 'Intravenosa', 'Intramuscular', 'Tópica', 'Inhalatoria', 'Sublingual', 'Ótica', 'Oftálmica', 'Rectal', 'Nasal', 'Transdérmica', 'Otra'];
const FREQ_OPTIONS = ['Cada 4 horas', 'Cada 6 horas', 'Cada 8 horas', 'Cada 12 horas', 'Cada 24 horas', 'Una vez al día', 'Dos veces al día', 'Tres veces al día', 'Según necesidad', 'Otra'];
const UNIDAD_OPTIONS = ['mg', 'mcg', 'g', 'ml', 'UI', 'gotas', 'cápsulas', 'tabletas', 'sobres', 'parches', 'puffs'];

let medHorariosArr = [];
let showHistory = false;
let pendingOptions = null;

export function setPendingOptions(opts) { pendingOptions = opts; }

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
    <div id="meds-active-section">
      <div class="meds-section-label">Medicamentos activos <span class="meds-count" id="meds-active-count">0</span></div>
      <div class="meds-grid" id="meds-active-grid"></div>
    </div>
    <div id="meds-history-section" style="display:none;margin-top:24px">
      <div class="meds-section-label" style="color:var(--ts)">Historial de versiones <span class="meds-count" id="meds-hist-count" style="background:var(--surface)">0</span></div>
      <div id="meds-history-list"></div>
    </div>
  `;
  document.getElementById('btn-new-med').addEventListener('click', () => openMedModal());
  document.getElementById('btn-show-history').addEventListener('click', toggleMedsHistory);

  if (!state.activePatient) {
    document.getElementById('meds-active-section').innerHTML = `<div class="empty-state"><h3>Selecciona un paciente</h3><button class="btn btn-primary" id="meds-goto-patients" style="margin-top:8px">Ir a Pacientes</button></div>`;
    document.getElementById('meds-goto-patients')?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('sf:goto', { detail: 'patients' })));
    return;
  }
  document.getElementById('meds-sub').textContent = 'Medicamentos de ' + state.activePatient.nombre;

  const all = await api.listMedsByPatient(state.activePatient.id);
  const active = all.filter(m => m.activo);
  const inactive = all.filter(m => !m.activo);

  document.getElementById('meds-active-count').textContent = active.length;
  document.getElementById('btn-show-history').style.display = inactive.length ? 'flex' : 'none';

  const grid = document.getElementById('meds-active-grid');
  if (!active.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <h3>Sin medicamentos activos</h3>
      <p>Registra el primer medicamento de ${esc(state.activePatient.nombre)}.</p>
      <button class="btn btn-primary" id="btn-new-med-empty" style="margin-top:8px">Agregar medicamento</button>
    </div>`;
    document.getElementById('btn-new-med-empty').addEventListener('click', () => openMedModal());
  } else {
    grid.innerHTML = active.map(renderMedCard).join('');
    grid.querySelectorAll('[data-edit-med]').forEach(b => b.addEventListener('click', () => openMedModal(b.dataset.editMed)));
    grid.querySelectorAll('[data-suspend-med]').forEach(b => b.addEventListener('click', () => suspendMedConfirm(b.dataset.suspendMed)));
    grid.querySelectorAll('[data-delete-med]').forEach(b => b.addEventListener('click', () => deleteMedConfirm(b.dataset.deleteMed)));
  }

  if (showHistory) await renderMedsHistory();

  if (pendingOptions?.openModal) { pendingOptions = null; openMedModal(); }
}

function renderMedCard(m) {
  const daysLeft = m.fechaFin ? daysFrom(m.fechaFin) : null;
  let ribbonCls = 'active', ribbonTxt = 'Activo';
  if (!m.activo) { ribbonCls = 'inactive'; ribbonTxt = 'Suspendido / Histórico'; }
  else if (daysLeft !== null && daysLeft >= 0 && daysLeft <= 7) { ribbonCls = 'ending'; ribbonTxt = `Finaliza en ${daysLeft} día${daysLeft !== 1 ? 's' : ''}`; }
  else if (daysLeft !== null && daysLeft < 0) { ribbonCls = 'inactive'; ribbonTxt = 'Período finalizado'; }

  const horarios = (m.horarios || []).map(h => `<span class="horario-chip">${esc(h)}</span>`).join('');

  return `<div class="med-card ${m.activo ? '' : 'inactive'}">
    <div class="med-card-top">
      <div class="med-avatar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 6.5L6.5 10.5a5 5 0 007.07 7.07l4-4a5 5 0 00-7.07-7.07z"/></svg></div>
      <div style="flex:1;min-width:0">
        <div class="med-name">${esc(m.nombre)}</div>
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
      ${horarios ? `<div><div class="fl" style="margin-bottom:5px">Horarios</div><div class="horarios-row">${horarios}</div></div>` : ''}
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
  const all = await api.listMedsByPatient(state.activePatient.id);
  const inactive = all.filter(m => !m.activo).sort((a, b) => (b.version || 1) - (a.version || 1));
  document.getElementById('meds-hist-count').textContent = inactive.length;

  if (!inactive.length) {
    document.getElementById('meds-history-list').innerHTML = `<div class="empty-state" style="padding:24px 0"><p>Sin registros en el historial aún</p></div>`;
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
            ${(m.horarios || []).length ? `<span>${m.horarios.join(' · ')}</span>` : ''}
          </div>
          ${m.observaciones ? `<div style="margin-top:5px;font-size:11.5px;color:var(--tm)">${esc(m.observaciones)}</div>` : ''}
          ${m.motivoCambio ? `<div style="margin-top:4px;font-size:11px;color:var(--amber)">↳ Motivo: ${esc(m.motivoCambio)}</div>` : ''}
        </div>`).join('')}
      </div>
    </div>`;
  }).join('');
}

function initHorariosBuilder(existing = []) {
  medHorariosArr = existing.length ? [...existing] : [''];
  renderHorariosBuilder();
}
function renderHorariosBuilder() {
  const cont = document.getElementById('horarios-builder');
  if (!cont) return;
  cont.innerHTML = medHorariosArr.map((h, i) =>
    `<div class="horarios-builder-row">
      <input class="fi" type="time" value="${esc(h)}" data-horario-idx="${i}"/>
      ${medHorariosArr.length > 1 ? `<button class="btn btn-sm btn-icon btn-danger" type="button" data-remove-horario="${i}"><svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M6 18L18 6M6 6l12 12"/></svg></button>` : ''}
    </div>`
  ).join('') + `<button class="add-horario-btn" type="button" id="add-horario-btn">+ Agregar horario</button>`;

  cont.querySelectorAll('[data-horario-idx]').forEach(inp =>
    inp.addEventListener('input', () => { medHorariosArr[Number(inp.dataset.horarioIdx)] = inp.value; }));
  cont.querySelectorAll('[data-remove-horario]').forEach(btn =>
    btn.addEventListener('click', () => { medHorariosArr.splice(Number(btn.dataset.removeHorario), 1); renderHorariosBuilder(); }));
  document.getElementById('add-horario-btn')?.addEventListener('click', () => { medHorariosArr.push(''); renderHorariosBuilder(); });
}

async function openMedModal(id) {
  let m = null;
  if (id) m = await api.getMed(id);
  const isEdit = !!m;
  const willVersion = isEdit && m.activo;

  showModal(
    isEdit ? (willVersion ? 'Editar medicamento — nueva versión' : 'Editar medicamento') : 'Nuevo medicamento',
    `<div class="form-body">
      ${willVersion ? `<div class="info-box" style="margin-bottom:4px">Si cambias dosis, unidad, frecuencia, vía u horarios se creará automáticamente una nueva versión. El registro anterior queda en el historial.</div>` : ''}
      <div class="form-row cols-2">
        <div class="form-field span2"><label class="fl">Nombre del medicamento *</label><input class="fi" id="mf-nombre" type="text" placeholder="Ej: Metformina, Enalapril, Aspirina…" value="${esc(m?.nombre || '')}"/></div>
        <div class="form-field"><label class="fl">Dosis *</label><input class="fi" id="mf-dosis" type="text" placeholder="Ej: 500, 10, 0.25" value="${esc(m?.dosis || '')}"/></div>
        <div class="form-field"><label class="fl">Unidad</label><select class="fi" id="mf-unidad">${UNIDAD_OPTIONS.map(u => `<option ${m?.unidad === u ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
        <div class="form-field span2"><label class="fl">Frecuencia</label><select class="fi" id="mf-freq"><option value="">Seleccionar…</option>${FREQ_OPTIONS.map(f => `<option ${m?.frecuencia === f ? 'selected' : ''}>${f}</option>`).join('')}</select></div>
        <div class="form-field span2"><label class="fl">Horarios de toma</label><div class="horarios-builder" id="horarios-builder"></div></div>
        <div class="form-field span2"><label class="fl">Vía de administración</label><select class="fi" id="mf-via"><option value="">Seleccionar…</option>${VIA_OPTIONS.map(v => `<option ${m?.via === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="form-field"><label class="fl">Fecha de inicio</label><input class="fi" id="mf-inicio" type="date" value="${esc(m?.fechaInicio || '')}"/></div>
        <div class="form-field"><label class="fl">Fecha de fin (opcional)</label><input class="fi" id="mf-fin" type="date" value="${esc(m?.fechaFin || '')}"/></div>
        <div class="form-field span2"><label class="fl">Observaciones</label><textarea class="fi" id="mf-obs" rows="2" placeholder="Tomar con alimentos, no suspender sin consultar…">${esc(m?.observaciones || '')}</textarea></div>
        ${willVersion ? `<div class="form-field span2"><label class="fl">Motivo del cambio (opcional)</label><input class="fi" id="mf-motivo" type="text" placeholder="Ej: Ajuste de dosis por control médico 15/jun"/></div>` : ''}
      </div>
    </div>`,
    [
      { label: 'Cancelar', cls: 'btn', action: closeModal },
      { label: isEdit ? (willVersion ? 'Guardar nueva versión' : 'Guardar cambios') : 'Agregar medicamento', cls: 'btn btn-primary', action: () => saveMedForm(id) },
    ]
  );
  if (!m) document.getElementById('mf-inicio').value = today();
  initHorariosBuilder(m?.horarios || []);
}

async function saveMedForm(editId) {
  if (!state.activePatient) return;
  const nombre = document.getElementById('mf-nombre').value.trim();
  const dosis = document.getElementById('mf-dosis').value.trim();
  if (!nombre) { showToast('El nombre es obligatorio', 'err'); return; }
  if (!dosis) { showToast('La dosis es obligatoria', 'err'); return; }

  const newData = {
    nombre, dosis,
    unidad: document.getElementById('mf-unidad').value,
    frecuencia: document.getElementById('mf-freq').value,
    horarios: medHorariosArr.filter(h => h.trim()),
    via: document.getElementById('mf-via').value,
    fechaInicio: document.getElementById('mf-inicio').value,
    fechaFin: document.getElementById('mf-fin').value,
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
  const m = await api.getMed(id);
  await api.updateMed(id, { ...m, activo: false, fechaFin: m.fechaFin || today() }, state.household.id, state.activePatient.id);
  showToast('Medicamento suspendido', 'warn');
  render();
}

async function deleteMedConfirm(id) {
  if (!confirm('¿Eliminar este medicamento permanentemente? Esta acción no se puede deshacer.')) return;
  await api.deleteMed(id);
  showToast('Medicamento eliminado', 'warn');
  render();
}
