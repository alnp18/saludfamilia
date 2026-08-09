import { state } from '../state.js';
import * as api from '../lib/api.js';
import { showModal, closeModal, showToast } from '../lib/modal.js';
import { esc } from '../lib/utils.js';
import { wireInlineNewCenter } from '../lib/inlineDirectory.js';
import { catalogOptionsHtml, resolveCatalogValue, OTRA_VALUE } from '../lib/extensibleCatalog.js';
import { emptyStateHtml, errorStateHtml } from '../lib/emptyState.js';
import { callLinkHtml, phoneFieldHtml } from '../lib/phone.js';
import { consentFieldHtml, readConsent } from '../lib/directoryConsent.js';

const SP_COLORS_MAP = {
  'Cardiología': '#0e7490', 'Neurología': '#7c3aed', 'Oncología': '#b45309',
  'Pediatría': '#047857', 'Ortopedia': '#1d4ed8', 'Ginecología': '#be185d',
  'Medicina Interna': '#0369a1', 'Radiología': '#c2410c', 'Laboratorio': '#047857',
};
// Reutilizada por Órdenes (selector "Médico tratante") para el mini-formulario
// de alta rápida de médico sin salir del asistente de la orden.
export const SPECIALTIES = Object.keys(SP_COLORS_MAP);
// Especialidad: fijas + "Otra…" extensible — tercer caso del mismo patrón
// que Pólizas (Pacientes) y Vía de administración (Medicamentos), ver
// nota transversal del plan (src/lib/extensibleCatalog.js).
const CATEGORIA_ESPECIALIDAD = 'especialidad';
let pendingEspOtra = false;

