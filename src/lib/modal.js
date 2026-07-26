import { closeDateRangePopover } from './dateRange.js';

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
  document.getElementById('overlay').classList.remove('open');
  // El popover del selector de rango de fechas vive en document.body, fuera
  // del modal (ver src/lib/dateRange.js) — se cierra explícitamente para no
  // dejarlo huérfano si el modal se cierra con uno abierto.
  closeDateRangePopover();
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
