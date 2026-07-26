import { state } from '../state.js';
import { ThemeEngine } from '../lib/theme.js';
import * as api from '../lib/api.js';
import * as files from '../lib/files.js';
import { openAttachmentViewer } from '../lib/viewer.js';
import { showModal, closeModal, showToast } from '../lib/modal.js';
import { esc, initials, avatarColor, calcAge, fmtDate, nombreContactoEmergencia } from '../lib/utils.js';
import { catalogOptionsHtml, resolveCatalogValue, OTRA_VALUE } from '../lib/extensibleCatalog.js';
import { hydrateAvatar, hydrateAvatarsIn, invalidateAvatarCache } from '../lib/avatar.js';
import { openViewOverlay } from '../lib/viewModeOverlay.js';
import { emptyStateHtml, errorStateHtml } from '../lib/emptyState.js';
import { openImageCropper } from '../lib/imageCropper.js';
import { geoFieldsHtml, wireGeoFields, fillGeoFields, readGeoFields } from '../lib/geo.js';
import { dateRangeFieldHtml, wireDateRangeField, fillDateRangeField, readDateRangeField } from '../lib/dateRange.js';
import { callLinkHtml, phoneFieldHtml } from '../lib/phone.js';
import { coincideAprox } from '../lib/searchSources.js';
import { liveSearchFieldHtml, wireLiveSearch, fillLiveSearch } from '../lib/liveSearch.js';
import { buscarSintomas } from '../lib/searches.js';

let setActivePatientCb = null;
export function setActivePatientSetter(fn) { setActivePatientCb = fn; }

// Tipos fijos de póliza (ver plan P1.5); el household puede sumar los suyos
// vía la opción "Otra…", que queda disponible para cargas futuras. Mismo
// patrón "Otra… extensible" que Vía de administración (Medicamentos) y
// Especialidad (Médicos) — ver nota transversal del plan (src/lib/extensibleCatalog.js).
const POLICY_TYPES_FIJOS = ['SOAT', 'Funeraria', 'Medicina prepagada', 'Servicios Médicos Complementarios', 'Vida', 'Dental'];
const CATEGORIA_POLIZA = 'poliza_tipo';
// Proporción tipo tarjeta (auditoría 2026-07-17 — el carnet ya no se
// convierte a PDF, se recorta como imagen con este marco guía).
const POLICY_IMAGE_ASPECT = 1.586;
const PARENTESCO_OPTIONS = [
  'Madre/Padre', 'Pareja/Cónyuge', 'Hijo/Hija', 'Hermano/Hermana', 'Abuela/Abuelo', 'Nieto/Nieta',
  'Tío/Tía', 'Sobrino/Sobrina', 'Cuidador', 'Familiar', 'Representante asignado', 'Otro',
];
// Tipos de documento de identidad (Fase 2 — auditoría móvil 2026-07-26). Solo
// los relevantes para un paciente familiar (no aplica NIT, de personas
// jurídicas). CC/TI/RCN son estrictamente numéricos; CE puede traer letras
// (documentos extranjeros), así que solo ese tipo se exime de la validación.
const TIPO_DOCUMENTO_OPTIONS = [
  { value: 'RC', label: 'Registro Civil de Nacimiento' },
  { value: 'TI', label: 'Tarjeta de Identidad' },
  { value: 'CC', label: 'Cédula de Ciudadanía' },
  { value: 'CE', label: 'Cédula de Extranjería' },
];

// Estado del sub-formulario "Agregar/Editar póliza" dentro del modal de
// ficha de paciente. Es un solo modal (ver modal.js), así que este
// mini-formulario vive inline (no como un segundo modal apilado) y
// persiste entre los re-renders de la sección de pólizas.
let policyFormOpen = false;
let editingPolicy = null;      // objeto completo de la póliza si se está editando una existente; null si es nueva (auditoría 2026-07-17)
// Valor actual del <select> de tipo. Se guarda explícito (no solo un flag
// "es Otra") porque el <select> se reconstruye desde cero en cada
// re-render: si `selected` no refleja la última elección del usuario, el
// navegador vuelve a marcar la primera opción (bug reportado 2026-07-17 —
// cambiar de tipo no dejaba salir de "SOAT").
let pendingPolicyTipo = '';
let pendingPolicyImage = null;          // { name, type, data } recién elegida (y recortada, si era imagen), sin subir
let pendingPolicyImageRemoved = false;  // al editar: se quitó la imagen existente sin reemplazarla

// Foto de perfil del paciente (MI AUDITORIA #1). Igual que con las pólizas,
// solo se puede subir en edición (se necesita el id del paciente para la
// ruta en Storage) — en creación se avisa que se puede agregar después.
let currentAvatarFoto = null;   // { name, type, size, path } ya guardado, o null
let pendingAvatarImage = null;  // { name, type, data } recién elegido y recortado, sin subir
let avatarRemoved = false;      // el usuario pidió quitar la foto actual

// Condiciones crónicas (MI AUDITORIA #5). El checkbox solo muestra/oculta
// la sección (lista + mini-formulario de alta) — nunca borra nada por sí
// mismo; los diagnósticos se quitan uno por uno con su botón de eliminar.
// Desde la auditoría 2026-07-17 también pueden editarse (antes solo
// agregar/eliminar).
let cronicoSectionOpen = null; // null = aún no se sabe (se decide al cargar según si ya tiene diagnósticos)
let cronicoAddOpen = false;    // mini-formulario "+ Agregar diagnóstico" (alta o edición) abierto
let editingDiagnosis = null;   // objeto completo si se edita uno existente; null si es nuevo

