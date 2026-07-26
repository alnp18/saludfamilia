import { state } from '../state.js';
import * as api from '../lib/api.js';
import { showModal, closeModal, showToast } from '../lib/modal.js';
import { esc, safeUrl } from '../lib/utils.js';
import { Icons } from '../lib/icons.js';
import { callLinkHtml, phoneFieldHtml } from '../lib/phone.js';
import { SPECIALTIES } from './doctors.js';
import { emptyStateHtml, errorStateHtml } from '../lib/emptyState.js';

/**
 * Directorio público auditado (pieza A de arquitectura).
 *
 * Vista compartida entre TODAS las familias: médicos y centros publicados,
 * que cualquier usuario puede copiar a su directorio privado (la copia es
 * independiente y editable; guarda su procedencia en publicSourceId). Las
 * entradas nuevas llegan por propuesta desde Médicos / Centros médicos y
 * las revisa la administradora (tabla app_admins), que también puede
 * publicar directamente desde acá.
 *
 * La RLS de la migración 0020 es la autoridad de permisos; esta vista solo
 * decide qué interfaz mostrar (p. ej. la pestaña Revisión si isAdmin).
 */

let activeTab = 'doctors'; // 'doctors' | 'centers' | 'mine' | 'review'
// Cache por sesión: la membresía en app_admins no cambia en caliente y la
// página se recarga al cerrar sesión, así que basta consultarla una vez.
let isAdmin = null;

const TITLE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>';

export async function render() {
  const container = document.getElementById('view-directory');
  if (!container) return;

  container.innerHTML = `
    <div class="view-header">
      <div>
        <div class="view-title">${TITLE_SVG} Directorio público</div>
        <div class="view-sub">Médicos y centros compartidos entre todas las familias, revisados por la administradora</div>
      </div>
      <div id="dir-header-action"></div>
    </div>
    <div class="filter-pills" id="dir-tabs" style="margin-bottom:14px"></div>
    <div id="dir-content"></div>
  `;

  const el = document.getElementById('dir-content');
  let pubDocs, pubCenters, myDocs, myCenters, mine, pendDocs, pendCenters;
  try {
    if (isAdmin === null) isAdmin = await api.isDirectoryAdmin();
    [pubDocs, pubCenters, myDocs, myCenters, mine, pendDocs, pendCenters] = await Promise.all([
      api.listPublicDoctors('publicado'),
      api.listPublicCenters('publicado'),
      api.listDoctors(state.household.id),
      api.listCenters(state.household.id),
      api.listMyProposals(state.user.id),
      isAdmin ? api.listPublicDoctors('pendiente') : Promise.resolve([]),
      isAdmin ? api.listPublicCenters('pendiente') : Promise.resolve([]),
    ]);
  } catch (err) {
    showToast(err.message || 'No se pudo cargar el directorio público', 'err');
    el.innerHTML = errorStateHtml({ retryId: 'btn-retry-directory' });
    document.getElementById('btn-retry-directory').addEventListener('click', () => render());
    return;
  }

  if (activeTab === 'review' && !isAdmin) activeTab = 'doctors';

  // ── Pestañas ──
  const pendCount = pendDocs.length + pendCenters.length;
  const myCount = mine.doctors.length + mine.centers.length;
  const pill = (key, label, count) => `
    <div class="filter-pill ${activeTab === key ? 'active' : ''}" data-dir-tab="${key}">
      ${label}${count !== null ? ` <span class="count">${count}</span>` : ''}
    </div>`;
  document.getElementById('dir-tabs').innerHTML = [
    pill('doctors', 'Médicos', pubDocs.length),
    pill('centers', 'Centros', pubCenters.length),
    pill('mine', 'Mis propuestas', myCount),
    isAdmin ? pill('review', 'Revisión', pendCount) : '',
  ].join('');
  document.querySelectorAll('[data-dir-tab]').forEach(t =>
    t.addEventListener('click', () => { activeTab = t.dataset.dirTab; render(); }));

  // ── Acción del encabezado (solo admin: alta directa ya publicada) ──
  const actionEl = document.getElementById('dir-header-action');
  if (isAdmin && (activeTab === 'doctors' || activeTab === 'centers')) {
    const label = activeTab === 'doctors' ? 'Publicar médico' : 'Publicar centro';
    actionEl.innerHTML = `<button class="btn btn-primary" id="btn-dir-publish"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> ${label}</button>`;
    document.getElementById('btn-dir-publish').addEventListener('click', () =>
      activeTab === 'doctors' ? openPublicDoctorModal() : openPublicCenterModal());
  }

  // ── Contenido de la pestaña activa ──
  if (activeTab === 'doctors') renderDoctorsTab(el, pubDocs, myDocs);
  else if (activeTab === 'centers') renderCentersTab(el, pubCenters, myCenters);
  else if (activeTab === 'mine') renderMineTab(el, mine);
  else renderReviewTab(el, pendDocs, pendCenters);
}

