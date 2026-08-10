/**
 * Estado de conexión de la app — auditoría móvil 2026-07-25, Fase 1.
 *
 * Hasta ahora la app no sabía si tenía red: una consulta a Supabase sin
 * señal simplemente fallaba y se mostraba como "error al cargar". Este
 * módulo centraliza esa noción para que cada funcionalidad pueda degradarse
 * a propósito en vez de romperse — empezando por las búsquedas en vivo, que
 * consultan fuentes remotas solo cuando tiene sentido intentarlo.
 *
 * `navigator.onLine` es una señal optimista: en falso es confiable (no hay
 * interfaz de red), en verdadero no garantiza que haya internet real (puede
 * haber wifi sin salida). Por eso se usa para DECIDIR SI INTENTAR, nunca
 * para dar por hecho que la consulta va a funcionar: quien la haga igual
 * tiene que manejar su propio error.
 */

/** ¿Vale la pena intentar una consulta remota? */
export function isOnline() {
  // Si el navegador no expone la propiedad, se asume que sí hay red: es
  // preferible intentar y fallar que bloquear una función por precaución.
  return navigator.onLine !== false;
}