// Buscador de la vista Pacientes (Fase 2 — auditoría móvil 2026-07-26).
// El índice se arma una vez por carga de la vista y se filtra en memoria: son
// los pacientes de una familia, no hace falta ir a la base en cada tecla.
let searchIndex = [];   // [{ patient, campos: [{ etiqueta, texto, visible }] }]
let searchQuery = '';   // se conserva entre re-renders para que editar un
                        // paciente no borre el filtro que estaba aplicado

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
    <div id="patients-search-bar"></div>
    <div class="patients-grid" id="patients-grid"></div>
  `;
  document.getElementById('btn-new-patient').addEventListener('click', () => openPatientModal());

  const grid = document.getElementById('patients-grid');
  let patients;
  let policies = [];
  let diagnoses = [];
  try {
    patients = await api.listPatients(state.household.id);
  } catch (err) {
    showToast(err.message || 'No se pudieron cargar los pacientes', 'err');
    grid.innerHTML = errorStateHtml({ retryId: 'btn-retry-patients', style: 'grid-column:1/-1' });
    document.getElementById('btn-retry-patients').addEventListener('click', () => render());
    return;
  }
  document.getElementById('sb-badge-patients').textContent = patients.length;

  // Pólizas y diagnósticos alimentan el buscador, no las tarjetas. Si fallan,
  // la vista igual se pinta y se busca sobre el resto de los campos: perder
  // el buscador completo por una consulta secundaria sería peor.
  try {
    [policies, diagnoses] = await Promise.all([
      api.listHouseholdPolicies(state.household.id),
      api.listHouseholdDiagnoses(state.household.id),
    ]);
  } catch {
    policies = [];
    diagnoses = [];
  }

  // Orden de la tarjetas (Fase 2 — auditoría móvil 2026-07-26): el paciente
  // activo siempre primero, y el resto alfabético por nombre completo. Una
  // sola lista continua, sin encabezado que separe "activo" del resto — el
  // API ya trae los pacientes ordenados por nombre, así que solo hace falta
  // sacar el activo y ponerlo adelante.
  const activeId = state.activePatient?.id;
  if (activeId) {
    const i = patients.findIndex(p => p.id === activeId);
    if (i > 0) patients = [patients[i], ...patients.slice(0, i), ...patients.slice(i + 1)];
  }

  if (!patients.length) {
    searchIndex = [];
    searchQuery = '';
    grid.innerHTML = emptyStateHtml({
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87m-4-12a4 4 0 010 7.75"/></svg>',
      title: 'Sin pacientes registrados',
      message: 'Agrega el primer paciente para comenzar a gestionar su información médica.',
      action: { id: 'btn-new-patient-empty', label: 'Agregar primer paciente' },
      style: 'grid-column:1/-1',
    });
    document.getElementById('btn-new-patient-empty').addEventListener('click', () => openPatientModal());
    return;
  }

  searchIndex = patients.map(p => ({
    patient: p,
    campos: camposBuscables(p,
      policies.filter(x => x.patientId === p.id),
      diagnoses.filter(x => x.patientId === p.id)),
  }));
  renderSearchBar();
  renderPatientsGrid();
}

/**
 * Campos por los que se puede encontrar a un paciente — Fase 2, buscador
 * transversal. `visible: true` marca lo que ya se lee en la propia tarjeta:
 * esos no generan la etiqueta de "coincide en", porque señalar algo que la
 * persona está viendo no aporta nada.
 */
function camposBuscables(p, policies, diagnoses) {
  // El contacto es una estructura desde la migración 0009, pero un registro
  // muy viejo (o importado de un .sfam anterior) puede seguir siendo texto
  // libre; si no se contempla, ese contacto sería imposible de encontrar.
  const ce = typeof p.contactoEmergencia === 'string'
    ? { primerNombre: p.contactoEmergencia }
    : (p.contactoEmergencia || {});
  const campos = [
    { etiqueta: 'Nombre', texto: p.nombre, visible: true },
    { etiqueta: 'EPS', texto: p.eps, visible: true },
    { etiqueta: 'Afiliado', texto: p.numeroAfiliado, visible: true },
    { etiqueta: 'Documento', texto: [p.tipoDocumento, p.numeroDocumento].filter(Boolean).join(' ') },
    { etiqueta: 'Ubicación', texto: [p.direccion, p.municipio, p.departamento].filter(Boolean).join(' ') },
    { etiqueta: 'Contacto de emergencia', texto: [
      nombreContactoEmergencia(ce), ce.parentesco, ce.telefono1, ce.telefono2,
      ce.direccion, ce.municipio, ce.departamento].filter(Boolean).join(' ') },
    { etiqueta: 'Notas', texto: p.notas },
  ];
  for (const pol of policies) {
    campos.push({ etiqueta: 'Póliza', texto: [pol.tipo, pol.aseguradora, pol.numeroPoliza].filter(Boolean).join(' ') });
  }
  for (const d of diagnoses) {
    campos.push({ etiqueta: 'Diagnóstico', texto: [d.codigoCie10, d.descripcion].filter(Boolean).join(' ') });
  }
  return campos.filter(c => c.texto);
}

function renderSearchBar() {
  const bar = document.getElementById('patients-search-bar');
  if (!bar) return;
  bar.innerHTML = `
    <div class="patients-search">
      <svg class="ps-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input class="fi ps-input" id="patients-search-input" type="search" autocomplete="off"
             placeholder="Buscar por nombre, documento, EPS, póliza, diagnóstico o contacto…"
             value="${esc(searchQuery)}"/>
      <button type="button" class="ps-clear${searchQuery ? '' : ' hidden'}" id="patients-search-clear" title="Limpiar" aria-label="Limpiar búsqueda">×</button>
    </div>`;

  const input = document.getElementById('patients-search-input');
  input.addEventListener('input', () => {
    searchQuery = input.value;
    document.getElementById('patients-search-clear').classList.toggle('hidden', !searchQuery);
    renderPatientsGrid();
  });
  document.getElementById('patients-search-clear').addEventListener('click', () => {
    searchQuery = '';
    input.value = '';
    document.getElementById('patients-search-clear').classList.add('hidden');
    renderPatientsGrid();
    input.focus();
  });
}

/**
 * Pinta las tarjetas aplicando el filtro actual. Se llama en cada tecla, así
 * que no vuelve a consultar nada: trabaja sobre `searchIndex`.
 */
function renderPatientsGrid() {
  const grid = document.getElementById('patients-grid');
  if (!grid) return;

  const q = searchQuery.trim();
  // Con una o dos letras no se filtra: casi todo coincide y la lista salta
  // sin razón aparente mientras la persona todavía está escribiendo.
  const filtrando = q.length >= 2;
  const visibles = filtrando
    ? searchIndex
      .map(entry => ({ entry, coincidencias: entry.campos.filter(c => coincideAprox(c.texto, q)) }))
      .filter(x => x.coincidencias.length)
    : searchIndex.map(entry => ({ entry, coincidencias: [] }));

  if (!visibles.length) {
    grid.innerHTML = emptyStateHtml({
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
      title: 'Sin coincidencias',
      // emptyStateHtml inserta el texto tal cual: escapar acá es obligatorio,
      // `q` es lo que escribió la persona.
      message: `Ningún paciente coincide con “${esc(q)}”. Se busca en nombre, documento, EPS, ubicación, pólizas, diagnósticos y contacto de emergencia.`,
      style: 'grid-column:1/-1',
    });
    return;
  }

  const patients = visibles.map(x => x.entry.patient);

  grid.innerHTML = visibles.map(({ entry, coincidencias }) => {
    const p = entry.patient;
    // Solo se anuncian las coincidencias que la tarjeta no muestra por sí
    // misma: si apareció por la póliza o por el contacto de emergencia, sin
    // esto la tarjeta parecería salir de la nada.
    const etiquetas = [...new Set(coincidencias.filter(c => !c.visible).map(c => c.etiqueta))];
    const ac = avatarColor(p.nombre);
    const sel = state.activePatient?.id === p.id;
    const age = p.fechaNacimiento ? calcAge(p.fechaNacimiento) : null;
    const pSpec = ThemeEngine.generate(p, state.lightMode);
    const pGrad = pSpec ? pSpec['--theme-gradient'] : 'var(--t-gradient)';
    return `<div class="patient-card ${sel ? 'selected' : ''}" data-select-id="${p.id}" style="--t-gradient:${pGrad}">
      <div class="pc-top">
        <div class="pc-avatar" data-avatar-id="${p.id}" style="background:${ac}">${initials(p.nombre)}</div>
        <div style="flex:1;min-width:0">
          <div class="pc-name">${esc(p.nombre)}</div>
          <div class="pc-sub">${age != null ? age + ' años · ' : ''}${esc(p.tipoSangre || '')} ${esc(p.sexo || '')}</div>
        </div>
        <div class="pc-actions">
          <button class="btn btn-sm btn-icon btn-ghost" data-view-id="${p.id}" title="Ver ficha completa">
            <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>
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
      ${etiquetas.length ? `<div class="pc-match">Coincide en ${etiquetas.map(e => `<span class="pc-match-tag">${esc(e)}</span>`).join('')}</div>` : ''}
    </div>`;
  }).join('');
  hydrateAvatarsIn(grid, patients);

  grid.querySelectorAll('[data-select-id]').forEach(el => {
    el.addEventListener('click', async (e) => {
      if (e.target.closest('[data-view-id]') || e.target.closest('[data-delete-id]')) return;
      const p = patients.find(x => x.id === el.dataset.selectId);
      if (p) await setActivePatientCb?.(p);
    });
  });
  // MI AUDITORIA #4b: el botón Editar ya no vive en la tarjeta — se abre
  // desde la barra fija del Modo vista (openPatientViewMode).
  grid.querySelectorAll('[data-view-id]').forEach(el =>
    el.addEventListener('click', (e) => { e.stopPropagation(); openPatientViewMode(el.dataset.viewId); }));
  grid.querySelectorAll('[data-delete-id]').forEach(el =>
    el.addEventListener('click', (e) => { e.stopPropagation(); deletePatient(el.dataset.deleteId); }));
}

/** Igual que pvField, pero agrega el botón Llamar junto al número. */
function pvPhoneField(label, value) {
  if (!value) return '';
  return `<div class="pv-field"><div class="pv-field-label">${esc(label)}</div>`
    + `<div class="pv-field-value">${esc(value)} ${callLinkHtml(value)}</div></div>`;
}

function pvField(label, value) {
  if (value === null || value === undefined || value === '') return '';
  return `<div class="pv-field"><div class="pv-field-label">${esc(label)}</div><div class="pv-field-value">${esc(value)}</div></div>`;
}

/**
 * Modo vista (MI AUDITORIA #4): toda la información del paciente de solo
 * lectura, en una ventana sobrepuesta con barra fija (Editar + Cerrar) —
 * ver src/lib/viewModeOverlay.js. El botón Editar cierra esta ventana y
 * abre el formulario de edición ya existente (openPatientModal); no hay
 * un segundo formulario duplicado.
 */
async function openPatientViewMode(id) {
  let patient, policies, diagnoses;
  try {
    [patient, policies, diagnoses] = await Promise.all([
      api.getPatient(id),
      api.listPatientPolicies(id),
      api.listPatientDiagnoses(id),
    ]);
  } catch (err) {
    showToast(err.message || 'No se pudo abrir la ficha del paciente', 'err');
    return;
  }
  const age = patient.fechaNacimiento ? calcAge(patient.fechaNacimiento) + ' años' : null;
  const ce = patient.contactoEmergencia;
  const ceNombre = nombreContactoEmergencia(ce);

  const policiesHtml = policies.length ? policies.map(pol => `
    <div class="policy-item">
      <div class="policy-info">
        <div class="policy-tipo">${esc(pol.tipo)}${pol.aseguradora ? ' · ' + esc(pol.aseguradora) : ''}</div>
        <div class="policy-num">${pol.numeroPoliza ? esc(pol.numeroPoliza) : 'Sin número registrado'}</div>
        ${pol.fechaInicio || pol.fechaFin ? `<div class="policy-num">Vigencia: ${pol.fechaInicio ? fmtDate(pol.fechaInicio) : '—'} – ${pol.fechaFin ? fmtDate(pol.fechaFin) : '—'}</div>` : ''}
      </div>
      ${pol.imagen ? `<div class="policy-actions"><button type="button" class="btn btn-sm btn-ghost" data-pv-view-policy="${pol.id}">Ver carnet</button></div>` : ''}
    </div>`).join('') : `<p style="font-size:12.5px;color:var(--ts);margin:0">Sin pólizas registradas.</p>`;

  const bodyHtml = `
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:6px">
      ${avatarPreviewHtml(patient)}
      <div>
        <div style="font-size:16px;font-weight:700">${esc(patient.nombre || '—')}</div>
        <div style="font-size:12.5px;color:var(--ts)">${[age, patient.sexo, patient.tipoSangre].filter(Boolean).map(v => esc(v)).join(' · ') || '—'}</div>
      </div>
    </div>

    <div class="pv-section-title">Datos personales</div>
    <div class="pv-field-row">
      ${pvField('Documento', patient.numeroDocumento ? `${patient.tipoDocumento ? patient.tipoDocumento + ' ' : ''}${patient.numeroDocumento}` : '')}
      ${pvField('Fecha de nacimiento', patient.fechaNacimiento ? fmtDate(patient.fechaNacimiento) : '')}
      ${pvField('EPS', patient.eps)}
      ${pvField('Número de afiliado', patient.numeroAfiliado)}
      ${pvField('Departamento', patient.departamento)}
      ${pvField('Municipio', patient.municipio)}
      ${pvField('Dirección', patient.direccion)}
    </div>

    ${ce ? `
      <div class="pv-section-title">Contacto de emergencia</div>
      <div class="pv-field-row">
        ${pvField('Nombre', ceNombre)}
        ${pvField('Parentesco', ce.parentesco)}
        ${pvPhoneField('Teléfono 1', ce.telefono1)}
        ${pvPhoneField('Teléfono 2', ce.telefono2)}
        ${pvField('Departamento', ce.departamento)}
        ${pvField('Municipio', ce.municipio)}
        ${pvField('Dirección', ce.direccion)}
      </div>` : ''}

    <div class="pv-section-title">Pólizas de seguro</div>
    ${policiesHtml}

    ${diagnoses.length ? `
      <div class="pv-section-title">Condiciones crónicas</div>
      ${diagnoses.map(d => `
        <div class="policy-item">
          <div class="policy-info">
            <div class="policy-tipo" style="font-family:'JetBrains Mono',monospace">${esc(d.codigoCie10)}</div>
            <div class="policy-num">${d.descripcion ? esc(d.descripcion) : 'Sin descripción'}</div>
          </div>
        </div>`).join('')}` : ''}

    ${patient.notas ? `
      <div class="pv-section-title">Notas</div>
      <div style="font-size:13px;color:var(--tp);line-height:1.6;white-space:pre-wrap">${esc(patient.notas)}</div>` : ''}
  `;

  const { root } = openViewOverlay({
    title: patient.nombre || 'Paciente',
    subtitle: 'Ficha del paciente',
    bodyHtml,
    actions: [
      { label: 'Editar', cls: 'btn-primary', onClick: (close) => { close(); openPatientModal(id); } },
    ],
  });

  hydrateAvatar(root.querySelector('.pf-avatar-preview'), patient);
  root.querySelectorAll('[data-pv-view-policy]').forEach(el =>
    el.addEventListener('click', () => {
      const pol = policies.find(x => x.id === el.dataset.pvViewPolicy);
      if (pol?.imagen) openAttachmentViewer(pol.imagen);
    }));
}

function openPatientModal(id) {
  const editing = !!id;
  policyFormOpen = false;
  editingPolicy = null;
  pendingPolicyTipo = '';
  pendingPolicyImage = null;
  pendingPolicyImageRemoved = false;
  currentAvatarFoto = null;
  pendingAvatarImage = null;
  avatarRemoved = false;
  cronicoSectionOpen = null;
  cronicoAddOpen = false;
  editingDiagnosis = null;
  showModal(
    editing ? 'Editar paciente' : 'Nuevo paciente',
    `<div class="form-body">
      <div class="form-section-title" style="margin-top:0">Foto de perfil</div>
      <div id="pf-avatar-section" style="margin-bottom:14px">
        ${editing ? '' : '<p style="font-size:12.5px;color:var(--ts);margin:0">Podrás agregar una foto después de crear el paciente.</p>'}
      </div>
      <div class="form-row cols-2">
        <div class="form-field"><label class="fl">Primer nombre *</label><input class="fi" id="pf-nombre1" type="text"/></div>
        <div class="form-field"><label class="fl">Segundo nombre</label><input class="fi" id="pf-nombre2" type="text"/></div>
        <div class="form-field"><label class="fl">Primer apellido *</label><input class="fi" id="pf-apellido1" type="text"/></div>
        <div class="form-field"><label class="fl">Segundo apellido</label><input class="fi" id="pf-apellido2" type="text"/></div>
        <div class="form-field">
          <label class="fl">Tipo de documento</label>
          <select class="fi" id="pf-tipo-doc">
            <option value="">Seleccione tipo de documento</option>
            ${TIPO_DOCUMENTO_OPTIONS.map(o => `<option value="${o.value}">${o.label}</option>`).join('')}
          </select>
        </div>
        <div class="form-field">
          <label class="fl">Número de documento</label>
          <input class="fi" id="pf-numero-doc" type="text" style="font-family:'JetBrains Mono',monospace"/>
        </div>
        <div class="form-field">
          <label class="fl">Fecha de nacimiento</label>
          <input class="fi" id="pf-dob" type="date"/>
        </div>
        <div class="form-field">
          <label class="fl">Sexo</label>
          <select class="fi" id="pf-sexo">
            <option value="">Seleccione sexo</option>
            <option>Masculino</option><option>Femenino</option><option>Otro</option>
          </select>
        </div>
        <div class="form-field">
          <label class="fl">Tipo de sangre</label>
          <select class="fi" id="pf-sangre">
            <option value="">Seleccione tipo de sangre</option>
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
        ${geoFieldsHtml('pf')}
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
            <option value="">Seleccione parentesco</option>
            ${PARENTESCO_OPTIONS.map(o => `<option>${o}</option>`).join('')}
          </select>
        </div>
        ${phoneFieldHtml({ id: 'pf-ce-tel1', label: 'Teléfono 1' })}
        ${phoneFieldHtml({ id: 'pf-ce-tel2', label: 'Teléfono 2' })}
        <div class="form-field span2"><label class="fl">Dirección</label><input class="fi" id="pf-ce-direccion" type="text"/></div>
        ${geoFieldsHtml('pf-ce')}
      </div>

      <div class="form-section-title">Pólizas de seguro adicionales</div>
      <div id="pf-policies-container">
        ${editing ? '' : '<p style="font-size:12.5px;color:var(--ts);margin:0">Podrás agregar pólizas después de crear el paciente.</p>'}
      </div>

      <div class="form-section-title">Condiciones crónicas</div>
      <div id="pf-diagnoses-container">
        ${editing ? '' : '<p style="font-size:12.5px;color:var(--ts);margin:0">Podrás registrar diagnósticos después de crear el paciente.</p>'}
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
  wireGeoFields('pf');
  wireGeoFields('pf-ce');
  if (id) {
    fillPatientForm(id);
    renderPoliciesSection(id);
    renderDiagnosesSection(id);
  }
}

