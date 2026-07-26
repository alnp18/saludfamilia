import * as api from './api.js';
import { state } from '../state.js';
import { cachedLoader, filtrarLocal, combinarFuentes, normalizar } from './searchSources.js';
import CIE10_COMUNES from './data/cie10-comunes.json';

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

// ─────────────────────────────────────────
// Síntomas / enfermedades
// ─────────────────────────────────────────

/**
 * Tabla CIE-10 en lenguaje corriente — auditoría móvil 2026-07-26, Fase 3.
 *
 * El CIE-10 oficial es vocabulario clínico: quien busca "dolor de cabeza" no
 * encuentra "R51 Cefalea", que es justo el problema que bloqueó esta tarea en
 * Fase 1. Por eso cada entrada trae `sinonimos` en la forma en que la gente
 * lo dice de verdad ("presión alta", "agrieras", "gripa"), y se busca contra
 * esos sinónimos además del título oficial.
 *
 * OJO — es un subconjunto curado (76 entradas de motivos frecuentes en
 * atención familiar), no el CIE-10 completo (~14.000 códigos), y usa códigos
 * de categoría de 3 caracteres, no el subcódigo de 4. Se eligió así a
 * propósito: la categoría es inequívoca, mientras que afinar el cuarto
 * carácter sin la tabla oficial delante es justamente donde se cometen
 * errores de codificación. Cargar la tabla oficial del SISPRO después no
 * requiere tocar código: basta reemplazar el JSON respetando el formato
 * `{ codigo, titulo, sinonimos[] }`.
 *
 * Y en cualquier caso el campo admite texto libre: el código es una ayuda
 * para estandarizar, nunca un requisito.
 */
const CIE10_INDEX = CIE10_COMUNES.map(e => ({
  ...e,
  // Un solo campo con todo lo buscable, porque `filtrarLocal` compara contra
  // propiedades sueltas y los sinónimos son un arreglo.
  _buscable: [e.codigo, e.titulo, ...e.sinonimos].join(' '),
}));

function buscarEnCie10(query) {
  return filtrarLocal(CIE10_INDEX, query, ['_buscable'])
    .slice(0, 15)
    .map(e => ({
      id: `cie10:${e.codigo}`,
      label: e.titulo,
      sub: e.codigo,
      etiqueta: 'CIE-10',
      item: { codigo: e.codigo, titulo: e.titulo },
    }));
}

/**
 * Busca síntomas o enfermedades: primero lo que la propia familia ya
 * escribió y después la tabla CIE-10 en lenguaje corriente.
 *
 * Lo propio va primero por la misma razón que en médicos y medicamentos: es
 * el vocabulario que esta familia usa y el que va a repetir. Las dos fuentes
 * son locales —la tabla viaja con la app—, así que esta búsqueda funciona
 * completa sin conexión, a diferencia de la de medicamentos.
 *
 * @param {string} query
 * @param {string} [patientId] - por omisión, el paciente activo.
 */
export async function buscarSintomas(query, patientId) {
  const id = patientId || state.activePatient?.id;
  return combinarFuentes([
    {
      buscar: async () => {
        if (!id) return [];
        // Las tres cosas que ya escribió la familia sobre por qué se trata a
        // este paciente: la indicación de cada medicamento, el motivo de cada
        // uso puntual y la descripción de los diagnósticos crónicos.
        const [meds, usos, diagnosticos] = await Promise.all([
          api.listMedsByPatient(id).catch(() => []),
          api.listMedUsageByPatient(id).catch(() => []),
          api.listPatientDiagnoses(id).catch(() => []),
        ]);
        const textos = [
          ...meds.map(m => ({ texto: m.indicacion, origen: 'Indicación' })),
          ...usos.map(u => ({ texto: u.razon, origen: 'Uso registrado' })),
          ...diagnosticos.map(d => ({ texto: d.descripcion, origen: 'Diagnóstico', codigo: d.codigoCie10 })),
        ].filter(t => t.texto);

        const vistos = new Set();
        return textos
          .filter(t => {
            const k = normalizar(t.texto);
            if (vistos.has(k)) return false;
            vistos.add(k);
            return true;
          })
          .filter(t => filtrarLocal([t], query, ['texto']).length)
          .map(t => ({
            id: `propio:${normalizar(t.texto)}`,
            label: t.texto,
            sub: t.codigo || '',
            etiqueta: t.origen,
            item: t,
          }));
      },
    },
    { buscar: async () => buscarEnCie10(query) },
  ], query);
}
