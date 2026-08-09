import { closeDateRangePopover } from './dateRange.js';
import { closeLiveSearchDropdown } from './liveSearch.js';

let toastTimer;

export function showToast(msg, type = 'ok') {
  const el = document.getElementById('toast');
  const ico = document.getElementById('toast-icon');
  document.getElementById('toast-msg').textContent = msg;
  el.className = 'show ' + type;
  ico.innerHTML = type === 'ok'
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
    : type === 'err'
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 3500);
}

const MODAL_ICON_PATHS = {
  paciente: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2 M12 3a4 4 0 110 8 4 4 0 010-8z',
  medicamento: 'M10.5 6.5L6.5 10.5a5 5 0 007.07 7.07l4-4a5 5 0 00-7.07-7.07z M14 10l-4 4',
  vital: 'M22 12h-4l-3 9L9 3l-3 9H2',
  signo: 'M22 12h-4l-3 9L9 3l-3 9H2',
  centro: 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z M9 22V12h6v10',
  orden: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2 M9 5a2 2 0 004 0 M9 14l2 2 4-4',
};

/**
 * Muestra el modal genérico. `title` siempre se inyecta como textContent
 * (nunca innerHTML) para que nunca se renderice como código visible.
 */
export function showModal(title, bodyHtml, buttons = []) {
  // El ancho es por modal: se limpia acá para que el que fijó setModalMaxWidth
  // (Órdenes, Signos vitales) no se lo deje puesto al siguiente, que puede ser
  // un formulario angosto.
  document.getElementById('modal').style.maxWidth = '';
  document.getElementById('modal-title').textContent = title;

  const tl = title.toLowerCase();
  let path = MODAL_ICON_PATHS.orden;
  for (const [k, p] of Object.entries(MODAL_ICON_PATHS)) {
    if (tl.includes(k)) { path = p; break; }
  }
  const svgEl = document.getElementById('modal-icon-svg');
  if (svgEl) {
    svgEl.innerHTML = path.split(' M ').map((seg, i) =>
      `<path stroke-linecap="round" stroke-linejoin="round" d="${i === 0 ? seg : 'M ' + seg}"/>`
    ).join('');
  }

  document.getElementById('modal-body').innerHTML = bodyHtml;
  document.getElementById('modal-footer').innerHTML = buttons.map(b =>
    `<button class="${b.cls}" data-action-id="${b.id || ''}">${b.label}</button>`
  ).join('');

  // Los botones reciben su handler directamente (sin onclick inline con
  // strings, para evitar acoplar el HTML generado a nombres globales)
  const footer = document.getElementById('modal-footer');
  footer.querySelectorAll('button').forEach((btn, i) => {
    btn.addEventListener('click', buttons[i].action);
  });

  document.getElementById('modal').style.maxWidth = '';
  document.getElementById('overlay').classList.add('open');
}

export function closeModal() {
  // Si quedara alguno apilado encima, se va con el de abajo: un modal
  // flotando sobre nada no tiene a qué volver.
  while (modalStack.length) closeStackedModal();
  document.getElementById('overlay').classList.remove('open');
  // Las ventanas flotantes ancladas (calendario de rango y desplegable de
  // resultados de búsqueda) viven en document.body, fuera del modal, así que
  // no desaparecen solas al cerrarlo.
  closeDateRangePopover();
  closeLiveSearchDropdown();
}

// ─────────────────────────────────────────
// Modales apilados — auditoría móvil 2026-07-26, Fase 3
//
// El modal genérico de arriba es una estructura fija del index.html: hay uno
// solo, y `showModal` le reemplaza el contenido. Eso alcanzaba mientras nada
// necesitara abrir un formulario ENCIMA de otro, pero el flujo
// Centro → Médico → Orden sí lo necesita: se está creando un médico y hace
// falta registrar el centro donde atiende, sin perder lo ya escrito.
//
// Reutilizar el modal de siempre no sirve para esto: reemplazar su innerHTML
// destruye los listeners del formulario de abajo y no hay forma honesta de
// restaurarlos. Por eso cada modal apilado es un overlay propio, creado y
// destruido entero — al cerrarlo, el de abajo sigue intacto porque nunca se
// tocó.
//
// z-index: 510, 520, … siempre por debajo de 600, que es donde viven el
// calendario de rango y el desplegable de búsqueda. Así esos siguen
// dibujándose por encima del modal apilado que los abrió.
// ─────────────────────────────────────────

const modalStack = [];

/**
 * Abre un modal encima del que ya está visible.
 *
 * @param {string} title - se inserta como texto, nunca como HTML.
 * @param {string} bodyHtml
 * @param {Array<{label:string, cls:string, action:Function}>} buttons
 * @param {object} [opts]
 * @param {string} [opts.maxWidth]
 * @param {Function} [opts.onClose] - se llama al cerrarse, pase lo que pase
 *   (botón, X o cierre en cascada). Es donde el modal de abajo refresca lo
 *   que el de arriba pudo haber cambiado.
 * @returns {HTMLElement} el overlay creado, para consultarlo con querySelector.
 */
export function openStackedModal(title, bodyHtml, buttons = [], { maxWidth = '', onClose } = {}) {
  const nivel = modalStack.length + 1;

  const overlay = document.createElement('div');
  overlay.className = 'overlay-stacked';
  overlay.style.zIndex = String(500 + nivel * 10);
  overlay.innerHTML = `
    <div class="modal"${maxWidth ? ` style="max-width:${maxWidth}"` : ''}>
      <div class="modal-hd">
        <div class="modal-icon-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><path d="M9 22V12h6v10"/></svg>
        </div>
        <h2></h2>
        <button class="modal-close" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body-stacked"></div>
      <div class="modal-ft"></div>
    </div>`;

  overlay.querySelector('h2').textContent = title;
  overlay.querySelector('.modal-body-stacked').innerHTML = bodyHtml;

  const footer = overlay.querySelector('.modal-ft');
  footer.innerHTML = buttons.map(b => `<button class="${b.cls}" type="button">${b.label}</button>`).join('');
  footer.querySelectorAll('button').forEach((btn, i) =>
    btn.addEventListener('click', buttons[i].action));

  // Mismo criterio que el modal de siempre (patrón "Ventanas flotantes"): no
  // se cierra con click afuera, para no perder lo escrito por accidente.
  overlay.querySelector('.modal-close').addEventListener('click', () => closeStackedModal());

  document.body.appendChild(overlay);
  modalStack.push({ overlay, onClose });
  return overlay;
}

/** Cierra el modal apilado de más arriba y devuelve el control al de abajo. */
export function closeStackedModal() {
  const top = modalStack.pop();
  if (!top) return;
  top.overlay.remove();
  closeDateRangePopover();
  closeLiveSearchDropdown();
  top.onClose?.();
}

/** ¿Hay algún modal apilado abierto? */
export function hayModalApilado() {
  return modalStack.length > 0;
}

export function setModalMaxWidth(px) {
  document.getElementById('modal').style.maxWidth = px;
}

export function initModalOverlay() {
  // Patrón "Ventanas flotantes" (auditoría móvil 2026-07-25): los modales de
  // creación/edición (Pacientes, Médicos, Centros, Medicamentos, Órdenes,
  // Pólizas — todos comparten este único overlay) NO se cierran con un click
  // afuera. Es fácil perder sin querer varios campos ya llenados con un
  // click accidental fuera del modal; el cierre queda solo en manos de un
  // control explícito: el botón X de la esquina superior, o el botón
  // "Cancelar"/equivalente de cada formulario (que ya llama a closeModal()).
  document.querySelector('.modal-close')?.addEventListener('click', closeModal);
}