export async function render() {
  const container = document.getElementById('view-doctors');
  if (!container) return;

  container.innerHTML = `
    <div class="view-header">
      <div><div class="view-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> Médicos</div><div class="view-sub">Directorio de especialistas</div></div>
      <button class="btn btn-primary" id="btn-new-doctor"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Agregar médico</button>
    </div>
    <div id="doctors-content"></div>
  `;
  document.getElementById('btn-new-doctor').addEventListener('click', () => openDoctorModal());

  const el = document.getElementById('doctors-content');
  let docs, centers, mine;
  try {
    [docs, centers, mine] = await Promise.all([
      api.listDoctors(state.household.id),
      api.listCenters(state.household.id),
      // Propuestas propias al directorio público (pieza A): sirven solo para
      // decidir qué tarjeta ya está propuesta/publicada. Si falla, no debe
      // tumbar la vista — se degrada a "sin información de propuestas".
      api.listMyProposals(state.user.id).catch(() => ({ doctors: [], centers: [] })),
    ]);
  } catch (err) {
    showToast(err.message || 'No se pudieron cargar los médicos', 'err');
    el.innerHTML = errorStateHtml({ retryId: 'btn-retry-doctors' });
    document.getElementById('btn-retry-doctors').addEventListener('click', () => render());
    return;
  }
  const centerMap = Object.fromEntries(centers.map(c => [c.id, c.nombre]));
  // Estado de propuesta por registro privado (pendiente/publicado bloquean
  // volver a proponer; un rechazo NO — se puede corregir y reintentar).
  const proposedMap = {};
  mine.doctors.forEach(p => {
    if (p.origenPrivadoId && p.estado !== 'rechazado') proposedMap[p.origenPrivadoId] = p.estado;
  });

  if (!docs.length) {
    el.innerHTML = emptyStateHtml({
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>',
      title: 'Sin médicos registrados',
      message: 'Registra los especialistas que atienden a tus pacientes.',
      action: { id: 'btn-new-doctor-empty', label: 'Agregar primer médico' },
    });
    document.getElementById('btn-new-doctor-empty').addEventListener('click', () => openDoctorModal());
    return;
  }

  const bySpec = {};
  docs.forEach(d => {
    const sp = d.especialidad || 'Sin especialidad';
    (bySpec[sp] ||= []).push(d);
  });

  el.innerHTML = Object.entries(bySpec).sort(([a], [b]) => a.localeCompare(b)).map(([sp, list]) => {
    const col = SP_COLORS_MAP[sp] || '#374060';
    return `<div style="margin-bottom:22px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--ts);margin-bottom:10px;display:flex;align-items:center;gap:8px">
        <span style="width:8px;height:8px;border-radius:50%;background:${col};display:inline-block;flex-shrink:0"></span>${esc(sp)}
        <span style="color:var(--tm)">${list.length}</span>
        <span style="flex:1;height:1px;background:var(--border)"></span>
      </div>
      <div class="doc-grid">
        ${list.map(d => `<div class="doc-card">
          <div class="doc-avatar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M6 21v-2a6 6 0 0112 0v2"/></svg></div>
          <div style="flex:1;min-width:0">
            <div class="doc-name">${esc(d.nombre)}${directoryTag(d, proposedMap)}</div>
            ${d.tarjetaProfesional ? `<div class="doc-tarjeta">T.P. ${esc(d.tarjetaProfesional)}</div>` : ''}
            <div class="doc-detail">${d.consultorio ? esc(d.consultorio) + ' · ' : ''}${d.centroId ? esc(centerMap[d.centroId] || '') : ''}</div>
            ${d.tel ? `<div class="doc-detail">${esc(d.tel)} ${callLinkHtml(d.tel)}</div>` : ''}
          </div>
          ${puedeProponer(d, proposedMap) ? `<button class="btn btn-sm btn-icon btn-ghost" data-propose-id="${d.id}" title="Proponer al directorio de la comunidad"><svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v7a2 2 0 002 2h12a2 2 0 002-2v-7"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg></button>` : ''}
          <button class="btn btn-sm btn-icon btn-ghost" data-edit-id="${d.id}" title="Editar"><svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5"/></svg></button>
          <button class="btn btn-sm btn-icon btn-danger" data-delete-id="${d.id}" title="Eliminar"><svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862"/></svg></button>
        </div>`).join('')}
      </div>
    </div>`;
  }).join('');

  el.querySelectorAll('[data-edit-id]').forEach(b => b.addEventListener('click', () => openDoctorModal(b.dataset.editId)));
  el.querySelectorAll('[data-delete-id]').forEach(b => b.addEventListener('click', () => deleteDoctorConfirm(b.dataset.deleteId)));
  el.querySelectorAll('[data-propose-id]').forEach(b => b.addEventListener('click', () =>
    proposeDoctorConfirm(docs.find(d => d.id === b.dataset.proposeId), centerMap)));
}

/**
 * ¿Ofrecer el botón "Proponer al directorio"?
 *
 * Solo tiene sentido para quien dijo que NO al crear y después cambió de
 * opinión. Los que dijeron que sí ya viajaron solos (migración 0028) y volver
 * a proponerlos choca contra el antiduplicados: antes de esta comprobación el
 * botón aparecía siempre y fallaba siempre.
 *
 * `compartirDirectorio` puede venir undefined si el registro es anterior a la
 * migración 0030 — en ese caso se comporta como los antiguos, que ya se
 * compartieron, y no se ofrece.
 */
function puedeProponer(d, proposedMap) {
  return d.compartirDirectorio === false && !d.publicSourceId && !proposedMap[d.id];
}

/** Etiqueta junto al nombre según la relación con el directorio público. */
function directoryTag(d, proposedMap) {
  if (d.publicSourceId) return ' <span class="dir-mini-tag" title="Copiado desde el directorio público">Del directorio</span>';
  if (proposedMap[d.id] === 'pendiente') return ' <span class="dir-mini-tag" title="Propuesto al directorio público, en revisión">Propuesto</span>';
  if (proposedMap[d.id] === 'publicado') return ' <span class="dir-mini-tag" title="Publicado en el directorio público">En el directorio</span>';
  return '';
}

/** Proponer un médico privado al directorio público (pieza A): se envía una
 * copia de sus datos (el centro vinculado viaja como texto) y la
 * administradora la aprueba, corrige o rechaza antes de publicarla. */