// ─────────────────────────────────────────
// Pestaña Médicos (publicados)
// ─────────────────────────────────────────
function renderDoctorsTab(el, pubDocs, myDocs) {
  if (!pubDocs.length) {
    el.innerHTML = emptyStateHtml({
      icon: Icons.user,
      title: 'Aún no hay médicos publicados',
      message: isAdmin
        ? 'Publica el primero directamente o espera propuestas de las familias.'
        : 'Propón médicos desde tu sección Médicos (botón "Proponer al directorio"): la administradora los revisa y publica.',
      action: isAdmin ? { id: 'btn-dir-first-doctor', label: 'Publicar médico' } : null,
    });
    document.getElementById('btn-dir-first-doctor')?.addEventListener('click', () => openPublicDoctorModal());
    return;
  }

  // Ids del directorio ya copiados a la familia actual.
  const copiedIds = new Set(myDocs.filter(d => d.publicSourceId).map(d => d.publicSourceId));

  const bySpec = {};
  pubDocs.forEach(d => {
    const sp = d.especialidad || 'Sin especialidad';
    (bySpec[sp] ||= []).push(d);
  });

  el.innerHTML = Object.entries(bySpec).sort(([a], [b]) => a.localeCompare(b)).map(([sp, list]) => `
    <div style="margin-bottom:22px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--ts);margin-bottom:10px;display:flex;align-items:center;gap:8px">
        ${esc(sp)} <span style="color:var(--tm)">${list.length}</span>
        <span style="flex:1;height:1px;background:var(--border)"></span>
      </div>
      <div class="doc-grid">
        ${list.map(d => `<div class="doc-card">
          <div class="doc-avatar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M6 21v-2a6 6 0 0112 0v2"/></svg></div>
          <div style="flex:1;min-width:0">
            <div class="doc-name">${esc(d.nombre)}</div>
            ${d.tarjetaProfesional ? `<div class="doc-tarjeta">T.P. ${esc(d.tarjetaProfesional)}</div>` : ''}
            <div class="doc-detail">${[d.centro, d.consultorio, d.tel].filter(Boolean).map(esc).join(' · ')}</div>
          </div>
          ${copiedIds.has(d.id)
            ? '<span class="dir-mini-tag" title="Ya lo copiaste a tu directorio de Médicos">En tu directorio</span>'
            : `<button class="btn btn-sm" data-copy-doc="${d.id}" title="Copiar a tu directorio de Médicos (podrás editarlo libremente)">Copiar</button>`}
          ${isAdmin ? `
            <button class="btn btn-sm btn-icon btn-ghost" data-edit-doc="${d.id}" title="Editar entrada pública"><svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5"/></svg></button>
            <button class="btn btn-sm btn-icon btn-danger" data-del-doc="${d.id}" title="Eliminar del directorio público"><svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862"/></svg></button>` : ''}
        </div>`).join('')}
      </div>
    </div>`).join('');

  el.querySelectorAll('[data-copy-doc]').forEach(b => b.addEventListener('click', () =>
    copyDoctorToHousehold(pubDocs.find(d => d.id === b.dataset.copyDoc))));
  el.querySelectorAll('[data-edit-doc]').forEach(b => b.addEventListener('click', () =>
    openPublicDoctorModal(pubDocs.find(d => d.id === b.dataset.editDoc))));
  el.querySelectorAll('[data-del-doc]').forEach(b => b.addEventListener('click', () =>
    adminDeleteConfirm('doctor', b.dataset.delDoc)));
}

