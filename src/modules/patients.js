import { state } from '../state.js';
import { ThemeEngine } from '../lib/theme.js';
import * as api from '../lib/api.js';
import * as files from '../lib/files.js';
import { openAttachmentViewer } from '../lib/viewer.js';
import { showModal, closeModal, showToast } from '../lib/modal.js';
import { esc, initials, avatarColor, calcAge } from '../lib/utils.js';

let setActivePatientCb = null;
export function setActivePatientSetter(fn) { setActivePatientCb = fn; }

// Tipos fijos de póliza (ver plan P1.5); el household puede sumar los suyos
// vía la opción "Otra…", que queda disponible para cargas futuras.
const POLICY_TYPES_FIJOS = ['SOAT', 'Funeraria', 'Medicina prepagada', 'Servicios Médicos Complementarios', 'Vida', 'Dental'];
const CATEGORIA_POLIZA = 'poliza_tipo';
const PARENTESCO_OPTIONS = [
  'Madre/Padre', 'Hijo/Hija', 'Hermano/Hermana', 'Abuela/Abuelo', 'Nieto/Nieta',
  'Tío/Tía', 'Sobrino/Sobrina', 'Cuidador', 'Familiar', 'Representante asignado', 'Otro',
];

// Estado del sub-formulario "Agregar póliza" dentro del modal de ficha de
// paciente. Es un solo modal (ver modal.js), así que este mini-formulario
// vive inline (no como un segundo modal apilado) y persiste entre los
// re-renders de la sección de pólizas.
let policyFormOpen = false;
let pendingPolicyOtra = false;
let pendingPolicyImage = null; // { name, type, data } en memoria hasta guardar

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
  policyFormOpen = false;
  pendingPolicyOtra = false;
  pendingPolicyImage = null;
  showModal(
    editing ? 'Editar paciente' : 'Nuevo paciente',
    `<div class="form-body">
      <div class="form-row cols-2">
        <div class="form-field"><label class="fl">Primer nombre *</label><input class="fi" id="pf-nombre1" type="text"/></div>
        <div class="form-field"><label class="fl">Segundo nombre</label><input class="fi" id="pf-nombre2" type="text"/></div>
        <div class="form-field"><label class="fl">Primer apellido *</label><input class="fi" id="pf-apellido1" type="text"/></div>
        <div class="form-field"><label class="fl">Segundo apellido</label><input class="fi" id="pf-apellido2" type="text"/></div>
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
          <label class="fl">Dirección de residencia</label>
          <input class="fi" id="pf-direccion" type="text" placeholder="Dirección"/>
        </div>
      </div>

      <div class="form-section-title">Contacto de emergencia</div>
      <div class="form-row cols-2">
        <div class="form-field"><label class="fl">Primer nombre</label><input class="fi" id="pf-ce-nombre1" type="text"/></div>
        <div class="form-field"><label class="fl">Segundo nombre</label><input class="fi" id="pf-ce-nombre2" type="text"/></div>
        <div class="form-field"><label class="fl">Primer apellido</label><input class="fi" id="pf-ce-apellido1" type="text"/></div>
        <div class="form-field"><label class="fl">Segundo apellido</label><input class="fi" id="pf-ce-apellido2" type="text"/></div>
        <div class="form-field">
          <label class="fl">Parentesco</label>
          <select class="fi" id="pf-ce-parentesco">
            <option value="">Seleccionar…</option>
            ${PARENTESCO_OPTIONS.map(o => `<option>${o}</option>`).join('')}
          </select>
        </div>
        <div class="form-field"><label class="fl">Teléfono 1</label><input class="fi" id="pf-ce-tel1" type="text"/></div>
        <div class="form-field"><label class="fl">Teléfono 2</label><input class="fi" id="pf-ce-tel2" type="text"/></div>
        <div class="form-field"><label class="fl">Ciudad</label><input class="fi" id="pf-ce-ciudad" type="text"/></div>
        <div class="form-field span2"><label class="fl">Dirección</label><input class="fi" id="pf-ce-direccion" type="text"/></div>
      </div>

      <div class="form-section-title">Pólizas de seguro adicionales</div>
      <div id="pf-policies-container">
        ${editing ? '' : '<p style="font-size:12.5px;color:var(--ts);margin:0">Podrás agregar pólizas después de crear el paciente.</p>'}
      </div>

      <div class="form-row cols-2" style="margin-top:14px">
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
  if (id) {
    fillPatientForm(id);
    renderPoliciesSection(id);
  }
}

async function fillPatientForm(id) {
  const p = await api.getPatient(id);
  document.getElementById('pf-nombre1').value = p.primerNombre || '';
  document.getElementById('pf-nombre2').value = p.segundoNombre || '';
  document.getElementById('pf-apellido1').value = p.primerApellido || '';
  document.getElementById('pf-apellido2').value = p.segundoApellido || '';
  document.getElementById('pf-dob').value = p.fechaNacimiento || '';
  document.getElementById('pf-sexo').value = p.sexo || '';
  document.getElementById('pf-sangre').value = p.tipoSangre || '';
  document.getElementById('pf-eps').value = p.eps || '';
  document.getElementById('pf-afil').value = p.numeroAfiliado || '';
  document.getElementById('pf-direccion').value = p.direccion || '';
  const ce = p.contactoEmergencia || {};
  document.getElementById('pf-ce-nombre1').value = ce.primerNombre || '';
  document.getElementById('pf-ce-nombre2').value = ce.segundoNombre || '';
  document.getElementById('pf-ce-apellido1').value = ce.primerApellido || '';
  document.getElementById('pf-ce-apellido2').value = ce.segundoApellido || '';
  document.getElementById('pf-ce-parentesco').value = ce.parentesco || '';
  document.getElementById('pf-ce-tel1').value = ce.telefono1 || '';
  document.getElementById('pf-ce-tel2').value = ce.telefono2 || '';
  document.getElementById('pf-ce-ciudad').value = ce.ciudad || '';
  document.getElementById('pf-ce-direccion').value = ce.direccion || '';
  document.getElementById('pf-notas').value = p.notas || '';
}

/** true si el usuario escribió algo en cualquier campo del contacto de emergencia. */
function contactoEmergenciaTieneDatos() {
  return ['pf-ce-nombre1', 'pf-ce-nombre2', 'pf-ce-apellido1', 'pf-ce-apellido2',
    'pf-ce-parentesco', 'pf-ce-tel1', 'pf-ce-tel2', 'pf-ce-ciudad', 'pf-ce-direccion']
    .some(id => document.getElementById(id).value.trim());
}

async function savePatientForm(editId) {
  const primerNombre = document.getElementById('pf-nombre1').value.trim();
  const primerApellido = document.getElementById('pf-apellido1').value.trim();
  if (!primerNombre || !primerApellido) {
    showToast('El primer nombre y el primer apellido son obligatorios', 'err');
    return;
  }
  const contactoEmergencia = contactoEmergenciaTieneDatos() ? {
    primerNombre: document.getElementById('pf-ce-nombre1').value.trim(),
    segundoNombre: document.getElementById('pf-ce-nombre2').value.trim(),
    primerApellido: document.getElementById('pf-ce-apellido1').value.trim(),
    segundoApellido: document.getElementById('pf-ce-apellido2').value.trim(),
    parentesco: document.getElementById('pf-ce-parentesco').value,
    telefono1: document.getElementById('pf-ce-tel1').value.trim(),
    telefono2: document.getElementById('pf-ce-tel2').value.trim(),
    ciudad: document.getElementById('pf-ce-ciudad').value.trim(),
    direccion: document.getElementById('pf-ce-direccion').value.trim(),
  } : null;

  const obj = {
    id: editId || undefined,
    primerNombre,
    segundoNombre: document.getElementById('pf-nombre2').value.trim(),
    primerApellido,
    segundoApellido: document.getElementById('pf-apellido2').value.trim(),
    fechaNacimiento: document.getElementById('pf-dob').value,
    sexo: document.getElementById('pf-sexo').value,
    tipoSangre: document.getElementById('pf-sangre').value,
    eps: document.getElementById('pf-eps').value.trim(),
    numeroAfiliado: document.getElementById('pf-afil').value.trim(),
    direccion: document.getElementById('pf-direccion').value.trim(),
    contactoEmergencia,
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

// ─────────────────────────────────────────
// Pólizas de seguro adicionales (sub-sección del modal, solo en edición)
// ─────────────────────────────────────────
async function renderPoliciesSection(patientId) {
  const container = document.getElementById('pf-policies-container');
  if (!container) return;

  const [policies, customTypes] = await Promise.all([
    api.listPatientPolicies(patientId),
    api.listCatalogOptions(state.household.id, CATEGORIA_POLIZA),
  ]);

  const listHtml = policies.length ? policies.map(pol => `
    <div class="policy-item">
      <div class="policy-info">
        <div class="policy-tipo">${esc(pol.tipo)}</div>
        <div class="policy-num">${pol.numeroPoliza ? esc(pol.numeroPoliza) : 'Sin número registrado'}</div>
      </div>
      <div class="policy-actions">
        ${pol.imagen ? `<button type="button" class="btn btn-sm btn-ghost" data-view-policy="${pol.id}">Ver carnet</button>` : ''}
        <button type="button" class="btn btn-sm btn-icon btn-danger" data-delete-policy="${pol.id}" title="Eliminar">
          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
        </button>
      </div>
    </div>`).join('') : `<p style="font-size:12.5px;color:var(--ts);margin:0 0 8px">Sin pólizas registradas.</p>`;

  const allTypes = [...POLICY_TYPES_FIJOS, ...customTypes.filter(t => !POLICY_TYPES_FIJOS.includes(t))];
  const typeOptionsHtml = allTypes.map(t => `<option>${esc(t)}</option>`).join('');

  container.innerHTML = `
    <div id="pf-policies-list">${listHtml}</div>
    ${policyFormOpen ? `
      <div class="form-row cols-2" style="margin-top:8px">
        <div class="form-field">
          <label class="fl">Tipo de póliza</label>
          <select class="fi" id="pf-policy-tipo">
            ${typeOptionsHtml}
            <option value="__otra__">Otra…</option>
          </select>
        </div>
        <div class="form-field ${pendingPolicyOtra ? '' : 'hidden'}">
          <label class="fl">Especificar tipo</label>
          <input class="fi" id="pf-policy-tipo-otra" type="text" placeholder="Ej: Cooperativa X"/>
        </div>
        <div class="form-field">
          <label class="fl">Número de póliza</label>
          <input class="fi" id="pf-policy-numero" type="text"/>
        </div>
        <div class="form-field">
          <label class="fl">Foto o PDF del carnet</label>
          <div style="display:flex;gap:6px">
            <input class="fi" id="pf-policy-imagen" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" style="flex:1"/>
            <button type="button" class="btn btn-sm btn-icon" id="pf-policy-imagen-cam-btn" title="Tomar foto"><svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h3.5l1.5-2h6l1.5 2H21a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg></button>
          </div>
          <input type="file" id="pf-policy-imagen-cam" accept="image/*" capture="environment" style="display:none"/>
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button type="button" class="btn btn-sm btn-primary" id="pf-policy-save-btn">Guardar póliza</button>
        <button type="button" class="btn btn-sm" id="pf-policy-cancel-btn">Cancelar</button>
      </div>
    ` : `<button type="button" class="btn btn-sm" id="pf-policy-add-btn" style="margin-top:8px">+ Agregar póliza</button>`}
  `;

  container.querySelectorAll('[data-delete-policy]').forEach(el =>
    el.addEventListener('click', () => deletePolicyConfirm(el.dataset.deletePolicy, patientId)));
  container.querySelectorAll('[data-view-policy]').forEach(el =>
    el.addEventListener('click', () => {
      const pol = policies.find(x => x.id === el.dataset.viewPolicy);
      if (pol?.imagen) openAttachmentViewer(pol.imagen);
    }));

  if (policyFormOpen) {
    document.getElementById('pf-policy-tipo').addEventListener('change', (e) => {
      pendingPolicyOtra = e.target.value === '__otra__';
      renderPoliciesSection(patientId);
    });
    document.getElementById('pf-policy-save-btn').addEventListener('click', () => savePolicyInline(patientId));
    document.getElementById('pf-policy-cancel-btn').addEventListener('click', () => {
      policyFormOpen = false;
      pendingPolicyOtra = false;
      pendingPolicyImage = null;
      renderPoliciesSection(patientId);
    });
    // Subir archivo o tomar foto con la cámara — ambas rutas pasan por
    // processUploadFile, que convierte cualquier foto a PDF automáticamente
    // (cambio transversal P1.5) para no acumular carnets pesados.
    const handlePolicyFileChange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const processed = await files.processUploadFile(file);
      e.target.value = '';
      if (processed) pendingPolicyImage = processed;
    };
    document.getElementById('pf-policy-imagen').addEventListener('change', handlePolicyFileChange);
    document.getElementById('pf-policy-imagen-cam').addEventListener('change', handlePolicyFileChange);
    document.getElementById('pf-policy-imagen-cam-btn').addEventListener('click', () => document.getElementById('pf-policy-imagen-cam').click());
  } else {
    document.getElementById('pf-policy-add-btn').addEventListener('click', () => {
      policyFormOpen = true;
      renderPoliciesSection(patientId);
    });
  }
}

async function savePolicyInline(patientId) {
  const tipoSel = document.getElementById('pf-policy-tipo').value;
  let tipo = tipoSel;
  if (tipoSel === '__otra__') {
    tipo = document.getElementById('pf-policy-tipo-otra').value.trim();
    if (!tipo) { showToast('Escribe el tipo de póliza', 'err'); return; }
  }
  const numeroPoliza = document.getElementById('pf-policy-numero').value.trim();
  try {
    if (tipoSel === '__otra__') {
      await api.addCatalogOption(state.household.id, CATEGORIA_POLIZA, tipo);
    }
    let saved = await api.savePatientPolicy({ tipo, numeroPoliza }, state.household.id, patientId);
    if (pendingPolicyImage) {
      const uploaded = await files.uploadAttachment(state.household.id, saved.id, 'poliza', pendingPolicyImage);
      saved = await api.savePatientPolicy({ ...saved, imagen: uploaded }, state.household.id, patientId);
    }
    policyFormOpen = false;
    pendingPolicyOtra = false;
    pendingPolicyImage = null;
    showToast('Póliza agregada');
    renderPoliciesSection(patientId);
  } catch (err) {
    showToast(err.message || 'Error al guardar la póliza', 'err');
  }
}

async function deletePolicyConfirm(id, patientId) {
  if (!confirm('¿Eliminar esta póliza?')) return;
  try {
    const policies = await api.listPatientPolicies(patientId);
    const pol = policies.find(x => x.id === id);
    await api.deletePatientPolicy(id);
    if (pol?.imagen?.path) files.removeAttachments([pol.imagen.path]);
    showToast('Póliza eliminada', 'warn');
    renderPoliciesSection(patientId);
  } catch (err) {
    showToast(err.message || 'Error al eliminar la póliza', 'err');
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
