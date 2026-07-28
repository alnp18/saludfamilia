import { state } from '../state.js';
import * as api from '../lib/api.js';
import { showModal, closeModal, showToast } from '../lib/modal.js';
import { esc, safeUrl } from '../lib/utils.js';
import { emptyStateHtml, errorStateHtml } from '../lib/emptyState.js';
import { geoFieldsHtml, wireGeoFields, fillGeoFields, readGeoFields } from '../lib/geo.js';
import { callLinkHtml, phoneFieldHtml } from '../lib/phone.js';

export async function render() {
  const container = document.getElementById('view-centers');
  if (!container) return;

  container.innerHTML = `
    <div class="view-header">
      <div><div class="view-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg> Centros médicos</div><div class="view-sub">Directorio de instituciones y prestadores</div></div>
      <button class="btn btn-primary" id="btn-new-center"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Agregar centro</button>
    </div>
    <div id="centers-content"></div>
  `;
  document.getElementById('btn-new-center').addEventListener('click', () => openCenterModal());

  const el = document.getElementById('centers-content');
  let centers, mine;
  try {
    [centers, mine] = await Promise.all([
      api.listCenters(state.household.id),
      // Propuestas propias al directorio público (pieza A) — no crítico:
      // si falla, la vista sigue funcionando sin esa información.
      api.listMyProposals(state.user.id).catch(() => ({ doctors: [], centers: [] })),
    ]);
  } catch (err) {
    showToast(err.message || 'No se pudieron cargar los centros médicos', 'err');
    el.innerHTML = errorStateHtml({ retryId: 'btn-retry-centers' });
    document.getElementById('btn-retry-centers').addEventListener('click', () => render());
    return;
  }
  const proposedMap = {};
  mine.centers.forEach(p => {
    if (p.origenPrivadoId && p.estado !== 'rechazado') proposedMap[p.origenPrivadoId] = p.estado;
  });

  if (!centers.length) {
    el.innerHTML = emptyStateHtml({
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>',
      title: 'Sin centros médicos',
      message: 'Agrega los centros y clínicas que uses frecuentemente.',
      action: { id: 'btn-new-center-empty', label: 'Agregar primer centro' },
    });
    document.getElementById('btn-new-center-empty').addEventListener('click', () => openCenterModal());
    return;
  }

  el.innerHTML = `<div class="dir-grid">
    ${centers.map(c => `<div class="dir-card">
      <div class="dir-card-top">
        <div class="dir-avatar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16"/></svg></div>
        <div style="flex:1;min-width:0"><div class="dir-name">${esc(c.nombre)}${directoryTag(c, proposedMap)}</div></div>
        ${!c.publicSourceId && !proposedMap[c.id] ? `<button class="btn btn-sm btn-icon btn-ghost" data-propose-id="${c.id}" title="Proponer al directorio público"><svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v7a2 2 0 002 2h12a2 2 0 002-2v-7"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg></button>` : ''}
        <button class="btn btn-sm btn-icon btn-ghost" data-edit-id="${c.id}" title="Editar"><svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5"/></svg></button>
        <button class="btn btn-sm btn-icon btn-danger" data-delete-id="${c.id}" title="Eliminar"><svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862"/></svg></button>
      </div>
      ${c.tel1 ? `<div class="dir-row">${esc(c.tel1)} ${callLinkHtml(c.tel1)}</div>` : ''}
      ${c.tel2 ? `<div class="dir-row">${esc(c.tel2)} ${callLinkHtml(c.tel2)}</div>` : ''}
      ${(c.dir || c.municipio) ? `<div class="dir-row">${esc([c.dir, c.municipio, c.departamento].filter(Boolean).join(', '))}</div>` : ''}
      ${c.email ? `<div class="dir-row"><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></div>` : ''}
      ${c.web && safeUrl(c.web) ? `<div class="dir-row"><a href="${esc(safeUrl(c.web))}" target="_blank" rel="noopener noreferrer">${esc(c.web)}</a></div>` : ''}
    </div>`).join('')}
  </div>`;

  el.querySelectorAll('[data-edit-id]').forEach(b => b.addEventListener('click', () => openCenterModal(b.dataset.editId)));
  el.querySelectorAll('[data-delete-id]').forEach(b => b.addEventListener('click', () => deleteCenterConfirm(b.dataset.deleteId)));
  el.querySelectorAll('[data-propose-id]').forEach(b => b.addEventListener('click', () =>
    proposeCenterConfirm(centers.find(c => c.id === b.dataset.proposeId))));
}