// ─────────────────────────────────────────
// Pestaña Centros (publicados)
// ─────────────────────────────────────────
function renderCentersTab(el, pubCenters, myCenters) {
  if (!pubCenters.length) {
    el.innerHTML = emptyStateHtml({
      icon: Icons.hospital,
      title: 'Aún no hay centros publicados',
      message: isAdmin
        ? 'Publica el primero directamente o espera propuestas de las familias.'
        : 'Propón centros desde tu sección Centros médicos (botón "Proponer al directorio"): la administradora los revisa y publica.',
      action: isAdmin ? { id: 'btn-dir-first-center', label: 'Publicar centro' } : null,
    });
    document.getElementById('btn-dir-first-center')?.addEventListener('click', () => openPublicCenterModal());
    return;
  }

  const copiedIds = new Set(myCenters.filter(c => c.publicSourceId).map(c => c.publicSourceId));

  el.innerHTML = `<div class="dir-grid">
    ${pubCenters.map(c => `<div class="dir-card">
      <div class="dir-card-top">
        <div class="dir-avatar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16"/></svg></div>
        <div style="flex:1;min-width:0"><div class="dir-name">${esc(c.nombre)}</div></div>
        ${copiedIds.has(c.id)
          ? '<span class="dir-mini-tag" title="Ya lo copiaste a tu directorio de Centros médicos">En tu directorio</span>'
          : `<button class="btn btn-sm" data-copy-cen="${c.id}" title="Copiar a tu directorio de Centros médicos (podrás editarlo libremente)">Copiar</button>`}
        ${isAdmin ? `
          <button class="btn btn-sm btn-icon btn-ghost" data-edit-cen="${c.id}" title="Editar entrada pública"><svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5"/></svg></button>
          <button class="btn btn-sm btn-icon btn-danger" data-del-cen="${c.id}" title="Eliminar del directorio público"><svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862"/></svg></button>` : ''}
      </div>
      ${c.tel1 ? `<div class="dir-row">${Icons.phone}<span>${esc(c.tel1)}</span>${callLinkHtml(c.tel1)}</div>` : ''}
      ${c.tel2 ? `<div class="dir-row">${Icons.phone}<span>${esc(c.tel2)}</span>${callLinkHtml(c.tel2)}</div>` : ''}
      ${c.dir ? `<div class="dir-row">${Icons.hospital}<span>${esc(c.dir)}</span></div>` : ''}
      ${c.email ? `<div class="dir-row">${Icons.mail}<span>${esc(c.email)}</span></div>` : ''}
      ${c.web && safeUrl(c.web) ? `<div class="dir-row">${Icons.globe}<a href="${esc(safeUrl(c.web))}" target="_blank" rel="noopener noreferrer">${esc(c.web)}</a></div>` : ''}
    </div>`).join('')}
  </div>`;

  el.querySelectorAll('[data-copy-cen]').forEach(b => b.addEventListener('click', () =>
    copyCenterToHousehold(pubCenters.find(c => c.id === b.dataset.copyCen))));
  el.querySelectorAll('[data-edit-cen]').forEach(b => b.addEventListener('click', () =>
    openPublicCenterModal(pubCenters.find(c => c.id === b.dataset.editCen))));
  el.querySelectorAll('[data-del-cen]').forEach(b => b.addEventListener('click', () =>
    adminDeleteConfirm('center', b.dataset.delCen)));
}

