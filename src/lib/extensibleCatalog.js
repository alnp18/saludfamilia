import { esc } from './utils.js';
import * as api from './api.js';

/**
 * Patrón "Otra… extensible" (P1.5 — nota transversal): tres módulos
 * distintos (Pólizas en Pacientes, Vía de administración en Medicamentos,
 * Especialidad en Médicos) necesitan una lista desplegable con opciones
 * fijas + lo que el household ya agregó antes + una opción "Otra…" que
 * abre un campo de texto libre y suma la entrada al catálogo
 * (custom_catalog_options) para cargas futuras. Este módulo concentra esa
 * lógica una sola vez.
 */

export const OTRA_VALUE = '__otra__';

/** Arma las <option> de un <select>: fijas + del catálogo del household
 * (sin duplicar las fijas) + "Otra…" al final. */
export function catalogOptionsHtml(fixedOptions, customOptions, selected) {
  const custom = (customOptions || []).filter(c => !fixedOptions.includes(c));
  const all = [...fixedOptions, ...custom];
  const fixedHtml = all.map(o => `<option ${selected === o ? 'selected' : ''}>${esc(o)}</option>`).join('');
  const otraHtml = `<option value="${OTRA_VALUE}" ${selected === OTRA_VALUE ? 'selected' : ''}>Otra…</option>`;
  return fixedHtml + otraHtml;
}

/** Si se eligió "Otra…" y se escribió un valor, lo suma al catálogo del
 * household para que aparezca ya listado en cargas futuras. Devuelve el
 * valor final a guardar en el registro. */
export async function resolveCatalogValue(householdId, categoria, selectValue, otraValue) {
  if (selectValue !== OTRA_VALUE) return selectValue;
  const v = (otraValue || '').trim();
  if (v) await api.addCatalogOption(householdId, categoria, v);
  return v;
}
