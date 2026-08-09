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

/**
 * Une varias fuentes de opciones en una sola lista ordenada A-Z.
 *
 * Las especialidades llegan de tres lados —las fijas del código, las que la
 * familia agregó con "Otra…" y las publicadas en el directorio compartido— y
 * quien llena el formulario no tiene por qué saber de dónde salió cada una:
 * las quiere alfabéticas para encontrarlas sin leer la lista entera.
 *
 * El duplicado se descarta comparando en minúsculas y sin espacios sobrantes,
 * porque las tres fuentes se escriben por separado y "Cardiología" puede llegar
 * dos veces con distinta capitalización. Gana la primera aparición, así que
 * conviene pasar primero la lista fija, que es la de ortografía cuidada.
 */
export function mergeCatalogOptions(...listas) {
  const vistos = new Set();
  const salida = [];
  for (const v of listas.flat()) {
    const limpio = (v || '').trim();
    if (!limpio) continue;
    const clave = limpio.toLowerCase();
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    salida.push(limpio);
  }
  return salida.sort((a, b) => a.localeCompare(b, 'es'));
}

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
 * valor final a guardar en el registro.
 *
 * `compartir` (opcional) es la decisión de la familia sobre el directorio
 * público: una especialidad nueva también viaja a la cola de revisión, así
 * que debe respetar la misma casilla que el médico que la estrenó. Se ignora
 * en las demás categorías, que no alimentan el directorio. */
export async function resolveCatalogValue(householdId, categoria, selectValue, otraValue, compartir) {
  if (selectValue !== OTRA_VALUE) return selectValue;
  const v = (otraValue || '').trim();
  if (v) await api.addCatalogOption(householdId, categoria, v, compartir);
  return v;
}
