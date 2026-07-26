import * as api from './api.js';
import { state } from '../state.js';
import { esc } from './utils.js';
import { showToast, openStackedModal, closeStackedModal } from './modal.js';
import { callInputButtonHtml } from './phone.js';

/**
 * Alta rápida de centro médico o médico "sin salir del flujo" (P1.5 —
 * Órdenes médicas / Médicos). Ambos selectores de médico y de centro
 * reaparecen en varios formularios (orden médica, ficha de médico), así
 * que el mini-formulario inline vive acá una sola vez y cada llamador solo
 * indica qué <select> debe actualizarse al guardar.
 *
 * El alta de MÉDICO se abre dentro del mismo modal que ya está visible, como
 * un mini-formulario, para que la persona no pierda lo que llevaba escrito.
 *
 * El alta de CENTRO, en cambio, se abre como modal apilado encima
 * (auditoría móvil 2026-07-26, Fase 3 — flujo Centro → Médico → Orden). El
 * motivo es que el centro se puede necesitar desde dos profundidades
 * distintas: directamente desde una orden o desde el formulario de médico
 * que a su vez se abrió desde esa orden. Anidar un tercer mini-formulario
 * dentro de otro deja el modal larguísimo y sin saber a qué nivel pertenece
 * cada botón "Guardar"; un modal encima deja clarísimo qué se está llenando
 * y devuelve el control al de abajo intacto al cerrarse.
 */

/** Agrega la opción del centro recién creado a un <select> y la selecciona. */
function inyectarCentroEnSelect(selectId, saved) {
  const select = document.getElementById(selectId);
  if (!select) return;
  const opt = document.createElement('option');
  opt.value = saved.id;
  opt.textContent = saved.nombre;
  select.appendChild(opt);
  select.value = saved.id;
}

/**
 * Abre el alta rápida de centro médico como modal apilado.
 *
 * @param {object} [opts]
 * @param {(saved: object) => void} [opts.onSaved] - recibe el centro creado.
 */
export function openNewCenterModal({ onSaved } = {}) {
  const overlay = openStackedModal(
    'Nuevo centro médico',
    `<div class="form-row cols-2">
      <div class="form-field span2"><label class="fl">Nombre del centro o clínica *</label><input class="fi" id="nc-nombre" type="text" placeholder="Ej: Clínica del Country"/></div>
      <div class="form-field"><label class="fl">Teléfono</label><div class="call-field"><input class="fi" id="nc-tel1" type="tel" placeholder="(+57) 601 …"/>${callInputButtonHtml('nc-tel1')}</div></div>
      <div class="form-field"><label class="fl">Dirección</label><input class="fi" id="nc-dir" type="text" placeholder="Dirección"/></div>
    </div>
    <p style="font-size:11.5px;color:var(--tm);margin:10px 0 0">Puedes completar el resto de los datos después, desde Centros médicos.</p>`,
    [
      { label: 'Cancelar', cls: 'btn', action: () => closeStackedModal() },
      { label: 'Guardar centro', cls: 'btn btn-primary', action: guardar },
    ],
    { maxWidth: '480px' }
  );

  async function guardar() {
    const nombre = overlay.querySelector('#nc-nombre').value.trim();
    if (!nombre) { showToast('El nombre del centro es obligatorio', 'err'); return; }
    const tel1 = overlay.querySelector('#nc-tel1').value.trim();
    const dir = overlay.querySelector('#nc-dir').value.trim();
    try {
      const saved = await api.saveCenter({ nombre, tel1, dir }, state.household.id);
      // Se cierra antes de avisar al de abajo para que, cuando este
      // actualice su <select>, el modal ya no esté tapando el resultado.
      closeStackedModal();
      showToast('Centro agregado al directorio');
      onSaved?.(saved);
    } catch (err) {
      showToast(err.message || 'Error al guardar el centro', 'err');
    }
  }

  setTimeout(() => overlay.querySelector('#nc-nombre')?.focus(), 50);
  return overlay;
}

/**
 * Conecta un botón "+" que abre el alta de centro y deja el centro nuevo
 * seleccionado en el <select> indicado.
 *
 * @param {string} selectId - <select> de centro que debe verse actualizado.
 * @param {string} addBtnId - botón "+".
 */
export function wireInlineNewCenter(selectId, addBtnId) {
  const addBtn = document.getElementById(addBtnId);
  if (!addBtn) return;
  addBtn.addEventListener('click', () =>
    openNewCenterModal({ onSaved: (saved) => inyectarCentroEnSelect(selectId, saved) }));
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
          <div style="display:flex;gap:6px">
            <select class="fi" id="${formContainerId}-centro" style="flex:1">
              <option value="">Sin centro asignado</option>
              ${centers.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('')}
            </select>
            <button type="button" class="btn btn-sm btn-icon" id="${formContainerId}-centro-add" title="Agregar centro médico">+</button>
          </div>
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:6px">
        <button type="button" class="btn btn-sm btn-primary" id="${formContainerId}-save">Guardar médico</button>
        <button type="button" class="btn btn-sm" id="${formContainerId}-cancel">Cancelar</button>
      </div>`;

    // Tercer eslabón de la cadena Centro → Médico → Orden: el centro se crea
    // en un modal encima de este mini-formulario y, al volver, queda elegido
    // acá sin que se haya perdido nada de lo ya escrito.
    document.getElementById(`${formContainerId}-centro-add`).addEventListener('click', () =>
      openNewCenterModal({ onSaved: (saved) => inyectarCentroEnSelect(`${formContainerId}-centro`, saved) }));

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
