import { isOnline } from './net.js';

/**
 * Utilidades para armar las funciones de búsqueda que consume
 * `src/lib/liveSearch.js` — auditoría móvil 2026-07-25, Fase 1.
 *
 * No hay una abstracción de "fuente de datos" con clases ni registro: cada
 * buscador escribe su propia función `search(query, { online })` y usa de
 * acá lo que necesite (normalizar, filtrar, combinar, cachear). Es más
 * simple de leer y de cambiar que un framework de fuentes, y se ajusta a
 * los tres casos reales del plan, que son bien distintos entre sí:
 *
 *  · Médicos    → dos tablas de Supabase (privada del household + directorio
 *                 público), ambas chicas: se traen enteras y se filtran acá.
 *  · Medicamentos → lo que la familia ya cargó (local, sirve sin señal) más
 *                 el INVIMA (remoto, solo con conexión).
 *  · Síntomas   → pendiente de definir la fuente (ver CONTEXTO.md).
 */

/**
 * Deja un texto comparable: sin tildes, sin mayúsculas y sin espacios de
 * sobra. Es lo que permite que "cardiologia" encuentre "Cardiología" — sin
 * esto, buscar sin tildes (lo normal al escribir rápido en un teléfono) no
 * encontraría casi nada.
 */
export function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim();
}

/**
 * ¿`texto` contiene todas las palabras de `query`? Se exige cada palabra por
 * separado y en cualquier orden, así "rojas maria" encuentra a "María
 * Fernanda Rojas" igual que "maria rojas".
 */
export function coincide(texto, query) {
  const t = normalizar(texto);
  const palabras = normalizar(query).split(/\s+/).filter(Boolean);
  return palabras.length > 0 && palabras.every(p => t.includes(p));
}

/**
 * Filtra una lista comparando `query` contra los campos indicados.
 * @param {object[]} items
 * @param {string} query
 * @param {string[]} campos - propiedades a considerar en la comparación.
 */
export function filtrarLocal(items, query, campos) {
  return (items || []).filter(item =>
    campos.some(campo => coincide(item?.[campo], query)));
}

/**
 * Envuelve una carga asíncrona para no repetirla en cada tecla: la primera
 * llamada consulta, las siguientes reusan el resultado. Devuelve también
 * `invalidar()`, para cuando los datos cambian (por ejemplo, tras crear un
 * médico nuevo desde el propio formulario).
 *
 * Si la carga falla no se cachea el error: la próxima búsqueda vuelve a
 * intentar, que es lo que se quiere cuando el fallo fue por falta de señal.
 */
export function cachedLoader(cargar) {
  let promesa = null;
  const loader = () => {
    if (!promesa) {
      promesa = Promise.resolve()
        .then(cargar)
        .catch(err => { promesa = null; throw err; });
    }
    return promesa;
  };
  loader.invalidar = () => { promesa = null; };
  return loader;
}

/**
 * Ejecuta varias búsquedas y junta lo que devuelvan, sin repetidos.
 *
 * Reglas de diseño, pensadas para que la búsqueda nunca se caiga entera:
 *  · las fuentes marcadas `remota: true` se saltan si no hay conexión;
 *  · si una fuente falla, se ignora y las demás siguen — una API externa
 *    caída no puede dejar sin buscar en los datos propios;
 *  · el orden de `fuentes` es el orden de prioridad: ante dos resultados con
 *    la misma `id`, gana el de la fuente declarada primero (los datos
 *    propios del household antes que los de un directorio externo).
 *
 * @param {Array<{buscar: (q: string) => Promise<object[]>, remota?: boolean}>} fuentes
 * @param {string} query
 * @returns {Promise<{resultados: object[], omitidasPorConexion: number}>}
 */
export async function combinarFuentes(fuentes, query) {
  const hayRed = isOnline();
  const aplicables = fuentes.filter(f => !f.remota || hayRed);
  const omitidasPorConexion = fuentes.length - aplicables.length;

  const porFuente = await Promise.all(
    aplicables.map(f => Promise.resolve()
      .then(() => f.buscar(query))
      .catch(() => [])));

  const vistos = new Set();
  const resultados = [];
  for (const lista of porFuente) {
    for (const r of lista || []) {
      const clave = r.id ?? normalizar(r.label);
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      resultados.push(r);
    }
  }
  return { resultados, omitidasPorConexion };
}
