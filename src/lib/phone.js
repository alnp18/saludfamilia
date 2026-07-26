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
 * El wiring es por delegación global (`initCallButtons`, una sola vez desde
 * main.js): los módulos re-arman su HTML con innerHTML constantemente, así
 * que enganchar listeners por render sería frágil y fácil de olvidar.
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

const ICONO_TELEFONO = Icons.phone;

/**
 * Enlace "Llamar" para vistas de solo lectura. Devuelve cadena vacía si el
 * número no es marcable, para que el llamador no tenga que validar antes.
 * @param {string} numero
 * @param {{label?: boolean}} [opts] - `label: true` muestra el número junto al ícono.
 */
export function callLinkHtml(numero, { label = false } = {}) {
  const href = telHref(numero);
  if (!href) return '';
  return `<a class="call-btn" href="tel:${esc(href)}" data-call title="Llamar a ${esc(numero)}">`
    + `${ICONO_TELEFONO}${label ? `<span>${esc(numero)}</span>` : '<span>Llamar</span>'}</a>`;
}

/**
 * Botón "Llamar" para formularios de edición: marca el valor que tenga el
 * input en ese momento, aunque todavía no se haya guardado.
 * @param {string} inputId - id del <input> de teléfono asociado.
 */
export function callInputButtonHtml(inputId) {
  return `<button type="button" class="call-btn call-btn-icon" data-call-input="${esc(inputId)}" title="Llamar a este número">${ICONO_TELEFONO}</button>`;
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

// ─────────────────────────────────────────
// Permiso de micrófono
// ─────────────────────────────────────────

let micSolicitado = false;

/**
 * Solicita el permiso de micrófono del dispositivo la primera vez que se usa
 * el botón Llamar.
 *
 * IMPORTANTE — decisión de producto, no una necesidad técnica: marcar por
 * "tel:" delega la llamada a la app de teléfono del sistema, que usa el
 * micrófono con sus propios permisos; el navegador no necesita ninguno. Se
 * pide igual por pedido explícito del hallazgo de la auditoría, pero de
 * forma deliberadamente inofensiva:
 *  · nunca bloquea la llamada — si se deniega o falla, se marca igual;
 *  · se pide una sola vez por sesión, no en cada llamada;
 *  · el stream se cierra de inmediato, para no dejar el indicador de
 *    grabación encendido ni consumir batería.
 * Si en el futuro se implementan llamadas dentro de la app (WebRTC), este
 * es el punto donde ese permiso pasaría a usarse de verdad.
 */
async function solicitarMicrofono() {
  if (micSolicitado || !navigator.mediaDevices?.getUserMedia) return;
  micSolicitado = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());
  } catch {
    // Permiso denegado o no disponible: irrelevante para marcar.
  }
}

/**
 * Conecta, una sola vez, todos los botones Llamar presentes y futuros
 * mediante delegación de eventos en `document`.
 */
export function initCallButtons() {
  document.addEventListener('click', (e) => {
    const link = e.target.closest('[data-call]');
    if (link) {
      // La navegación "tel:" la maneja el <a> nativo; el permiso se pide en
      // paralelo, sin await, para no interferir con ella.
      solicitarMicrofono();
      return;
    }

    const btn = e.target.closest('[data-call-input]');
    if (!btn) return;
    const input = document.getElementById(btn.dataset.callInput);
    const href = telHref(input?.value);
    if (!href) return; // sin número marcable no hay nada que hacer
    solicitarMicrofono();
    window.location.href = `tel:${href}`;
  });
}