function avatarPreviewHtml(patient) {
  const ac = avatarColor(patient?.nombre || '');
  return `<div class="pf-avatar-preview" id="pf-avatar-preview" data-avatar-id="${patient?.id || ''}" style="background:${ac}">${initials(patient?.nombre || '')}</div>`;
}

async function renderAvatarSection(patient) {
  const container = document.getElementById('pf-avatar-section');
  if (!container) return;
  const hasPhoto = !avatarRemoved && (pendingAvatarImage || currentAvatarFoto);
  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:14px">
      ${avatarPreviewHtml(patient)}
      <div style="display:flex;flex-direction:column;gap:6px">
        <div style="display:flex;gap:6px">
          <label class="btn btn-sm" for="pf-avatar-file" style="cursor:pointer">Subir foto</label>
          <input id="pf-avatar-file" type="file" accept="image/*" style="display:none"/>
          <button type="button" class="btn btn-sm btn-icon" id="pf-avatar-cam-btn" title="Tomar foto"><svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h3.5l1.5-2h6l1.5 2H21a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg></button>
          <input type="file" id="pf-avatar-cam" accept="image/*" capture="user" style="display:none"/>
          ${hasPhoto ? '<button type="button" class="btn btn-sm" id="pf-avatar-remove-btn">Quitar foto</button>' : ''}
        </div>
        <span style="font-size:11.5px;color:var(--ts)">JPG o PNG, máx. ${10}MB</span>
      </div>
    </div>`;

  if (pendingAvatarImage && !avatarRemoved) {
    document.getElementById('pf-avatar-preview').style.backgroundImage = `url("${pendingAvatarImage.data}")`;
    document.getElementById('pf-avatar-preview').style.backgroundSize = 'cover';
    document.getElementById('pf-avatar-preview').style.backgroundPosition = 'center';
    document.getElementById('pf-avatar-preview').textContent = '';
  } else if (currentAvatarFoto && !avatarRemoved) {
    hydrateAvatar(document.getElementById('pf-avatar-preview'), { id: patient.id, foto: currentAvatarFoto, nombre: patient.nombre });
  }

  // Auditoría 2026-07-17: la foto siempre pasa por el recortador antes de
  // guardarse, para poder encuadrarla al formato circular del avatar (antes
  // se subía tal cual, solo redimensionada si era muy grande).
  const handleFile = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file || !files.validateImageFile(file)) return;
    const dataUrl = await files.blobToDataUrl(file);
    const cropped = await openImageCropper(dataUrl, {
      shape: 'circle',
      outputWidth: 480,
      title: 'Ajustar foto de perfil',
    });
    if (!cropped) return; // el usuario canceló el recorte
    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    pendingAvatarImage = { name, type: 'image/jpeg', data: cropped };
    avatarRemoved = false;
    renderAvatarSection(patient);
  };
  document.getElementById('pf-avatar-file').addEventListener('change', handleFile);
  document.getElementById('pf-avatar-cam').addEventListener('change', handleFile);
  document.getElementById('pf-avatar-cam-btn').addEventListener('click', () => document.getElementById('pf-avatar-cam').click());
  document.getElementById('pf-avatar-remove-btn')?.addEventListener('click', () => {
    pendingAvatarImage = null;
    avatarRemoved = true;
    renderAvatarSection(patient);
  });
}

async function fillPatientForm(id) {
  const p = await api.getPatient(id);
  currentAvatarFoto = p.foto || null;
  renderAvatarSection(p);
  document.getElementById('pf-nombre1').value = p.primerNombre || '';
  document.getElementById('pf-nombre2').value = p.segundoNombre || '';
  document.getElementById('pf-apellido1').value = p.primerApellido || '';
  document.getElementById('pf-apellido2').value = p.segundoApellido || '';
  document.getElementById('pf-dob').value = p.fechaNacimiento || '';
  document.getElementById('pf-sexo').value = p.sexo || '';
  document.getElementById('pf-sangre').value = p.tipoSangre || '';
  document.getElementById('pf-eps').value = p.eps || '';
  document.getElementById('pf-afil').value = p.numeroAfiliado || '';
  document.getElementById('pf-tipo-doc').value = p.tipoDocumento || '';
  document.getElementById('pf-numero-doc').value = p.numeroDocumento || '';
  document.getElementById('pf-direccion').value = p.direccion || '';
  fillGeoFields('pf', p.departamento, p.municipio);
  const ce = p.contactoEmergencia || {};
  document.getElementById('pf-ce-nombre1').value = ce.primerNombre || '';
  document.getElementById('pf-ce-nombre2').value = ce.segundoNombre || '';
  document.getElementById('pf-ce-apellido1').value = ce.primerApellido || '';
  document.getElementById('pf-ce-apellido2').value = ce.segundoApellido || '';
  document.getElementById('pf-ce-parentesco').value = ce.parentesco || '';
  document.getElementById('pf-ce-tel1').value = ce.telefono1 || '';
  document.getElementById('pf-ce-tel2').value = ce.telefono2 || '';
  fillGeoFields('pf-ce', ce.departamento, ce.municipio);
  document.getElementById('pf-ce-direccion').value = ce.direccion || '';
  document.getElementById('pf-notas').value = p.notas || '';
}

/** true si el usuario escribió algo en cualquier campo del contacto de emergencia. */
function contactoEmergenciaTieneDatos() {
  return ['pf-ce-nombre1', 'pf-ce-nombre2', 'pf-ce-apellido1', 'pf-ce-apellido2',
    'pf-ce-parentesco', 'pf-ce-tel1', 'pf-ce-tel2', 'pf-ce-depto', 'pf-ce-municipio', 'pf-ce-direccion']
    .some(id => document.getElementById(id).value.trim());
}

async function savePatientForm(editId) {
  const primerNombre = document.getElementById('pf-nombre1').value.trim();
  const primerApellido = document.getElementById('pf-apellido1').value.trim();
  if (!primerNombre || !primerApellido) {
    showToast('El primer nombre y el primer apellido son obligatorios', 'err');
    return;
  }
  const tipoDocumento = document.getElementById('pf-tipo-doc').value;
  const numeroDocumento = document.getElementById('pf-numero-doc').value.trim();
  // Solo CE admite letras (documentos extranjeros); el resto de tipos son
  // estrictamente numéricos.
  if (numeroDocumento && tipoDocumento !== 'CE' && !/^\d+$/.test(numeroDocumento)) {
    showToast('El número de documento debe ser solo numérico', 'err');
    return;
  }
  const ceGeo = readGeoFields('pf-ce');
  const contactoEmergencia = contactoEmergenciaTieneDatos() ? {
    primerNombre: document.getElementById('pf-ce-nombre1').value.trim(),
    segundoNombre: document.getElementById('pf-ce-nombre2').value.trim(),
    primerApellido: document.getElementById('pf-ce-apellido1').value.trim(),
    segundoApellido: document.getElementById('pf-ce-apellido2').value.trim(),
    parentesco: document.getElementById('pf-ce-parentesco').value,
    telefono1: document.getElementById('pf-ce-tel1').value.trim(),
    telefono2: document.getElementById('pf-ce-tel2').value.trim(),
    departamento: ceGeo.departamento,
    municipio: ceGeo.municipio,
    direccion: document.getElementById('pf-ce-direccion').value.trim(),
  } : null;

  // Foto de perfil: si se eligió una nueva, se sube primero (necesita el id
  // del paciente para la ruta en Storage, que ya existe porque el avatar
  // solo puede editarse desde el modo edición). Si se quitó sin reemplazo,
  // queda en null. Si no se tocó, se conserva la que ya tenía.
  let foto = avatarRemoved ? null : currentAvatarFoto;
  const oldFotoPath = currentAvatarFoto?.path;
  if (pendingAvatarImage && editId) {
    try {
      foto = await files.uploadAttachment(state.household.id, editId, 'avatar', pendingAvatarImage);
    } catch (err) {
      showToast(err.message || 'Error al subir la foto', 'err');
      return;
    }
  }

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
    tipoDocumento,
    numeroDocumento,
    direccion: document.getElementById('pf-direccion').value.trim(),
    ...readGeoFields('pf'),
    contactoEmergencia,
    notas: document.getElementById('pf-notas').value.trim(),
    foto,
  };
  try {
    const saved = await api.savePatient(obj, state.household.id);
    // Si se reemplazó o se quitó la foto anterior, se borra del bucket
    // recién ahora que el guardado del paciente ya tuvo éxito.
    if (oldFotoPath && oldFotoPath !== foto?.path) {
      invalidateAvatarCache(currentAvatarFoto);
      files.removeAttachments([oldFotoPath]);
    }
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
        <div class="policy-tipo">${esc(pol.tipo)}${pol.aseguradora ? ' · ' + esc(pol.aseguradora) : ''}</div>
        <div class="policy-num">${pol.numeroPoliza ? esc(pol.numeroPoliza) : 'Sin número registrado'}</div>
        ${pol.fechaInicio || pol.fechaFin ? `<div class="policy-num">Vigencia: ${pol.fechaInicio ? fmtDate(pol.fechaInicio) : '—'} – ${pol.fechaFin ? fmtDate(pol.fechaFin) : '—'}</div>` : ''}
      </div>
      <div class="policy-actions">
        ${pol.imagen ? `<button type="button" class="btn btn-sm btn-ghost" data-view-policy="${pol.id}">Ver carnet</button>` : ''}
        <button type="button" class="btn btn-sm btn-icon" data-edit-policy="${pol.id}" title="Editar">
          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button type="button" class="btn btn-sm btn-icon btn-danger" data-delete-policy="${pol.id}" title="Eliminar">
          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
        </button>
      </div>
    </div>`).join('') : `<p style="font-size:12.5px;color:var(--ts);margin:0 0 8px">Sin pólizas registradas.</p>`;

  const isOtra = pendingPolicyTipo === OTRA_VALUE;
  const hasExistingImage = !!editingPolicy?.imagen && !pendingPolicyImageRemoved && !pendingPolicyImage;
  const hasPendingImage = !!pendingPolicyImage;

  container.innerHTML = `
    <div id="pf-policies-list">${listHtml}</div>
    ${policyFormOpen ? `
      <div class="form-row cols-2" style="margin-top:8px">
        <div class="form-field">
          <label class="fl">Tipo de póliza</label>
          <select class="fi" id="pf-policy-tipo"><option value="">Seleccione tipo de póliza</option>${catalogOptionsHtml(POLICY_TYPES_FIJOS, customTypes, pendingPolicyTipo)}</select>
        </div>
        <div class="form-field ${isOtra ? '' : 'hidden'}">
          <label class="fl">Especificar tipo</label>
          <input class="fi" id="pf-policy-tipo-otra" type="text" placeholder="Ej: Cooperativa X" value="${isOtra && editingPolicy ? esc(editingPolicy.tipo) : ''}"/>
        </div>
        <div class="form-field">
          <label class="fl">Número de póliza</label>
          <input class="fi" id="pf-policy-numero" type="text" value="${editingPolicy ? esc(editingPolicy.numeroPoliza || '') : ''}"/>
        </div>
        <div class="form-field">
          <label class="fl">Nombre de la aseguradora</label>
          <input class="fi" id="pf-policy-aseguradora" type="text" placeholder="Ej: Sura, Colpatria…" value="${editingPolicy ? esc(editingPolicy.aseguradora || '') : ''}"/>
        </div>
        ${dateRangeFieldHtml('pf-policy-vigencia', { label: 'Vigencia' })}
        <div class="form-field span2">
          <label class="fl">Foto del carnet (o PDF ya escaneado)</label>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            <label class="btn btn-sm" for="pf-policy-imagen" style="cursor:pointer">${hasExistingImage || hasPendingImage ? 'Reemplazar' : 'Subir'} imagen</label>
            <input id="pf-policy-imagen" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" style="display:none"/>
            <button type="button" class="btn btn-sm btn-icon" id="pf-policy-imagen-cam-btn" title="Tomar foto"><svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h3.5l1.5-2h6l1.5 2H21a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg></button>
            <input type="file" id="pf-policy-imagen-cam" accept="image/*" capture="environment" style="display:none"/>
            ${hasExistingImage ? '<button type="button" class="btn btn-sm btn-ghost" id="pf-policy-imagen-view-btn">Ver actual</button>' : ''}
            ${(hasExistingImage || hasPendingImage) ? '<button type="button" class="btn btn-sm" id="pf-policy-imagen-remove-btn">Quitar</button>' : ''}
          </div>
          ${hasPendingImage ? `<p style="font-size:11.5px;color:var(--ts);margin:4px 0 0">Nueva imagen lista: ${esc(pendingPolicyImage.name)}</p>` : ''}
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button type="button" class="btn btn-sm btn-primary" id="pf-policy-save-btn">${editingPolicy ? 'Guardar cambios' : 'Guardar póliza'}</button>
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
  container.querySelectorAll('[data-edit-policy]').forEach(el =>
    el.addEventListener('click', () => {
      const pol = policies.find(x => x.id === el.dataset.editPolicy);
      if (!pol) return;
      const known = [...POLICY_TYPES_FIJOS, ...customTypes.filter(c => !POLICY_TYPES_FIJOS.includes(c))];
      editingPolicy = pol;
      pendingPolicyTipo = known.includes(pol.tipo) ? pol.tipo : OTRA_VALUE;
      pendingPolicyImage = null;
      pendingPolicyImageRemoved = false;
      policyFormOpen = true;
      renderPoliciesSection(patientId);
    }));

  if (policyFormOpen) {
    wireDateRangeField('pf-policy-vigencia');
    fillDateRangeField('pf-policy-vigencia', editingPolicy?.fechaInicio, editingPolicy?.fechaFin);
    document.getElementById('pf-policy-tipo').addEventListener('change', (e) => {
      pendingPolicyTipo = e.target.value;
      renderPoliciesSection(patientId);
    });
    document.getElementById('pf-policy-save-btn').addEventListener('click', () => savePolicyInline(patientId));
    document.getElementById('pf-policy-cancel-btn').addEventListener('click', () => {
      policyFormOpen = false;
      editingPolicy = null;
      pendingPolicyTipo = '';
      pendingPolicyImage = null;
      pendingPolicyImageRemoved = false;
      renderPoliciesSection(patientId);
    });
    document.getElementById('pf-policy-imagen-view-btn')?.addEventListener('click', () => {
      if (editingPolicy?.imagen) openAttachmentViewer(editingPolicy.imagen);
    });
    document.getElementById('pf-policy-imagen-remove-btn')?.addEventListener('click', () => {
      if (pendingPolicyImage) pendingPolicyImage = null;
      else pendingPolicyImageRemoved = true;
      renderPoliciesSection(patientId);
    });
    // Auditoría 2026-07-17: el carnet ya no se convierte a PDF — si es una
    // imagen, pasa por el recortador (para poder encuadrarla) y se guarda
    // como imagen; si es un PDF ya escaneado, se sube tal cual (mismo
    // criterio que antes tenía processUploadFile para archivos que ya
    // llegaban en PDF).
    const handlePolicyFileChange = async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      if (file.type === 'application/pdf') {
        if (file.size > files.MAX_FILE_MB * 1024 * 1024) {
          showToast(`Archivo muy grande (máx. ${files.MAX_FILE_MB}MB)`, 'err');
          return;
        }
        const dataUrl = await files.blobToDataUrl(file);
        pendingPolicyImage = { name: file.name, type: file.type, data: dataUrl };
        pendingPolicyImageRemoved = false;
        renderPoliciesSection(patientId);
        return;
      }
      if (!files.validateImageFile(file)) return;
      const dataUrl = await files.blobToDataUrl(file);
      const cropped = await openImageCropper(dataUrl, {
        shape: 'rect',
        aspect: POLICY_IMAGE_ASPECT,
        outputWidth: 1000,
        title: 'Ajustar carnet',
      });
      if (!cropped) return; // el usuario canceló el recorte
      const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
      pendingPolicyImage = { name, type: 'image/jpeg', data: cropped };
      pendingPolicyImageRemoved = false;
      renderPoliciesSection(patientId);
    };
    document.getElementById('pf-policy-imagen').addEventListener('change', handlePolicyFileChange);
    document.getElementById('pf-policy-imagen-cam').addEventListener('change', handlePolicyFileChange);
    document.getElementById('pf-policy-imagen-cam-btn').addEventListener('click', () => document.getElementById('pf-policy-imagen-cam').click());
  } else {
    document.getElementById('pf-policy-add-btn').addEventListener('click', () => {
      policyFormOpen = true;
      editingPolicy = null;
      pendingPolicyTipo = '';
      pendingPolicyImage = null;
      pendingPolicyImageRemoved = false;
      renderPoliciesSection(patientId);
    });
  }
}