/** Etiqueta junto al nombre según la relación con el directorio público. */
function directoryTag(c, proposedMap) {
  if (c.publicSourceId) return ' <span class="dir-mini-tag" title="Copiado desde el directorio público">Del directorio</span>';
  if (proposedMap[c.id] === 'pendiente') return ' <span class="dir-mini-tag" title="Propuesto al directorio público, en revisión">Propuesto</span>';
  if (proposedMap[c.id] === 'publicado') return ' <span class="dir-mini-tag" title="Publicado en el directorio público">En el directorio</span>';
  return '';
}

/** Proponer un centro privado al directorio público (pieza A). */
function proposeCenterConfirm(c) {
  if (!c) return;
  const filas = [
    ['Nombre', c.nombre],
    ['Teléfonos', [c.tel1, c.tel2].filter(Boolean).join(' · ')],
    ['Dirección', c.dir],
    ['Correo', c.email],
    ['Sitio web', c.web],
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
          await api.proposePublicCenter({
            nombre: c.nombre, tel1: c.tel1 || '', tel2: c.tel2 || '',
            dir: c.dir || '', email: c.email || '', web: c.web || '',
            origenPrivadoId: c.id,
          }, state.user.id);
          closeModal();
          showToast('Propuesta enviada a la administradora');
          render();
        } catch (err) {
          showToast(err.message || 'No se pudo enviar la propuesta', 'err');
        }
      } },
    ]
  );
}

function openCenterModal(id) {
  showModal(
    id ? 'Editar centro médico' : 'Nuevo centro médico',
    `<div class="form-body">
      <div class="form-row cols-2">
        <div class="form-field span2"><label class="fl">Nombre *</label><input class="fi" id="cf-nombre" type="text" placeholder="Nombre del centro o clínica"/></div>
        ${phoneFieldHtml({ id: 'cf-tel1', label: 'Teléfono 1', placeholder: '(+57) 601…' })}
        ${phoneFieldHtml({ id: 'cf-tel2', label: 'Teléfono 2', placeholder: 'Opcional' })}
        <div class="form-field span2"><label class="fl">Dirección</label><input class="fi" id="cf-dir" type="text" placeholder="Calle, carrera…"/></div>
        ${geoFieldsHtml('cf')}
        <div class="form-field"><label class="fl">Correo</label><input class="fi" id="cf-email" type="email" placeholder="info@clinica.com"/></div>
        <div class="form-field"><label class="fl">Sitio web</label><input class="fi" id="cf-web" type="url" placeholder="https://…"/></div>
      </div>
    </div>`,
    [
      { label: 'Cancelar', cls: 'btn', action: closeModal },
      { label: id ? 'Guardar cambios' : 'Agregar centro', cls: 'btn btn-primary', action: () => saveCenterForm(id) },
    ]
  );
  wireGeoFields('cf');
  if (id) api.getCenter(id).then(c => {
    document.getElementById('cf-nombre').value = c.nombre || '';
    document.getElementById('cf-tel1').value = c.tel1 || '';
    document.getElementById('cf-tel2').value = c.tel2 || '';
    fillGeoFields('cf', c.departamento, c.municipio);
    document.getElementById('cf-dir').value = c.dir || '';
    document.getElementById('cf-email').value = c.email || '';
    document.getElementById('cf-web').value = c.web || '';
  });
}

async function saveCenterForm(editId) {
  const nombre = document.getElementById('cf-nombre').value.trim();
  if (!nombre) { showToast('El nombre es obligatorio', 'err'); return; }
  const obj = {
    id: editId || undefined,
    nombre,
    tel1: document.getElementById('cf-tel1').value.trim(),
    tel2: document.getElementById('cf-tel2').value.trim(),
    ...readGeoFields('cf'),
    dir: document.getElementById('cf-dir').value.trim(),
    email: document.getElementById('cf-email').value.trim(),
    web: document.getElementById('cf-web').value.trim(),
  };
  try {
    await api.saveCenter(obj, state.household.id);
    closeModal();
    showToast(editId ? 'Centro actualizado' : 'Centro agregado');
    render();
  } catch (err) {
    showToast(err.message || 'Error al guardar', 'err');
  }
}

async function deleteCenterConfirm(id) {
  if (!confirm('¿Eliminar este centro médico?')) return;
  try {
    await api.deleteCenter(id);
    showToast('Centro eliminado', 'warn');
    render();
  } catch (err) {
    showToast(err.message || 'Error al eliminar el centro médico', 'err');
  }
}
