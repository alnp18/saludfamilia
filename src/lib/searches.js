import * as api from './api.js';
import { state } from '../state.js';
import { cachedLoader, filtrarLocal, combinarFuentes, normalizar } from './searchSources.js';

/**
 * Búsquedas concretas de la app — auditoría móvil 2026-07-25, Fase 1.
 *
 * Cada función devuelve lo que espera `liveSearch.js`:
 * `{ resultados: [{ id, label, sub?, etiqueta?, item? }], omitidasPorConexion }`.
 *
 * Los catálogos que caben en memoria se traen una vez por sesión y se
 * filtran en el cliente (`cachedLoader`): son listas chicas y así la
 * búsqueda responde al instante y sigue funcionando aunque la señal se
 * caiga a mitad de un formulario.
 */

// ─────────────────────────────────────────
// Médicos
// ─────────────────────────────────────────

const cargarMedicosPropios = cachedLoader(() => api.listDoctors(state.household.id));
const cargarMedicosPublicos = cachedLoader(() => api.listPublicDoctors('publicado'));

/**
 * Vuelve a consultar los médicos en la próxima búsqueda. Hay que llamarla
 * después de crear o editar un médico, o el recién creado no aparecería
 * hasta recargar la página.
 */
export function invalidarCacheMedicos() {
  cargarMedicosPropios.invalidar();
  cargarMedicosPublicos.invalidar();
}

/**
 * Busca en los médicos del household y, si hay conexión, también en el
 * directorio público.
 *
 * Los propios van primero a propósito: son los que la familia ya usa, y ante
 * un duplicado (un médico copiado del directorio) gana la copia propia, que
 * es la que tiene los datos privados —consultorio, extensión, notas—.
 */
export async function buscarMedicos(query) {
  return combinarFuentes([
    {
      buscar: async () => {
        const propios = await cargarMedicosPropios();
        return filtrarLocal(propios, query, ['nombre', 'especialidad', 'tarjetaProfesional'])
          .map(d => ({
            id: d.id,
            label: d.nombre,
            sub: d.especialidad || '',
            item: d,
          }));
      },
    },
    {
      remota: true,
      buscar: async () => {
        const publicos = await cargarMedicosPublicos();
        return filtrarLocal(publicos, query, ['nombre', 'especialidad', 'tarjetaProfesional'])
          .map(d => ({
            // Prefijo para no confundir el id de una entrada del directorio
            // público con el de un médico propio: son tablas distintas y
            // quien la elija tiene que copiarla antes de poder referenciarla.
            id: `pub:${d.id}`,
            label: d.nombre,
            sub: d.especialidad || '',
            etiqueta: 'Directorio',
            item: d,
          }));
      },
    },
  ], query);
}

// ─────────────────────────────────────────
// Medicamentos
// ─────────────────────────────────────────

/**
 * Registro de medicamentos vigentes del INVIMA, publicado como datos
 * abiertos (Socrata/SODA). Son ~157.000 registros: demasiados para
 * empaquetarlos con la app, así que se consultan en vivo y solo con
 * conexión. Sin señal, la búsqueda cae a lo que la familia ya cargó.
 */
const INVIMA_URL = 'https://www.datos.gov.co/resource/i7cb-raxc.json';
const INVIMA_TIMEOUT_MS = 6000;

/**
 * Escapa un término para interpolarlo en una cláusula SoQL `like`.
 * Se descartan los caracteres que tienen significado en la consulta y se
 * duplican las comillas simples, que es como SoQL las escapa. Sin esto, un
 * apóstrofo escrito por la persona rompería la consulta.
 */
function escaparSoQL(termino) {
  return String(termino).replace(/[%\\]/g, '').replace(/'/g, "''");
}

async function buscarEnInvima(query) {
  const termino = escaparSoQL(query).toUpperCase();
  if (!termino) return [];

  const params = new URLSearchParams({
    $select: 'producto,principioactivo,formafarmaceutica',
    // Se filtra por nombre comercial y no con la búsqueda libre `$q`, que
    // mira todos los campos y devuelve productos sin relación aparente
    // (buscar "losartan" traía un amlodipino porque lo menciona en otro campo).
    $where: `upper(producto) like '%${termino}%'`,
    $group: 'producto,principioactivo,formafarmaceutica',
    $limit: '20',
  });

  // Sin corte por tiempo, una respuesta lenta dejaría el campo "Buscando…"
  // indefinidamente; se prefiere caer a los datos locales.
  const ctrl = new AbortController();
  const corte = setTimeout(() => ctrl.abort(), INVIMA_TIMEOUT_MS);
  try {
    const res = await fetch(`${INVIMA_URL}?${params}`, { signal: ctrl.signal });
    if (!res.ok) return [];
    const filas = await res.json();
    return filas.map(f => ({
      id: `invima:${normalizar(f.producto)}`,
      label: f.producto,
      sub: [f.formafarmaceutica, f.principioactivo].filter(Boolean).join(' · '),
      etiqueta: 'INVIMA',
      item: f,
    }));
  } catch {
    return []; // sin red, caído o demasiado lento: la búsqueda local alcanza
  } finally {
    clearTimeout(corte);
  }
}

/**
 * Busca medicamentos: primero los que ya tiene cargados el paciente activo
 * (sirven sin conexión y son los que más va a repetir) y después el
 * registro del INVIMA, solo si hay red.
 *
 * @param {string} query
 * @param {string} [patientId] - por omisión, el paciente activo.
 */
export async function buscarMedicamentos(query, patientId) {
  const id = patientId || state.activePatient?.id;
  return combinarFuentes([
    {
      buscar: async () => {
        if (!id) return [];
        const propios = await api.listMedsByPatient(id);
        // Un medicamento con varias versiones aparece repetido: interesa el
        // nombre, no cada versión, así que se deduplica por nombre.
        const vistos = new Set();
        return filtrarLocal(propios, query, ['nombre', 'indicacion'])
          .filter(m => {
            const k = normalizar(m.nombre);
            if (vistos.has(k)) return false;
            vistos.add(k);
            return true;
          })
          .map(m => ({
            id: `local:${normalizar(m.nombre)}`,
            label: m.nombre,
            sub: [m.dosis && `${m.dosis} ${m.unidad || ''}`.trim(), m.via].filter(Boolean).join(' · '),
            etiqueta: 'Ya registrado',
            item: m,
          }));
      },
    },
    { remota: true, buscar: () => buscarEnInvima(query) },
  ], query);
}