function proposeDoctorConfirm(d, centerMap) {
  if (!d) return;
  const centroTexto = d.centroId ? (centerMap[d.centroId] || '') : '';
  const filas = [
    ['Nombre', d.nombre],
    ['Especialidad', d.especialidad],
    ['Tarjeta profesional', d.tarjetaProfesional],
    ['Centro médico', centroTexto],
    ['Consultorio', d.consultorio],
    ['Teléfono', d.tel],
    ['Notas', d.notas],
  ].filter(([, v]) => v);
  showModal(
    'Proponer al directorio público',
    `<div class="form-body">
      <p style="font-size:12.5px;color:var(--ts);margin:0 0 12px">Se enviará esta información a la administradora, que la revisará antes de publicarla para todas las familias. Tu registro privado no se modifica.</p>
      ${filas.map(([k, v]) => `<div class="dir-row"><strong style="min-width:130px;color:var(--tp)">${k}</strong><span>${esc(v)}</span></div>`).join('')}
    </div>`,
    [
      { label: 'Cancelar', cls: 'btn', action: closeModal },
      { label: 'Proponer', cls: 'btn btn-primary', action: async () => {
        try {
          await api.proposePublicDoctor({
            nombre: d.nombre,
            especialidad: d.especialidad || '',
            tarjetaProfesional: d.tarjetaProfesional || '',
            centro: centroTexto,
            consultorio: d.consultorio || '',
            tel: d.tel || '',
            notas: d.notas || '',
            origenPrivadoId: d.id,
          }, state.user.id);
          closeModal();
          showToast('Propuesta enviada a la administradora');
          render();
        } catch (err) {
          showToast(api.esPropuestaDuplicada(err)
            ? 'Ya está en el directorio o esperando revisión'
            : (err.message || 'No se pudo enviar la propuesta'), 'err');
        }
      } },
    ]
  );
}