// ─────────────────────────────────────────
// Pestaña Mis propuestas
// ─────────────────────────────────────────
const ESTADO_LABEL = { pendiente: 'En revisión', publicado: 'Publicado', rechazado: 'Rechazado' };

function renderMineTab(el, mine) {
  const rows = [
    ...mine.doctors.map(d => ({ kind: 'doctor', item: d })),
    ...mine.centers.map(c => ({ kind: 'center', item: c })),
  ].sort((a, b) => (b.item.creadoEn || '').localeCompare(a.item.creadoEn || ''));

  if (!rows.length) {
    el.innerHTML = emptyStateHtml({
      icon: Icons.globe,
      title: 'No has propuesto nada todavía',
      message: 'En Médicos y Centros médicos, cada tarjeta tiene un botón "Proponer al directorio". Lo que propongas aparecerá aquí con su estado.',
    });
    return;
  }

  el.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px">
    ${rows.map(({ kind, item }) => `
      <div class="dir-proposal-row">
        <div class="dir-avatar">${kind === 'doctor' ? Icons.user : Icons.hospital}</div>
        <div style="flex:1;min-width:0">
          <div class="dir-name" style="font-size:13.5px">${esc(item.nombre)}</div>
          <div class="doc-detail">${kind === 'doctor'
            ? [item.especialidad, item.centro].filter(Boolean).map(esc).join(' · ') || 'Médico'
            : [item.dir, item.tel1].filter(Boolean).map(esc).join(' · ') || 'Centro médico'}</div>
          ${item.estado === 'rechazado' && item.notaRevision
            ? `<div class="dir-review-note">Nota de la administradora: “${esc(item.notaRevision)}”</div>` : ''}
        </div>
        <span class="dir-status ${item.estado}">${ESTADO_LABEL[item.estado] || esc(item.estado)}</span>
        ${item.estado === 'pendiente'
          ? `<button class="btn btn-sm" data-withdraw="${kind}:${item.id}" title="Retirar la propuesta antes de que se revise">Retirar</button>` : ''}
        ${item.estado === 'rechazado'
          ? `<button class="btn btn-sm" data-withdraw="${kind}:${item.id}" title="Quitar de esta lista (podrás corregir y volver a proponer)">Descartar</button>` : ''}
      </div>`).join('')}
  </div>`;

  el.querySelectorAll('[data-withdraw]').forEach(b => b.addEventListener('click', async () => {
    const [kind, id] = b.dataset.withdraw.split(':');
    if (!confirm('¿Quitar esta propuesta?')) return;
    try {
      await (kind === 'doctor' ? api.deletePublicDoctor(id) : api.deletePublicCenter(id));
      showToast('Propuesta retirada', 'warn');
      render();
    } catch (err) {
      showToast(err.message || 'No se pudo retirar la propuesta', 'err');
    }
  }));
}

// ─────────────────────────────────────────
// Pestaña Revisión (solo admin)
// ─────────────────────────────────────────
function renderReviewTab(el, pendDocs, pendCenters) {
  const rows = [
    ...pendDocs.map(d => ({ kind: 'doctor', item: d })),
    ...pendCenters.map(c => ({ kind: 'center', item: c })),
  ].sort((a, b) => (a.item.creadoEn || '').localeCompare(b.item.creadoEn || ''));

  if (!rows.length) {
    el.innerHTML = emptyStateHtml({
      icon: Icons.checkCircle,
      title: 'Nada pendiente de revisión',
      message: 'Cuando una familia proponga un médico o un centro, aparecerá aquí para aprobarlo, corregirlo o rechazarlo.',
    });
    return;
  }

  const detail = ({ kind, item }) => kind === 'doctor'
    ? [item.especialidad, item.tarjetaProfesional && 'T.P. ' + item.tarjetaProfesional, item.centro,
       item.consultorio, item.tel, item.notas].filter(Boolean).map(esc).join(' · ')
    : [item.dir, item.tel1, item.tel2, item.email, item.web, item.notas].filter(Boolean).map(esc).join(' · ');

  el.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px">
    ${rows.map(({ kind, item }) => `
      <div class="dir-proposal-row">
        <div class="dir-avatar">${kind === 'doctor' ? Icons.user : Icons.hospital}</div>
        <div style="flex:1;min-width:0">
          <div class="dir-name" style="font-size:13.5px">${esc(item.nombre)}
            <span style="font-size:11px;font-weight:500;color:var(--tm)">· ${kind === 'doctor' ? 'Médico' : 'Centro médico'}</span>
          </div>
          <div class="doc-detail">${detail({ kind, item }) || 'Sin datos adicionales'}</div>
        </div>
        <button class="btn btn-sm btn-primary" data-approve="${kind}:${item.id}">Aprobar</button>
        <button class="btn btn-sm" data-edit-pending="${kind}:${item.id}" title="Corregir los datos antes de aprobar">Editar</button>
        <button class="btn btn-sm btn-danger" data-reject="${kind}:${item.id}">Rechazar</button>
      </div>`).join('')}
  </div>`;

  const findItem = (spec) => {
    const [kind, id] = spec.split(':');
    const item = (kind === 'doctor' ? pendDocs : pendCenters).find(x => x.id === id);
    return { kind, id, item };
  };

  el.querySelectorAll('[data-approve]').forEach(b => b.addEventListener('click', async () => {
    const { kind, id } = findItem(b.dataset.approve);
    try {
      await (kind === 'doctor'
        ? api.setPublicDoctorEstado(id, 'publicado')
        : api.setPublicCenterEstado(id, 'publicado'));
      showToast('Publicado en el directorio');
      render();
    } catch (err) {
      showToast(err.message || 'No se pudo aprobar', 'err');
    }
  }));

  el.querySelectorAll('[data-edit-pending]').forEach(b => b.addEventListener('click', () => {
    const { kind, item } = findItem(b.dataset.editPending);
    if (kind === 'doctor') openPublicDoctorModal(item); else openPublicCenterModal(item);
  }));

  el.querySelectorAll('[data-reject]').forEach(b => b.addEventListener('click', () => {
    const { kind, id } = findItem(b.dataset.reject);
    openRejectModal(kind, id);
  }));
}

