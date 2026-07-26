import * as api from './api.js';
import { state } from '../state.js';
import { showToast } from './modal.js';

/**
 * Recordatorios de órdenes pendientes de autorización — auditoría móvil
 * 2026-07-26, Fase 3.
 *
 * Qué resuelve: una orden radicada ante la EPS puede quedarse semanas sin
 * respuesta, y a nadie le llega un aviso. El recordatorio insiste cada N
 * días hasta que la autorización aparece.
 *
 * Cuándo se apaga: solo cuando la orden llega a la etapa C (Autorización) o
 * más adelante. No hay que acordarse de desactivarlo — se apaga con el hecho
 * que lo volvía innecesario. Eso también evita el peor final posible para un
 * recordatorio, que es seguir molestando por algo ya resuelto.
 *
 * ── Sobre el alcance de la entrega ──────────────────────────────────
 * Los avisos se muestran con la API de notificaciones del navegador, que en
 * un teléfono con la app instalada aparecen como notificación del sistema.
 * Se disparan cuando la app se abre o mientras está abierta.
 *
 * Que lleguen con la app CERRADA es otra cosa: eso requiere Web Push
 * (suscripción con claves VAPID) y algo del lado del servidor que despache
 * los envíos en el momento correcto — en este proyecto sería una Edge
 * Function de Supabase con pg_cron. No está construido. La agenda sí vive en
 * la base de datos y no en el navegador, así que ese día se puede agregar
 * sin migrar nada ni perder los recordatorios ya creados.
 *
 * Mientras tanto, todo aviso vencido se muestra además dentro de la app
 * (`recordatoriosVencidos()` alimenta el dashboard). Es a propósito: si el
 * permiso de notificaciones está denegado —o el navegador no las soporta—,
 * un recordatorio que falla en silencio es peor que no haberlo ofrecido.
 */

/** Etapas en las que el recordatorio ya no tiene sentido. */
export const ETAPAS_RESUELTAS = ['C', 'D', 'Finalizado'];

export const INTERVALOS = [
  { dias: 1, label: 'Todos los días' },
  { dias: 3, label: 'Cada 3 días' },
  { dias: 7, label: 'Cada semana' },
  { dias: 15, label: 'Cada 15 días' },
];

export function soportaNotificaciones() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function permisoNotificaciones() {
  return soportaNotificaciones() ? Notification.permission : 'unsupported';
}

/**
 * Pide el permiso de notificaciones. Se llama en el momento en que la
 * persona activa un recordatorio y no al abrir la app: un navegador que
 * pregunta sin que se entienda para qué recibe "bloquear" casi siempre, y
 * esa negativa después no se puede volver a pedir.
 *
 * @returns {Promise<boolean>} si quedaron habilitadas.
 */
