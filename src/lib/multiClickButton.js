import { esc } from './utils.js';

/**
 * Botón multiclic — auditoría móvil 2026-07-26, Fase 4.
 *
 * Componente reutilizable para marcar la decisión sobre un dato puntual sin
 * un formulario aparte: un clic va rotando por tres estados —
 *
 *   neutral (/)  →  aceptado (○)  →  rechazado (✗)  →  neutral …
 *
 * Nace para el panel de curación del directorio público (CONTEXTO.md — cada
 * dato nuevo/editado de un médico o centro necesita poder aceptarse o
 * rechazarse de a uno, sin abrir un formulario por campo). Se construye acá
 * como pieza aislada, sin conectar todavía a esa pantalla: el sistema de
 * curación y el panel de revisión mejorado son tareas aparte del plan y
 * consumen este componente cuando les toque.
 *
 * Sigue la misma convención que el resto de patrones transversales de la
 * app (geo.js, dateRange.js, phone.js, liveSearch.js): `xHtml()` arma el
 * HTML, `wireX()` lo conecta, `fillX()` carga un estado ya guardado y
 * `readX()` lo lee.
 */

export const ESTADOS = ['neutral', 'aceptado', 'rechazado'];

const ESTADO_CONFIG = {
  neutral: { simbolo: '/', clase: 'mcb-neutral', titulo: 'Sin decidir — clic para aceptar' },
  aceptado: { simbolo: '○', clase: 'mcb-aceptado', titulo: 'Aceptado — clic para rechazar' },
  rechazado: { simbolo: '✗', clase: 'mcb-rechazado', titulo: 'Rechazado — clic para volver a "sin decidir"' },
};

/** Estado siguiente en el ciclo. Exportado porque el panel que lo use puede
 *  necesitar la misma regla para un "aceptar todo"/atajo de teclado. */
export function siguienteEstado(estado) {
  const i = ESTADOS.indexOf(estado);
  return ESTADOS[(i < 0 ? 0 : i + 1) % ESTADOS.length];
}

/**
 * @param {string} id
 * @param {object} [opts]
 * @param {string} [opts.estadoInicial] - 'neutral' | 'aceptado' | 'rechazado'.
 * @param {string} [opts.label] - texto accesible; el símbolo solo no alcanza
 *   para lectores de pantalla.
 */
export function multiClickButtonHtml(id, { estadoInicial = 'neutral', label = 'Decisión' } = {}) {
  const cfg = ESTADO_CONFIG[estadoInicial] || ESTADO_CONFIG.neutral;
  return `<button type="button" class="mcb ${cfg.clase}" id="${esc(id)}"
      data-estado="${estadoInicial}" title="${esc(cfg.titulo)}" aria-label="${esc(label)}: ${esc(cfg.titulo)}">
    <span class="mcb-simbolo" aria-hidden="true">${cfg.simbolo}</span>
  </button>`;
}

/**
 * Conecta el ciclo de estados al clic.
 * @param {string} id
 * @param {(estado: string) => void} [onChange] - se llama con el nuevo
 *   estado en cada clic (para persistirlo o recalcular algo dependiente,
 *   como un contador de "#cambios" en el panel de revisión).
 */
export function wireMultiClickButton(id, onChange) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.addEventListener('click', () => {
    const nuevo = siguienteEstado(btn.dataset.estado);
    pintarEstado(btn, nuevo);
    onChange?.(nuevo);
  });
}

function pintarEstado(btn, estado) {
  const cfg = ESTADO_CONFIG[estado] || ESTADO_CONFIG.neutral;
  ESTADOS.forEach(e => btn.classList.remove(ESTADO_CONFIG[e].clase));
  btn.classList.add(cfg.clase);
  btn.dataset.estado = estado;
  btn.title = cfg.titulo;
  const label = (btn.getAttribute('aria-label') || '').split(':')[0];
  btn.setAttribute('aria-label', `${label}: ${cfg.titulo}`);
  const simbolo = btn.querySelector('.mcb-simbolo');
  if (simbolo) simbolo.textContent = cfg.simbolo;
}

/** Carga un estado ya guardado (por ejemplo, al reabrir un panel de
 *  revisión con decisiones tomadas en una sesión anterior). */
export function fillMultiClickButton(id, estado) {
  const btn = document.getElementById(id);
  if (!btn) return;
  pintarEstado(btn, ESTADOS.includes(estado) ? estado : 'neutral');
}

/** Estado actual: 'neutral' | 'aceptado' | 'rechazado'. */
export function readMultiClickButtonState(id) {
  return document.getElementById(id)?.dataset.estado || 'neutral';
}