function openRejectModal(kind, id) {
  showModal(
    'Rechazar propuesta',
    `<div class="form-body">
      <p style="font-size:12.5px;color:var(--ts);margin:0 0 10px">La proponente verá el rechazo en "Mis propuestas". Puedes dejarle una nota con el motivo (opcional).</p>
      <div class="form-field"><label class="fl">Nota para la proponente</label>
        <textarea class="fi" id="dir-reject-note" rows="2" placeholder="Ej: faltan teléfonos de contacto, entrada duplicada…"></textarea>
      </div>
    </div>`,
    [
      { label: 'Cancelar', cls: 'btn', action: closeModal },
      { label: 'Rechazar propuesta', cls: 'btn btn-danger', action: async () => {
        try {
          const nota = document.getElementById('dir-reject-note').value.trim();
          await (kind === 'doctor'
            ? api.setPublicDoctorEstado(id, 'rechazado', nota)
            : api.setPublicCenterEstado(id, 'rechazado', nota));
          closeModal();
          showToast('Propuesta rechazada', 'warn');
          render();
        } catch (err) {
          showToast(err.message || 'No se pudo rechazar', 'err');
        }
      } },
    ]
  );
}

// ─────────────────────────────────────────
// Copiar al directorio privado de la familia
// ─────────────────────────────────────────
async function copyDoctorToHousehold(pd) {
  if (!pd) return;
  try {
    // Si el centro (texto) coincide exactamente con un centro privado, se
    // vincula; si no, el nombre queda visible solo en el directorio público
    // (el usuario puede crear/vincular su centro después, editando la copia).
    const centers = await api.listCenters(state.household.id);
    const match = pd.centro
      ? centers.find(c => c.nombre.trim().toLowerCase() === pd.centro.trim().toLowerCase())
      : null;
    await api.saveDoctor({
      nombre: pd.nombre,
      especialidad: pd.especialidad || '',
      tarjetaProfesional: pd.tarjetaProfesional || '',
      centroId: match ? match.id : '',
      consultorio: pd.consultorio || '',
      tel: pd.tel || '',
      notas: pd.notas || '',
      publicSourceId: pd.id,
    }, state.household.id);
    showToast(match ? 'Médico copiado (centro vinculado por nombre)' : 'Médico copiado a tu directorio');
    render();
  } catch (err) {
    showToast(err.message || 'No se pudo copiar el médico', 'err');
  }
}