async function savePolicyInline(patientId) {
  const tipoSel = document.getElementById('pf-policy-tipo').value;
  if (!tipoSel) { showToast('Selecciona el tipo de póliza', 'err'); return; }
  if (tipoSel === OTRA_VALUE && !document.getElementById('pf-policy-tipo-otra').value.trim()) {
    showToast('Escribe el tipo de póliza', 'err'); return;
  }
  const numeroPoliza = document.getElementById('pf-policy-numero').value.trim();
  const aseguradora = document.getElementById('pf-policy-aseguradora').value.trim();
  const vigencia = readDateRangeField('pf-policy-vigencia');
  const wasEditing = !!editingPolicy;
  const oldImagePath = editingPolicy?.imagen?.path;
  try {
    const tipo = await resolveCatalogValue(state.household.id, CATEGORIA_POLIZA, tipoSel, document.getElementById('pf-policy-tipo-otra').value);
    let imagen = editingPolicy?.imagen || null;
    if (pendingPolicyImageRemoved) imagen = null;
    const base = editingPolicy ? { id: editingPolicy.id, imagen } : { imagen };
    let saved = await api.savePatientPolicy(
      { ...base, tipo, numeroPoliza, aseguradora, fechaInicio: vigencia.inicio, fechaFin: vigencia.fin },
      state.household.id, patientId);
    if (pendingPolicyImage) {
      const uploaded = await files.uploadAttachment(state.household.id, saved.id, 'poliza', pendingPolicyImage);
      saved = await api.savePatientPolicy({ ...saved, imagen: uploaded }, state.household.id, patientId);
    }
    // Si se reemplazó o se quitó la imagen anterior, se borra del bucket
    // recién ahora que el guardado ya tuvo éxito.
    if (oldImagePath && oldImagePath !== saved.imagen?.path) {
      files.removeAttachments([oldImagePath]);
    }
    policyFormOpen = false;
    editingPolicy = null;
    pendingPolicyTipo = '';
    pendingPolicyImage = null;
    pendingPolicyImageRemoved = false;
    showToast(wasEditing ? 'Póliza actualizada' : 'Póliza agregada');
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
    // Si el formulario de edición estaba abierto justo para esta póliza, se
    // cierra — ya no existe nada que guardar.
    if (editingPolicy?.id === id) {
      policyFormOpen = false;
      editingPolicy = null;
      pendingPolicyTipo = '';
      pendingPolicyImage = null;
      pendingPolicyImageRemoved = false;
    }
    showToast('Póliza eliminada', 'warn');
    renderPoliciesSection(patientId);
  } catch (err) {
    showToast(err.message || 'Error al eliminar la póliza', 'err');
  }
}

