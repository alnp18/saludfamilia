import { state } from '../state.js';
import * as api from '../lib/api.js';
import { showModal, closeModal, showToast } from '../lib/modal.js';
import { esc } from '../lib/utils.js';
import { emptyStateHtml, errorStateHtml } from '../lib/emptyState.js';

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
  let centers;
  try {
    centers = await api.listCenters(state.household.id);
  } catch (err) {
    showToast(err.message || 'No se pudieron cargar los centros médicos', 'err');
    el.innerHTML = errorStateHtml({ retryId: 'btn-retry-centers' });
    document.getElementById('btn-retry-centers').addEventListener('click', () => render());
    return;
  }

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
        <div style="flex:1;min-width:0"><div class="dir-name">${esc(c.nombre)}</div></div>
        <button class="btn btn-sm btn-icon btn-ghost" data-edit-id="${c.id}" title="Editar"><svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5"/></svg></button>
        <button class="btn btn-sm btn-icon btn-danger" data-delete-id="${c.id}" title="Eliminar"><svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862"/></svg></button>
      </div>
      ${c.tel1 ? `<div class="dir-row"><a href="tel:${esc(c.tel1)}">${esc(c.tel1)}</a>${c.tel2 ? ` · <a href="tel:${esc(c.tel2)}">${esc(c.tel2)}</a>` : ''}</div>` : ''}
      ${c.dir ? `<div class="dir-row">${esc(c.dir)}</div>` : ''}
      ${c.email ? `<div class="dir-row"><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></div>` : ''}
      ${c.web ? `<div class="dir-row"><a href="${esc(c.web)}" target="_blank" rel="noopener">${esc(c.web)}</a></div>` : ''}
    </div>`).join('')}
  </div>`;

  el.querySelectorAll('[data-edit-id]').forEach(b => b.addEventListener('click', () => openCenterModal(b.dataset.editId)));
  el.querySelectorAll('[data-delete-id]').forEach(b => b.addEventListener('click', () => deleteCenterConfirm(b.dataset.deleteId)));
}

function openCenterModal(id) {
  showModal(
    id ? 'Editar centro médico' : 'Nuevo centro médico',
    `<div class="form-body">
      <div class="form-row cols-2">
        <div class="form-field span2"><label class="fl">Nombre *</label><input class="fi" id="cf-nombre" type="text" placeholder="Nombre del centro o clínica"/></div>
        <div class="form-field"><label class="fl">Teléfono 1</label><input class="fi" id="cf-tel1" type="tel" placeholder="(+57) 601…"/></div>
        <div class="form-field"><label class="fl">Teléfono 2</label><input class="fi" id="cf-tel2" type="tel" placeholder="Opcional"/></div>
        <div class="form-field span2"><label class="fl">Dirección</label><input class="fi" id="cf-dir" type="text" placeholder="Calle, carrera, ciudad…"/></div>
        <div class="form-field"><label class="fl">Correo</label><input class="fi" id="cf-email" type="email" placeholder="info@clinica.com"/></div>
        <div class="form-field"><label class="fl">Sitio web</label><input class="fi" id="cf-web" type="url" placeholder="https://…"/></div>
      </div>
    </div>`,
    [
      { label: 'Cancelar', cls: 'btn', action: closeModal },
      { label: id ? 'Guardar cambios' : 'Agregar centro', cls: 'btn btn-primary', action: () => saveCenterForm(id) },
    ]
  );
  if (id) api.getCenter(id).then(c => {
    document.getElementById('cf-nombre').value = c.nombre || '';
    document.getElementById('cf-tel1').value = c.tel1 || '';
    document.getElementById('cf-tel2').value = c.tel2 || '';
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