async function copyCenterToHousehold(pc) {
  if (!pc) return;
  try {
    await api.saveCenter({
      nombre: pc.nombre, tel1: pc.tel1 || '', tel2: pc.tel2 || '',
      dir: pc.dir || '', email: pc.email || '', web: pc.web || '',
      publicSourceId: pc.id,
    }, state.household.id);
    showToast('Centro copiado a tu directorio');
    render();
  } catch (err) {
    showToast(err.message || 'No se pudo copiar el centro', 'err');
  }
}

// ─────────────────────────────────────────
// Alta directa / edición (solo admin)
// ─────────────────────────────────────────
function openPublicDoctorModal(d) {
  showModal(
    d ? 'Editar médico del directorio' : 'Publicar médico en el directorio',
    `<div class="form-body">
      ${d?.estado === 'pendiente' ? '<p style="font-size:12px;color:var(--ts);margin:0 0 10px">Estás corrigiendo una propuesta pendiente: al guardar sigue pendiente, apruébala desde Revisión.</p>' : ''}
      <div class="form-row cols-2">
        <div class="form-field span2"><label class="fl">Nombre completo *</label><input class="fi" id="pdf-nombre" type="text" placeholder="Dr. / Dra. Nombre Apellido" value="${esc(d?.nombre || '')}"/></div>
        <div class="form-field"><label class="fl">Especialidad</label>
          <input class="fi" id="pdf-esp" type="text" list="pdf-esp-list" placeholder="Ej: Cardiología" value="${esc(d?.especialidad || '')}"/>
          <datalist id="pdf-esp-list">${SPECIALTIES.map(s => `<option value="${esc(s)}"></option>`).join('')}</datalist>
        </div>
        <div class="form-field"><label class="fl">Número de tarjeta profesional</label><input class="fi" id="pdf-tarjeta" type="text" placeholder="Ej: RM-12345" value="${esc(d?.tarjetaProfesional || '')}"/></div>
        <div class="form-field"><label class="fl">Centro médico (texto)</label><input class="fi" id="pdf-centro" type="text" placeholder="Nombre del centro donde atiende" value="${esc(d?.centro || '')}"/></div>
        <div class="form-field"><label class="fl">Consultorio</label><input class="fi" id="pdf-consul" type="text" placeholder="Ej: Piso 3, Cons. 301" value="${esc(d?.consultorio || '')}"/></div>
        ${phoneFieldHtml({ id: 'pdf-tel', label: 'Teléfono / Ext.', placeholder: 'Número directo o extensión', value: d?.tel || '' })}
        <div class="form-field span2"><label class="fl">Notas</label><textarea class="fi" id="pdf-notas" rows="2" placeholder="Horarios, indicaciones…">${esc(d?.notas || '')}</textarea></div>
      </div>
    </div>`,
    [
      { label: 'Cancelar', cls: 'btn', action: closeModal },
      { label: d ? 'Guardar cambios' : 'Publicar', cls: 'btn btn-primary', action: async () => {
        const nombre = document.getElementById('pdf-nombre').value.trim();
        if (!nombre) { showToast('El nombre es obligatorio', 'err'); return; }
        try {
          await api.savePublicDoctor({
            id: d?.id,
            nombre,
            especialidad: document.getElementById('pdf-esp').value.trim(),
            tarjetaProfesional: document.getElementById('pdf-tarjeta').value.trim(),
            centro: document.getElementById('pdf-centro').value.trim(),
            consultorio: document.getElementById('pdf-consul').value.trim(),
            tel: document.getElementById('pdf-tel').value.trim(),
            notas: document.getElementById('pdf-notas').value.trim(),
          }, state.user.id);
          closeModal();
          showToast(d ? 'Entrada actualizada' : 'Médico publicado en el directorio');
          render();
        } catch (err) {
          showToast(err.message || 'Error al guardar', 'err');
        }
      } },
    ]
  );
}

