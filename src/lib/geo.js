import daneData from './data/dane-departamentos-municipios.json';

/**
 * Patrón transversal Departamento/Municipio (Ciudad) — auditoría móvil 2026-07-25.
 * Fuente: división político-administrativa del DANE. `daneData` es un objeto
 * { "Nombre del departamento": ["Capital", "Municipio A-Z", ...] }, con
 * Bogotá D.C. siempre primero (es la capital del país) y el resto de
 * departamentos en orden alfabético; dentro de cada departamento, su
 * municipio capital aparece primero y luego el resto en orden A-Z.
 *
 * Este módulo es la única fuente de verdad para ese patrón: cualquier
 * formulario con dirección (Pacientes, Contacto de emergencia, Centros
 * médicos) arma sus selects de Departamento/Municipio a partir de acá, en
 * vez de repetir la lista o el orden en cada módulo.
 */

/** Nombres de departamento, en el orden en que deben listarse (Bogotá primero). */
export const DEPARTAMENTOS = Object.keys(daneData);

/** Municipios de un departamento, en el orden en que deben listarse (capital primero). */
export function municipiosDe(departamento) {
  return daneData[departamento] || [];
}

/**
 * Arma el bloque de HTML (dos `.form-field`) para un par Departamento/Municipio,
 * siguiendo la misma estructura que el resto de campos de los formularios
 * (`form-field` / `fl` / `fi`). `prefix` identifica los ids resultantes:
 * `${prefix}-depto` y `${prefix}-municipio`.
 */
export function geoFieldsHtml(prefix, { span = false } = {}) {
  const cls = span ? 'form-field span2' : 'form-field';
  return `
    <div class="${cls}">
      <label class="fl">Departamento</label>
      <select class="fi" id="${prefix}-depto">
        <option value="">Seleccione departamento</option>
        ${DEPARTAMENTOS.map(d => `<option value="${d}">${d}</option>`).join('')}
      </select>
    </div>
    <div class="${cls}">
      <label class="fl">Municipio</label>
      <select class="fi" id="${prefix}-municipio" disabled>
        <option value="">Seleccione departamento primero</option>
      </select>
    </div>`;
}

/** Genera las `<option>` de municipio para un departamento dado. */
function municipioOptionsHtml(departamento, selected) {
  if (!departamento) return '<option value="">Seleccione departamento primero</option>';
  const municipios = municipiosDe(departamento);
  return '<option value="">Seleccione municipio</option>' +
    municipios.map(m => `<option value="${m}"${m === selected ? ' selected' : ''}>${m}</option>`).join('');
}

/**
 * Conecta el cambio de Departamento con el filtrado de Municipio para un par
 * de selects ya insertados en el DOM (ver `geoFieldsHtml`). Debe llamarse
 * después de insertar el HTML del formulario en el modal.
 */
export function wireGeoFields(prefix) {
  const deptoEl = document.getElementById(`${prefix}-depto`);
  const municipioEl = document.getElementById(`${prefix}-municipio`);
  if (!deptoEl || !municipioEl) return;
  deptoEl.addEventListener('change', () => {
    municipioEl.disabled = !deptoEl.value;
    municipioEl.innerHTML = municipioOptionsHtml(deptoEl.value, '');
  });
}

/**
 * Pobla un par Departamento/Municipio con valores existentes (edición de un
 * registro guardado). Debe llamarse después de `wireGeoFields`.
 */
export function fillGeoFields(prefix, departamento, municipio) {
  const deptoEl = document.getElementById(`${prefix}-depto`);
  const municipioEl = document.getElementById(`${prefix}-municipio`);
  if (!deptoEl || !municipioEl) return;
  deptoEl.value = departamento || '';
  municipioEl.disabled = !deptoEl.value;
  municipioEl.innerHTML = municipioOptionsHtml(deptoEl.value, municipio || '');
}

/** Lee los valores actuales de un par Departamento/Municipio del DOM. */
export function readGeoFields(prefix) {
  return {
    departamento: document.getElementById(`${prefix}-depto`)?.value || '',
    municipio: document.getElementById(`${prefix}-municipio`)?.value || '',
  };
}