// ─────────────────────────────────────────
// Condiciones crónicas / diagnósticos CIE10 (MI AUDITORIA #5)
// Por ahora solo carga MANUAL del código (el usuario ya lo conoce). La
// búsqueda por código o nombre queda deferida a una fase futura — ver nota
// en la migración 0014.
// ─────────────────────────────────────────
async function renderDiagnosesSection(patientId) {
  const container = document.getElementById('pf-diagnoses-container');
  if (!container) return;

  const diagnoses = await api.listPatientDiagnoses(patientId);
  if (cronicoSectionOpen === null) cronicoSectionOpen = diagnoses.length > 0;

  const listHtml = diagnoses.length ? `
    <div id="pf-diagnoses-list" style="margin-top:8px">${diagnoses.map(d => `
      <div class="policy-item">
        <div class="policy-info">
          <div class="policy-tipo" style="font-family:'JetBrains Mono',monospace">${esc(d.codigoCie10)}</div>
          <div class="policy-num">${d.descripcion ? esc(d.descripcion) : 'Sin descripción'}</div>
        </div>
        <div class="policy-actions">
          <button type="button" class="btn btn-sm btn-icon" data-edit-diagnosis="${d.id}" title="Editar">
            <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button type="button" class="btn btn-sm btn-icon btn-danger" data-delete-diagnosis="${d.id}" title="Eliminar">
            <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>
      </div>`).join('')}</div>` : '';

  container.innerHTML = `
    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;margin-bottom:4px">
      <input type="checkbox" id="pf-cronicos-check" ${cronicoSectionOpen ? 'checked' : ''}/>
      <span style="font-size:13px;font-weight:600">Paciente con condiciones crónicas</span>
    </label>
    ${cronicoSectionOpen ? `
      ${listHtml || '<p style="font-size:12.5px;color:var(--ts);margin:4px 0 0">Sin diagnósticos registrados.</p>'}
      ${cronicoAddOpen ? `
        <div class="form-row cols-2" style="margin-top:8px">
          ${liveSearchFieldHtml('pf-diag', {
            label: 'Buscar enfermedad o síntoma',
            placeholder: 'Ej: presión alta, diabetes, asma…',
            span: true,
            hint: 'Búscalo como lo dices normalmente; se completa el código solo. También puedes escribir el código a mano abajo.',
          })}
          <div class="form-field">
            <label class="fl">Código CIE10</label>
            <input class="fi" id="pf-diag-codigo" type="text" placeholder="Ej: E11" style="font-family:'JetBrains Mono',monospace" value="${editingDiagnosis ? esc(editingDiagnosis.codigoCie10) : ''}"/>
          </div>
          <div class="form-field">
            <label class="fl">Descripción (opcional)</label>
            <input class="fi" id="pf-diag-desc" type="text" placeholder="Ej: Diabetes tipo 2" value="${editingDiagnosis ? esc(editingDiagnosis.descripcion || '') : ''}"/>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button type="button" class="btn btn-sm btn-primary" id="pf-diag-save-btn">${editingDiagnosis ? 'Guardar cambios' : 'Agregar diagnóstico'}</button>
          <button type="button" class="btn btn-sm" id="pf-diag-cancel-btn">Cancelar</button>
        </div>
      ` : `<button type="button" class="btn btn-sm" id="pf-diag-add-btn" style="margin-top:8px">+ Agregar diagnóstico</button>`}
    ` : ''}
  `;

  container.querySelectorAll('[data-delete-diagnosis]').forEach(el =>
    el.addEventListener('click', () => deleteDiagnosisConfirm(el.dataset.deleteDiagnosis, patientId)));
  container.querySelectorAll('[data-edit-diagnosis]').forEach(el =>
    el.addEventListener('click', () => {
      const d = diagnoses.find(x => x.id === el.dataset.editDiagnosis);
      if (!d) return;
      editingDiagnosis = d;
      cronicoAddOpen = true;
      renderDiagnosesSection(patientId);
    }));

  document.getElementById('pf-cronicos-check').addEventListener('change', (e) => {
    cronicoSectionOpen = e.target.checked;
    if (!cronicoSectionOpen) { cronicoAddOpen = false; editingDiagnosis = null; }
    renderDiagnosesSection(patientId);
  });

  if (cronicoSectionOpen) {
    if (cronicoAddOpen) {
      // Elegir de la lista rellena código y descripción, pero ambos siguen
      // siendo editables: la tabla que viaja con la app es un subconjunto
      // curado, así que quien tenga el código exacto del diagnóstico debe
      // poder corregirlo o escribirlo directamente.
      wireLiveSearch('pf-diag', {
        buscar: (q) => buscarSintomas(q, patientId),
        permitirLibre: true,
        textoLibre: 'Usar',
        onSelect: (sel) => {
          if (!sel) return;
          const codigo = sel.id?.startsWith('cie10:') ? sel.id.slice('cie10:'.length) : '';
          // El código se reescribe SIEMPRE, incluso a vacío. Si solo se
          // escribiera cuando la opción trae uno, elegir primero "Diabetes"
          // (E11) y después otra cosa dejaría la descripción nueva con el
          // código viejo — un diagnóstico crónico mal codificado, que es
          // exactamente el error que este campo no puede permitirse.
          document.getElementById('pf-diag-codigo').value = codigo;
          document.getElementById('pf-diag-desc').value = sel.label || '';
        },
      });
      fillLiveSearch('pf-diag', { label: editingDiagnosis?.descripcion || '' });
      document.getElementById('pf-diag-save-btn').addEventListener('click', () => saveDiagnosisInline(patientId));
      document.getElementById('pf-diag-cancel-btn').addEventListener('click', () => {
        cronicoAddOpen = false;
        editingDiagnosis = null;
        renderDiagnosesSection(patientId);
      });
    } else {
      document.getElementById('pf-diag-add-btn').addEventListener('click', () => {
        cronicoAddOpen = true;
        editingDiagnosis = null;
        renderDiagnosesSection(patientId);
      });
    }
  }
}