function openPublicCenterModal(c) {
  showModal(
    c ? 'Editar centro del directorio' : 'Publicar centro en el directorio',
    `<div class="form-body">
      ${c?.estado === 'pendiente' ? '<p style="font-size:12px;color:var(--ts);margin:0 0 10px">Estás corrigiendo una propuesta pendiente: al guardar sigue pendiente, apruébala desde Revisión.</p>' : ''}
      <div class="form-row cols-2">
        <div class="form-field span2"><label class="fl">Nombre *</label><input class="fi" id="pcf-nombre" type="text" placeholder="Nombre del centro o clínica" value="${esc(c?.nombre || '')}"/></div>
        ${phoneFieldHtml({ id: 'pcf-tel1', label: 'Teléfono 1', placeholder: '(+57) 601…', value: c?.tel1 || '' })}
        ${phoneFieldHtml({ id: 'pcf-tel2', label: 'Teléfono 2', placeholder: 'Opcional', value: c?.tel2 || '' })}
        <div class="form-field span2"><label class="fl">Dirección</label><input class="fi" id="pcf-dir" type="text" placeholder="Calle, carrera, ciudad…" value="${esc(c?.dir || '')}"/></div>
        <div class="form-field"><label class="fl">Correo</label><input class="fi" id="pcf-email" type="email" placeholder="info@clinica.com" value="${esc(c?.email || '')}"/></div>
        <div class="form-field"><label class="fl">Sitio web</label><input class="fi" id="pcf-web" type="url" placeholder="https://…" value="${esc(c?.web || '')}"/></div>
      </div>
    </div>`,
    [
      { label: 'Cancelar', cls: 'btn', action: closeModal },
      { label: c ? 'Guardar cambios' : 'Publicar', cls: 'btn btn-primary', action: async () => {
        const nombre = document.getElementById('pcf-nombre').value.trim();
        if (!nombre) { showToast('El nombre es obligatorio', 'err'); return; }
        try {
          await api.savePublicCenter({
            id: c?.id,
            nombre,
            tel1: document.getElementById('pcf-tel1').value.trim(),
            tel2: document.getElementById('pcf-tel2').value.trim(),
            dir: document.getElementById('pcf-dir').value.trim(),
            email: document.getElementById('pcf-email').value.trim(),
            web: document.getElementById('pcf-web').value.trim(),
          }, state.user.id);
          closeModal();
          showToast(c ? 'Entrada actualizada' : 'Centro publicado en el directorio');
          render();
        } catch (err) {
          showToast(err.message || 'Error al guardar', 'err');
        }
      } },
    ]
  );
}

function adminDeleteConfirm(kind, id) {
  if (!confirm('¿Eliminar esta entrada del directorio público? Las copias que las familias ya hicieron seguirán intactas en sus directorios privados.')) return;
  (kind === 'doctor' ? api.deletePublicDoctor(id) : api.deletePublicCenter(id))
    .then(() => { showToast('Entrada eliminada del directorio', 'warn'); render(); })
    .catch(err => showToast(err.message || 'No se pudo eliminar', 'err'));
}
