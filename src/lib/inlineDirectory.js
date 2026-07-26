import * as api from './api.js';
import { state } from '../state.js';
import { esc } from './utils.js';
import { showToast } from './modal.js';

/**
 * Alta rápida de centro médico o médico "sin salir del flujo" (P1.5 —
 * Órdenes médicas / Médicos). Ambos selectores de médico y de centro
 * reaparecen en varios formularios (orden médica, ficha de médico), así
 * que el mini-formulario inline vive acá una sola vez y cada llamador solo
 * indica qué <select> debe actualizarse al guardar.
 *
 * El mini-formulario se abre/cierra dentro del MISMO modal que ya está
 * abierto (nunca como un segundo modal apilado — modal.js solo soporta uno)
 * para que la persona no pierda lo que ya llevaba llenado.
 */

/**
 * @param {string} selectId - <select> de centro que debe verse actualizado.
 * @param {string} addBtnId - botón "+" que abre/cierra el mini-formulario.
 * @param {string} formContainerId - contenedor donde se renderiza el mini-formulario.
 */
export function wireInlineNewCenter(selectId, addBtnId, formContainerId) {
  const addBtn = document.getElementById(addBtnId);
  const container = document.getElementById(formContainerId);
  if (!addBtn || !container) return;

  addBtn.addEventListener('click', () => {
    if (!container.classList.contains('hidden')) {
      container.classList.add('hidden');
      container.innerHTML = '';
      return;
    }
    container.classList.remove('hidden');
    container.innerHTML = `
      <div class="form-row cols-2" style="margin-top:8px">
        <div class="form-field span2"><input class="fi" id="${formContainerId}-nombre" type="text" placeholder="Nombre del centro o clínica *"/></div>
        <div class="form-field"><input class="fi" id="${formContainerId}-tel1" type="tel" placeholder="Teléfono"/></div>
        <div class="form-field"><input class="fi" id="${formContainerId}-dir" type="text" placeholder="Dirección"/></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:6px">
        <button type="button" class="btn btn-sm btn-primary" id="${formContainerId}-save">Guardar centro</button>
        <button type="button" class="btn btn-sm" id="${formContainerId}-cancel">Cancelar</button>
      </div>`;

    document.getElementById(`${formContainerId}-cancel`).addEventListener('click', () => {
      container.classList.add('hidden');
      container.innerHTML = '';
    });
    document.getElementById(`${formContainerId}-save`).addEventListener('click', async () => {
      const nombre = document.getElementById(`${formContainerId}-nombre`).value.trim();
      if (!nombre) { showToast('El nombre del centro es obligatorio', 'err'); return; }
      const tel1 = document.getElementById(`${formContainerId}-tel1`).value.trim();
      const dir = document.getElementById(`${formContainerId}-dir`).value.trim();
      try {
        const saved = await api.saveCenter({ nombre, tel1, dir }, state.household.id);
        const select = document.getElementById(selectId);
        if (select) {
          const opt = document.createElement('option');
          opt.value = saved.id;
          opt.textContent = saved.nombre;
          select.appendChild(opt);
          select.value = saved.id;
        }
        container.classList.add('hidden');
        container.innerHTML = '';
        showToast('Centro agregado al directorio');
      } catch (err) {
        showToast(err.message || 'Error al guardar el centro', 'err');
      }
    });
  });
}

/**
 * @param {object} opts
 * @param {string} opts.primarySelectId - <select> que dispara el alta y que
 *   queda con el médico nuevo seleccionado.
 * @param {string[]} [opts.otherSelectIds] - otros <select> de médico en el
 *   mismo formulario que también deben ver la opción nueva (sin cambiar su
 *   valor actual).
 * @param {string} opts.addBtnId
 * @param {string} opts.formContainerId
 * @param {string[]} opts.specialties
 */
export function wireInlineNewDoctor({ primarySelectId, otherSelectIds = [], addBtnId, formContainerId, specialties }) {
  const addBtn = document.getElementById(addBtnId);
  const container = document.getElementById(formContainerId);
  if (!addBtn || !container) return;

  addBtn.addEventListener('click', async () => {
    if (!container.classList.contains('hidden')) {
      container.classList.add('hidden');
      container.innerHTML = '';
      return;
    }
    const centers = await api.listCenters(state.household.id);
    container.classList.remove('hidden');
    container.innerHTML = `
      <div class="form-row cols-2" style="margin-top:8px">
        <div class="form-field span2"><input class="fi" id="${formContainerId}-nombre" type="text" placeholder="Nombre completo del médico *"/></div>
        <div class="form-field">
          <select class="fi" id="${formContainerId}-esp">
            <option value="">Seleccione especialidad</option>
            ${specialties.map(s => `<option>${esc(s)}</option>`).join('')}
          </select>
        </div>
        <div class="form-field">
          <select class="fi" id="${formContainerId}-centro">
            <option value="">Sin centro asignado</option>
            ${centers.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:6px">
        <button type="button" class="btn btn-sm btn-primary" id="${formContainerId}-save">Guardar médico</button>
        <button type="button" class="btn btn-sm" id="${formContainerId}-cancel">Cancelar</button>
      </div>`;

    document.getElementById(`${formContainerId}-cancel`).addEventListener('click', () => {
      container.classList.add('hidden');
      container.innerHTML = '';
    });
    document.getElementById(`${formContainerId}-save`).addEventListener('click', async () => {
      const nombre = document.getElementById(`${formContainerId}-nombre`).value.trim();
      if (!nombre) { showToast('El nombre del médico es obligatorio', 'err'); return; }
      const especialidad = document.getElementById(`${formContainerId}-esp`).value;
      const centroId = document.getElementById(`${formContainerId}-centro`).value;
      try {
        const saved = await api.saveDoctor({ nombre, especialidad, centroId }, state.household.id);
        [primarySelectId, ...otherSelectIds].forEach(id => {
          const select = document.getElementById(id);
          if (!select) return;
          const opt = document.createElement('option');
          opt.value = saved.id;
          opt.textContent = saved.nombre + (saved.especialidad ? ' — ' + saved.especialidad : '');
          select.appendChild(opt);
        });
        const primary = document.getElementById(primarySelectId);
        if (primary) primary.value = saved.id;
        container.classList.add('hidden');
        container.innerHTML = '';
        showToast('Médico agregado al directorio');
      } catch (err) {
        showToast(err.message || 'Error al guardar el médico', 'err');
      }
    });
  });
}