async function openDoctorModal(id) {
  let centers, customEsp, publicEsp, d;
  try {
    [centers, customEsp, publicEsp, d] = await Promise.all([
      api.listCenters(state.household.id),
      api.listCatalogOptions(state.household.id, CATEGORIA_ESPECIALIDAD),
      // Especialidades ya aprobadas en el directorio compartido. No es
      // crítico: si falla, el desplegable queda con las fijas y las propias.
      api.listPublicSpecialties().catch(() => []),
      id ? api.getDoctor(id) : Promise.resolve(null),
    ]);
  } catch (err) {
    showToast(err.message || 'No se pudo abrir el formulario del médico', 'err');
    return;
  }
  // Las del directorio se mezclan con las del household y se ordenan juntas:
  // a quien llena el formulario no le importa de dónde salió cada una.
  const extraEsp = [...new Set([...customEsp, ...publicEsp])]
    .filter(e => !SPECIALTIES.includes(e))
    .sort((a, b) => a.localeCompare(b));
  const knownEsp = [...SPECIALTIES, ...extraEsp];
  // Compatibilidad: especialidad guardada que no está ni en las fijas ni
  // en el catálogo (dato viejo o importado) → se preselecciona "Otra…"
  // con el valor ya escrito, en vez de perderlo silenciosamente.
  pendingEspOtra = !!(d?.especialidad && !knownEsp.includes(d.especialidad));
  const espSelected = pendingEspOtra ? OTRA_VALUE : (d?.especialidad || '');

  showModal(
    id ? 'Editar médico' : 'Nuevo médico',
    `<div class="form-body">
      <div class="form-row cols-2">
        <div class="form-field span2"><label class="fl">Nombre completo *</label><input class="fi" id="df-nombre" type="text" placeholder="Dr. / Dra. Nombre Apellido" value="${esc(d?.nombre || '')}"/></div>
        <div class="form-field span2"><label class="fl">Número de tarjeta profesional</label><input class="fi" id="df-tarjeta" type="text" placeholder="Ej: RM-12345" value="${esc(d?.tarjetaProfesional || '')}"/></div>
        <div class="form-field"><label class="fl">Especialidad</label>
          <select class="fi" id="df-esp"><option value="">Seleccione especialidad</option>${catalogOptionsHtml(SPECIALTIES, extraEsp, espSelected)}</select>
        </div>
        <div class="form-field ${pendingEspOtra ? '' : 'hidden'}" id="df-esp-otra-field">
          <label class="fl">Especificar especialidad</label>
          <input class="fi" id="df-esp-otra" type="text" placeholder="Ej: Endocrinología" value="${esc(pendingEspOtra ? d.especialidad : '')}"/>
        </div>
        <div class="form-field">
          <label class="fl">Centro médico</label>
          <div style="display:flex;gap:6px">
            <select class="fi" id="df-centro" style="flex:1">
              <option value="">Sin centro asignado</option>
              ${centers.map(c => `<option value="${c.id}" ${d?.centroId === c.id ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}
            </select>
            <button type="button" class="btn btn-sm btn-icon" id="df-centro-add-btn" title="Agregar centro médico al directorio">+</button>
          </div>
        </div>
        <div class="form-field"><label class="fl">Consultorio</label><input class="fi" id="df-consul" type="text" placeholder="Ej: Piso 3, Cons. 301" value="${esc(d?.consultorio || '')}"/></div>
        ${phoneFieldHtml({ id: 'df-tel', label: 'Teléfono / Ext.', placeholder: 'Número directo o extensión', value: d?.tel || '' })}
        <div class="form-field span2"><label class="fl">Notas</label><textarea class="fi" id="df-notas" rows="2" placeholder="Horarios, indicaciones especiales…">${esc(d?.notas || '')}</textarea></div>
        ${id ? '' : consentFieldHtml({ id: 'df-compartir', tipo: 'medico' })}
      </div>
    </div>`,
    [
      { label: 'Cancelar', cls: 'btn', action: closeModal },
      { label: id ? 'Guardar cambios' : 'Agregar médico', cls: 'btn btn-primary', action: () => saveDoctorForm(id) },
    ]
  );
  wireInlineNewCenter('df-centro', 'df-centro-add-btn');
  document.getElementById('df-esp').addEventListener('change', (e) => {
    pendingEspOtra = e.target.value === OTRA_VALUE;
    document.getElementById('df-esp-otra-field').classList.toggle('hidden', !pendingEspOtra);
  });
}

async function saveDoctorForm(editId) {
  const nombre = document.getElementById('df-nombre').value.trim();
  if (!nombre) { showToast('El nombre es obligatorio', 'err'); return; }
  const espSel = document.getElementById('df-esp').value;
  if (espSel === OTRA_VALUE && !document.getElementById('df-esp-otra').value.trim()) {
    showToast('Escribe la especialidad', 'err'); return;
  }
  // La casilla solo existe al crear; al editar queda undefined y ni la
  // especialidad nueva ni el médico tocan la columna de consentimiento.
  const compartir = readConsent('df-compartir');
  const especialidad = await resolveCatalogValue(state.household.id, CATEGORIA_ESPECIALIDAD, espSel, document.getElementById('df-esp-otra').value, compartir);

  const obj = {
    id: editId || undefined,
    compartirDirectorio: compartir,
    nombre,
    tarjetaProfesional: document.getElementById('df-tarjeta').value.trim(),
    especialidad,
    centroId: document.getElementById('df-centro').value,
    consultorio: document.getElementById('df-consul').value.trim(),
    tel: document.getElementById('df-tel').value.trim(),
    notas: document.getElementById('df-notas').value.trim(),
  };
  try {
    await api.saveDoctor(obj, state.household.id);
    closeModal();
    showToast(editId ? 'Médico actualizado' : 'Médico registrado');
    render();
  } catch (err) {
    showToast(err.message || 'Error al guardar', 'err');
  }
}

async function deleteDoctorConfirm(id) {
  if (!confirm('¿Eliminar este médico del directorio?')) return;
  try {
    await api.deleteDoctor(id);
    showToast('Médico eliminado', 'warn');
    render();
  } catch (err) {
    showToast(err.message || 'Error al eliminar el médico', 'err');
  }
}
