import { state } from '../state.js';
import { ThemeEngine } from '../lib/theme.js';
import * as api from '../lib/api.js';
import { showModal, closeModal, showToast } from '../lib/modal.js';
import { esc, initials, avatarColor, calcAge } from '../lib/utils.js';

let setActivePatientCb = null;
export function setActivePatientSetter(fn) { setActivePatientCb = fn; }

export async function render() {
  const container = document.getElementById('view-patients');
  if (!container) return;

  container.innerHTML = `
    <div class="view-header">
      <div>
        <div class="view-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87m-4-12a4 4 0 010 7.75"/></svg> Pacientes</div>
        <div class="view-sub">Clic en un paciente para seleccionarlo como activo</div>
      </div>
      <button class="btn btn-primary" id="btn-new-patient"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Nuevo paciente</button>
    </div>
    <div class="patients-grid" id="patients-grid"></div>
  `;
  document.getElementById('btn-new-patient').addEventListener('click', () => openPatientModal());

  const patients = await api.listPatients(state.household.id);
  document.getElementById('sb-badge-patients').textContent = patients.length;

  const grid = document.getElementById('patients-grid');
  if (!patients.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <div class="es-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87m-4-12a4 4 0 010 7.75"/></svg></div>
      <h3>Sin pacientes registrados</h3>
      <p>Agrega el primer paciente para comenzar a gestionar su información médica.</p>
      <button class="btn btn-primary" id="btn-new-patient-empty" style="margin-top:8px">Agregar primer paciente</button>
    </div>`;
    document.getElementById('btn-new-patient-empty').addEventListener('click', () => openPatientModal());
    return;
  }

  grid.innerHTML = patients.map(p => {
    const ac = avatarColor(p.nombre);
    const sel = state.activePatient?.id === p.id;
    const age = p.fechaNacimiento ? calcAge(p.fechaNacimiento) : null;
    const pSpec = ThemeEngine.generate(p, state.lightMode);
    const pGrad = pSpec ? pSpec['--theme-gradient'] : 'var(--t-gradient)';
    return `<div class="patient-card ${sel ? 'selected' : ''}" data-select-id="${p.id}" style="--t-gradient:${pGrad}">
      <div class="pc-top">
        <div class="pc-avatar" style="background:${ac}">${initials(p.nombre)}</div>
        <div style="flex:1;min-width:0">
          <div class="pc-name">${esc(p.nombre)}</div>
          <div class="pc-sub">${age != null ? age + ' años · ' : ''}${esc(p.tipoSangre || '')} ${esc(p.sexo || '')}</div>
        </div>
        <div class="pc-actions">
          <button class="btn btn-sm btn-icon btn-ghost" data-edit-id="${p.id}" title="Editar">
            <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
          </button>
          <button class="btn btn-sm btn-icon btn-danger" data-delete-id="${p.id}" title="Eliminar">
            <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>
      </div>
      ${sel ? `<span class="pc-tag"><svg width="10" height="10" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" d="M5 13l4 4L19 7"/></svg> Paciente activo</span>` : ''}
      <div style="font-size:12px;color:var(--ts);display:flex;gap:12px;flex-wrap:wrap">
        ${p.eps ? `<span>${esc(p.eps)}</span>` : ''}
        ${p.numeroAfiliado ? `<span style="font-family:'JetBrains Mono',monospace">${esc(p.numeroAfiliado)}</span>` : ''}
      </div>
    </div>`;
  }).join('');

  grid.querySelectorAll('[data-select-id]').forEach(el => {
    el.addEventListener('click', async (e) => {
      if (e.target.closest('[data-edit-id]') || e.target.closest('[data-delete-id]')) return;
      const p = patients.find(x => x.id === el.dataset.selectId);
      if (p) await setActivePatientCb?.(p);
    });
  });
  grid.querySelectorAll('[data-edit-id]').forEach(el =>
    el.addEventListener('click', (e) => { e.stopPropagation(); openPatientModal(el.dataset.editId); }));
  grid.querySelectorAll('[data-delete-id]').forEach(el =>
    el.addEventListener('click', (e) => { e.stopPropagation(); deletePatient(el.dataset.deleteId); }));
}

function openPatientModal(id) {
  const editing = !!id;
  showModal(
    editing ? 'Editar paciente' : 'Nuevo paciente',
    `<div class="form-body">
      <div class="form-row cols-2">
        <div class="form-field span2">
          <label class="fl">Nombre completo *</label>
          <input class="fi" id="pf-nombre" type="text" placeholder="Nombre y apellidos"/>
        </div>
        <div class="form-field">
          <label class="fl">Fecha de nacimiento</label>
          <input class="fi" id="pf-dob" type="date"/>
        </div>
        <div class="form-field">
          <label class="fl">Sexo</label>
          <select class="fi" id="pf-sexo">
            <option value="">Seleccionar…</option>
            <option>Masculino</option><option>Femenino</option><option>Otro</option>
          </select>
        </div>
        <div class="form-field">
          <label class="fl">Tipo de sangre</label>
          <select class="fi" id="pf-sangre">
            <option value="">—</option>
            ${['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(t => `<option>${t}</option>`).join('')}
          </select>
        </div>
        <div class="form-field">
          <label class="fl">EPS / Aseguradora</label>
          <input class="fi" id="pf-eps" type="text" placeholder="Nombre de la EPS"/>
        </div>
        <div class="form-field">
          <label class="fl">Número de afiliado</label>
          <input class="fi" id="pf-afil" type="text" placeholder="No. de afiliación" style="font-family:'JetBrains Mono',monospace"/>
        </div>
        <div class="form-field span2">
          <label class="fl">Contacto de emergencia</label>
          <input class="fi" id="pf-emerg" type="text" placeholder="Nombre · relación · teléfono"/>
        </div>
        <div class="form-field span2">
          <label class="fl">Notas</label>
          <textarea class="fi" id="pf-notas" rows="2" placeholder="Alergias, condiciones relevantes…"></textarea>
        </div>
      </div>
    </div>`,
    [
      { label: 'Cancelar', cls: 'btn', action: closeModal },
      { label: editing ? 'Guardar cambios' : 'Crear paciente', cls: 'btn btn-primary', action: () => savePatientForm(id) },
    ]
  );
  if (id) fillPatientForm(id);
}

async function fillPatientForm(id) {
  const p = await api.getPatient(id);
  document.getElementById('pf-nombre').value = p.nombre || '';
  document.getElementById('pf-dob').value = p.fechaNacimiento || '';
  document.getElementById('pf-sexo').value = p.sexo || '';
  document.getElementById('pf-sangre').value = p.tipoSangre || '';
  document.getElementById('pf-eps').value = p.eps || '';
  document.getElementById('pf-afil').value = p.numeroAfiliado || '';
  document.getElementById('pf-emerg').value = p.contactoEmergencia || '';
  document.getElementById('pf-notas').value = p.notas || '';
}

async function savePatientForm(editId) {
  const nombre = document.getElementById('pf-nombre').value.trim();
  if (!nombre) { showToast('El nombre es obligatorio', 'err'); return; }
  const obj = {
    id: editId || undefined,
    nombre,
    fechaNacimiento: document.getElementById('pf-dob').value,
    sexo: document.getElementById('pf-sexo').value,
    tipoSangre: document.getElementById('pf-sangre').value,
    eps: document.getElementById('pf-eps').value.trim(),
    numeroAfiliado: document.getElementById('pf-afil').value.trim(),
    contactoEmergencia: document.getElementById('pf-emerg').value.trim(),
    notas: document.getElementById('pf-notas').value.trim(),
  };
  try {
    const saved = await api.savePatient(obj, state.household.id);
    closeModal();
    showToast(editId ? 'Paciente actualizado' : 'Paciente creado');
    if (!state.activePatient) await setActivePatientCb?.(saved);
    render();
  } catch (err) {
    showToast(err.message || 'Error al guardar el paciente', 'err');
  }
}

async function deletePatient(id) {
  if (!confirm('¿Eliminar este paciente? Se eliminará toda su información médica. Esta acción no se puede deshacer.')) return;
  try {
    await api.deletePatient(id);
    if (state.activePatient?.id === id) await setActivePatientCb?.(null);
    showToast('Paciente eliminado', 'warn');
    render();
  } catch (err) {
    showToast(err.message || 'Error al eliminar', 'err');
  }
}