async function saveDiagnosisInline(patientId) {
  const codigoCie10 = document.getElementById('pf-diag-codigo').value.trim();
  if (!codigoCie10) {
    // La columna es obligatoria, así que un diagnóstico sin código no se
    // puede guardar. El mensaje señala las dos salidas, porque quien llegó
    // acá desde el buscador puede no saber que también puede escribirlo.
    showToast('Falta el código CIE10: elígelo del buscador o escríbelo', 'err'); return;
  }
  const descripcion = document.getElementById('pf-diag-desc').value.trim();
  const wasEditing = !!editingDiagnosis;
  try {
    if (editingDiagnosis) {
      await api.updatePatientDiagnosis(editingDiagnosis.id, { codigoCie10, descripcion });
    } else {
      await api.addPatientDiagnosis({ codigoCie10, descripcion }, state.household.id, patientId);
    }
    cronicoAddOpen = false;
    editingDiagnosis = null;
    showToast(wasEditing ? 'Diagnóstico actualizado' : 'Diagnóstico agregado');
    renderDiagnosesSection(patientId);
  } catch (err) {
    showToast(err.message || 'Error al guardar el diagnóstico', 'err');
  }
}

async function deleteDiagnosisConfirm(id, patientId) {
  if (!confirm('¿Eliminar este diagnóstico?')) return;
  try {
    await api.deletePatientDiagnosis(id);
    if (editingDiagnosis?.id === id) { cronicoAddOpen = false; editingDiagnosis = null; }
    showToast('Diagnóstico eliminado', 'warn');
    renderDiagnosesSection(patientId);
  } catch (err) {
    showToast(err.message || 'Error al eliminar el diagnóstico', 'err');
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
