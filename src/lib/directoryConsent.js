/**
 * Consentimiento para compartir con el directorio público.
 *
 * Desde la migración 0028 todo médico o centro nuevo del directorio privado
 * viaja, anónimo, a la cola de revisión del directorio compartido. La decisión
 * del 2026-08-09 fue pedir permiso con la casilla marcada por defecto: el
 * directorio sigue creciendo con el uso normal, pero la familia lo ve en el
 * momento de crear y puede desmarcarlo ahí mismo.
 *
 * La casilla sola no bloquea nada — la inserción la hacen triggers del lado
 * del servidor. Lo que la hace real es la columna `compartir_directorio` que
 * estos campos escriben y que los triggers leen (ver 0030).
 *
 * Se ofrece SOLO al crear. Al editar no aparece a propósito: cambiarla no
 * retiraría de la cola lo ya enviado, y una casilla que no cumple lo que
 * promete es peor que no tenerla.
 *
 * Misma convención que el resto de campos compuestos de la app
 * (geo.js, dateRange.js, phone.js): `xHtml()` para el HTML, `readX()` para
 * leerlo.
 */

const TEXTOS = {
  medico: 'Se envían el nombre, la especialidad, la tarjeta profesional y el centro. ' +
    'El consultorio, el teléfono y tus notas no salen nunca. ' +
    'No se registra de qué familia viene, y una administradora lo revisa antes de publicarlo.',
  centro: 'Se envían los datos de contacto del centro, que son públicos de por sí. ' +
    'No se registra de qué familia viene, y una administradora lo revisa antes de publicarlo.',
};

/**
 * @param {object} opts
 * @param {string} opts.id - id del <input type="checkbox">.
 * @param {'medico'|'centro'} opts.tipo - de qué entrada se habla.
 * @param {boolean} [opts.compacto] - versión de una línea, sin la explicación,
 *   para los formularios de alta rápida (que existen justamente para ser
 *   breves). La explicación completa vive ahí en el `title`.
 */
export function consentFieldHtml({ id, tipo, compacto = false }) {
  const detalle = TEXTOS[tipo] || TEXTOS.medico;
  if (compacto) {
    return `<label class="dir-consent dir-consent-sm" for="${id}" title="${detalle}">
      <input type="checkbox" id="${id}" checked/>
      <span>Compartir con el directorio de la comunidad</span>
    </label>`;
  }
  return `<div class="form-field span2">
    <label class="dir-consent" for="${id}">
      <input type="checkbox" id="${id}" checked/>
      <span><strong>Compartir con el directorio de la comunidad</strong></span>
    </label>
    <p class="dir-consent-help">${detalle}</p>
  </div>`;
}

/** Lee la casilla. Si no está en pantalla (por ejemplo, en una edición) se
 * devuelve `undefined` para que quien llama no escriba la columna y deje el
 * valor que la fila ya tenía. */
export function readConsent(id) {
  const el = document.getElementById(id);
  return el ? el.checked : undefined;
}

/** Lee la casilla dentro de un contenedor concreto — los modales apilados
 * pueden tener más de un formulario vivo a la vez. */
export function readConsentIn(root, id) {
  const el = root?.querySelector(`#${id}`);
  return el ? el.checked : undefined;
}
