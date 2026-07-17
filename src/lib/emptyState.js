// P2 #11 — Estados vacíos y manejo de errores consistente.
//
// Antes de este helper cada módulo armaba su propio bloque de "empty state"
// a mano, con variantes inconsistentes: a veces el ícono venía envuelto en
// <div class="es-ic"> (como pide el CSS) y a veces era un <svg> suelto sin
// ese wrapper (pierde el tamaño/color correctos); a veces había <h3> + <p> +
// botón, a veces solo <h3>, a veces solo <p>. Este módulo centraliza esa
// estructura en dos variantes — vacío (nada que mostrar todavía) y error
// (algo falló al cargar) — para que toda la app se vea y se comporte igual.
//
// `title`/`message` se insertan tal cual (no se escapan acá): igual que el
// resto de la base de código, quien arma el texto es responsable de aplicar
// `esc()` a cualquier dato dinámico antes de pasarlo.

import { Icons } from './icons.js';

/**
 * @param {object} opts
 * @param {string} [opts.icon] - SVG del ícono (p. ej. Icons.hospital). Si se
 *   omite, no se muestra ícono.
 * @param {string} opts.title
 * @param {string} [opts.message]
 * @param {{ id: string, label: string }} [opts.action] - botón primario opcional.
 * @param {string} [opts.style] - estilos inline extra para el contenedor
 *   (p. ej. para ajustar el padding dentro de una tarjeta chica).
 */
export function emptyStateHtml({ icon = '', title, message = '', action = null, style = '' } = {}) {
  return `<div class="empty-state"${style ? ` style="${style}"` : ''}>
    ${icon ? `<div class="es-ic">${icon}</div>` : ''}
    <h3>${title}</h3>
    ${message ? `<p>${message}</p>` : ''}
    ${action ? `<button type="button" class="btn btn-primary" id="${action.id}" style="margin-top:8px">${action.label}</button>` : ''}
  </div>`;
}

/**
 * Estado de error: se usa cuando falla la carga de datos de un módulo (en
 * vez de dejar el contenedor vacío/con datos viejos y solo un toast que
 * desaparece a los pocos segundos). Siempre incluye un botón de reintentar.
 *
 * @param {object} opts
 * @param {string} [opts.message] - detalle del error; por defecto un
 *   mensaje genérico (no técnico) para el usuario.
 * @param {string} opts.retryId - id del botón de reintentar; quien llama
 *   debe wirear su click para volver a intentar la carga.
 * @param {string} [opts.retryLabel]
 * @param {string} [opts.style]
 */
export function errorStateHtml({ message = 'No se pudo cargar la información. Revisa tu conexión e intenta de nuevo.', retryId, retryLabel = 'Reintentar', style = '' } = {}) {
  return `<div class="empty-state is-error"${style ? ` style="${style}"` : ''}>
    <div class="es-ic">${Icons.alertTriangle}</div>
    <h3>Algo salió mal</h3>
    <p>${message}</p>
    <button type="button" class="btn" id="${retryId}" style="margin-top:8px">${retryLabel}</button>
  </div>`;
}