export async function pedirPermisoNotificaciones() {
  if (!soportaNotificaciones()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

/** Fecha del próximo aviso, `dias` después de ahora, en ISO. */
export function proximoAvisoDesdeAhora(dias) {
  const d = new Date();
  d.setDate(d.getDate() + Number(dias || 3));
  return d.toISOString();
}

/**
 * Activa (o reprograma) el recordatorio de una orden.
 * @returns {Promise<{ok: boolean, notificaciones: boolean}>}
 */
export async function activarRecordatorio(orderId, cadaDias) {
  const notificaciones = await pedirPermisoNotificaciones();
  await api.saveOrderReminder({
    orderId,
    cadaDias: Number(cadaDias),
    proximoAviso: proximoAvisoDesdeAhora(cadaDias),
  }, state.household.id);
  return { ok: true, notificaciones };
}

export async function desactivarRecordatorio(orderId) {
  await api.desactivarOrderReminder(orderId);
}

/**
 * Recordatorios que ya deberían haber avisado.
 *
 * Se cruzan con las órdenes para dos cosas: descartar los que quedaron
 * obsoletos porque la orden ya avanzó —se apagan de paso, así no se vuelven
 * a evaluar— y poder decir en el aviso de qué orden se trata.
 *
 * @param {object[]} orders - órdenes ya cargadas por quien llama.
 * @returns {Promise<Array<{recordatorio: object, orden: object}>>}
 */
export async function recordatoriosVencidos(orders) {
  if (!state.household) return [];
  let recordatorios;
  try {
    recordatorios = await api.listOrderReminders(state.household.id);
  } catch {
    return []; // sin recordatorios no se rompe nada; se reintenta al recargar
  }
  const porId = new Map((orders || []).map(o => [o.id, o]));
  const ahora = Date.now();
  const vencidos = [];

  for (const r of recordatorios) {
    const orden = porId.get(r.orderId);
    // La orden ya no existe o ya no la conocemos: no hay nada que recordar.
    if (!orden) continue;
    if (ETAPAS_RESUELTAS.includes(orden._stage)) {
      // Se apaga en cuanto se detecta, sin esperar a que alguien lo haga.
      api.desactivarOrderReminder(r.orderId).catch(() => {});
      continue;
    }
    if (new Date(r.proximoAviso).getTime() <= ahora) vencidos.push({ recordatorio: r, orden });
  }
  return vencidos;
}

function textoAviso(orden) {
  const tipo = orden.tipoOrden || 'Orden médica';
  return orden._stage === 'A'
    ? `${tipo}: todavía no se ha radicado la solicitud ante la EPS.`
    : `${tipo}: la solicitud sigue sin autorización.`;
}

/**
 * Entrega los avisos vencidos como notificación y reprograma el siguiente.
 *
 * Reprograma aunque la notificación no se haya podido mostrar: el aviso ya
 * queda visible dentro de la app, y si no se corriera la fecha el mismo
 * recordatorio se dispararía en bucle en cada carga.
 *
 * @returns {Promise<number>} cuántos avisos vencían.
 */
export async function entregarAvisosPendientes(orders) {
  const vencidos = await recordatoriosVencidos(orders);
  if (!vencidos.length) return 0;

  const puedeNotificar = permisoNotificaciones() === 'granted';
  // Se cuenta lo que REALMENTE se mostró, no lo que se intentó. Tener el
  // permiso concedido no garantiza que la notificación salga: en una PWA de
  // Android sin service worker registrado, `new Notification()` lanza
  // "Illegal constructor". Si se diera por entregado lo que falló, el aviso
  // se consumiría en silencio — justo lo que este módulo quiere evitar.
  let entregados = 0;

  for (const { recordatorio, orden } of vencidos) {
    if (puedeNotificar) {
      try {
        // Vía service worker cuando está disponible: en Android es la única
        // forma admitida de mostrar notificaciones desde una PWA instalada.
        const reg = await navigator.serviceWorker?.getRegistration();
        const opciones = {
          body: textoAviso(orden),
          tag: `orden-${orden.id}`, // reemplaza el aviso anterior de la misma orden
          data: { orderId: orden.id },
        };
        if (reg?.showNotification) await reg.showNotification('SaludFamilia — seguimiento', opciones);
        else new Notification('SaludFamilia — seguimiento', opciones);
        entregados++;
      } catch { /* no se pudo mostrar: cae al aviso dentro de la app */ }
    }
    // La fecha se corre igual, incluso si la notificación falló: el aviso ya
    // se dio dentro de la app y, si no se corriera, el mismo recordatorio se
    // dispararía otra vez en cada carga.
    api.marcarAvisoEntregado(recordatorio.id, proximoAvisoDesdeAhora(recordatorio.cadaDias))
      .catch(() => {});
  }

  if (entregados < vencidos.length) {
    const sinAvisar = vencidos.length - entregados;
    showToast(`Tienes ${sinAvisar} orden(es) pendientes de autorización`, 'warn');
  }
  return vencidos.length;
}
