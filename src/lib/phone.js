import { esc } from './utils.js';
import { Icons } from './icons.js';

/**
 * Patrón transversal "Botón Llamar" — auditoría móvil 2026-07-25, Fase 1.
 *
 * Cualquier campo de teléfono de la app (ficha de paciente/contacto de
 * emergencia, médicos, centros médicos, directorio público, órdenes) ofrece
 * un botón que abre el marcador nativo del dispositivo con el número ya
 * cargado, en vez de obligar a copiarlo a mano.
 *
 * Dos formas de uso según el contexto:
 *  - `callLinkHtml(numero)` — vistas de solo lectura, donde el número ya es
 *    un dato guardado. Genera un <a href="tel:…"> real: la navegación la
 *    resuelve el sistema operativo, nunca la bloquea el navegador.
 *  - `callInputButtonHtml(inputId)` — formularios de edición, donde el
 *    número puede estar recién escrito y todavía sin guardar. Lee el valor
 *    actual del input en el momento del click.
 *
 * Los enlaces de las vistas no necesitan wiring (la navegación "tel:" es
 * nativa); los botones de formulario sí, y se conectan por delegación global
 * (`initCallButtons`, una sola vez desde main.js) porque los módulos re-arman
 * su HTML con innerHTML constantemente.
 */

/**
 * Normaliza un número escrito por una persona ("(+57) 601 123-4567 ext 890")
 * al formato que entiende el marcador del sistema ("+576011234567,890").
 *
 * Solo sobreviven dígitos, un "+" inicial y comas de pausa (DTMF) para las
 * extensiones — cualquier otro carácter se descarta. Eso hace que el
 * resultado sea seguro por construcción para interpolar en un href "tel:":
 * no hay forma de colar otro esquema ni de romper el atributo.
 */
export function telHref(numero) {
  const raw = String(numero ?? '').trim();
  if (!raw) return '';

  // Extensión: "ext", "ext.", "extensión", "x" seguido de dígitos → pausa.
  const extMatch = raw.match(/(?:ext\.?|extensi[oó]n|x)\s*:?\s*(\d+)\s*$/i);
  const principal = extMatch ? raw.slice(0, extMatch.index) : raw;

  // El "+" del indicativo internacional cuenta aunque no sea el primer
  // carácter: el placeholder de la propia app sugiere "(+57) 601…", y ahí el
  // "+" va dentro del paréntesis. Solo vale si aparece ANTES del primer
  // dígito — un "+" posterior no es indicativo de país.
  const tienePlus = /^[^\d]*\+/.test(principal);
  const digitos = principal.replace(/\D/g, '');
  if (!digitos) return '';

  const base = (tienePlus ? '+' : '') + digitos;
  return extMatch ? `${base},${extMatch[1]}` : base;
}

/**
 * Enlace "Llamar" para vistas de solo lectura. Devuelve cadena vacía si el
 * número no es marcable, para que el llamador no tenga que validar antes.
 * @param {string} numero
 * @param {{label?: boolean}} [opts] - `label: true` muestra el número junto al ícono.
 */
export function callLinkHtml(numero, { label = false } = {}) {
  const href = telHref(numero);
  if (!href) return '';
  return `<a class="call-btn" href="tel:${esc(href)}" title="Llamar a ${esc(numero)}">`
    + `${Icons.phone}${label ? `<span>${esc(numero)}</span>` : '<span>Llamar</span>'}</a>`;
}

/**
 * Botón "Llamar" para formularios de edición: marca el valor que tenga el
 * input en ese momento, aunque todavía no se haya guardado.
 * @param {string} inputId - id del <input> de teléfono asociado.
 */
export function callInputButtonHtml(inputId) {
  return `<button type="button" class="call-btn call-btn-icon" data-call-input="${esc(inputId)}" title="Llamar a este número">${Icons.phone}</button>`;
}

/**
 * Campo de formulario completo (label + input + botón Llamar), para no
 * repetir la misma estructura en cada módulo.
 */
export function phoneFieldHtml({ id, label, placeholder = '', value = '', span = false }) {
  return `
    <div class="form-field${span ? ' span2' : ''}">
      <label class="fl">${esc(label)}</label>
      <div class="call-field">
        <input class="fi" id="${esc(id)}" type="tel" placeholder="${esc(placeholder)}" value="${esc(value)}"/>
        ${callInputButtonHtml(id)}
      </div>
    </div>`;
}

/**
 * Conecta, una sola vez, todos los botones Llamar presentes y futuros
 * mediante delegación de eventos en `document`.
 */
export function initCallButtons() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-call-input]');
    if (!btn) return;
    const input = document.getElementById(btn.dataset.callInput);
    const href = telHref(input?.value);
    if (!href) return; // sin número marcable no hay nada que hacer
    window.location.href = `tel:${href}`;
  });
}
