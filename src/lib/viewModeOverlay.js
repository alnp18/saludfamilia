/**
 * Overlay genérico de "Modo vista" (MI AUDITORIA #4 y #Órdenes-3): una
 * ventana sobrepuesta de solo lectura con una barra superior que NUNCA se
 * mueve al hacer scroll por el contenido, con sus acciones (ej. "Editar")
 * al lado del botón de cerrar. Pensado para reutilizarse en cualquier
 * "modo vista" de la app (Pacientes, Órdenes…) en vez de reimplementar el
 * mismo patrón de barra fija en cada módulo — mismo espíritu que
 * src/lib/viewer.js y src/lib/legal.js, pero configurable en título,
 * contenido y acciones.
 *
 * La barra queda fija con `position: sticky; top: 0` DENTRO de la tarjeta
 * scrolleable (igual que legal.js) — no un layout flex con dos regiones —
 * porque es más simple y ya está probado en esta app.
 */
let activeClose = null;

/**
 * @param {object} opts
 * @param {string} opts.title - texto plano (se asigna vía textContent, nunca HTML)
 * @param {string} [opts.subtitle] - texto plano opcional
 * @param {string} opts.bodyHtml - HTML ya armado (y ya escapado por el caller) del contenido
 * @param {Array<{label:string, cls?:string, onClick:(close:Function)=>void}>} [opts.actions] - botones extra en la barra, antes del de cerrar
 * @param {string} [opts.maxWidth] - ancho máximo de la tarjeta (por defecto 640px)
 */
export function openViewOverlay({ title, subtitle = '', bodyHtml, actions = [], maxWidth = '640px' }) {
  activeClose?.();

  const root = document.createElement('div');
  root.className = 'pv-overlay';
  root.innerHTML = `
    <div class="pv-card" style="max-width:${maxWidth}">
      <div class="pv-bar">
        <div class="pv-bar-title">
          <div class="pv-bar-name" id="pv-title"></div>
          <div class="pv-bar-sub" id="pv-subtitle"></div>
        </div>
        <div class="pv-bar-actions">
          ${actions.map((a, i) => `<button type="button" class="btn btn-sm ${a.cls || ''}" data-pv-action="${i}">${a.label}</button>`).join('')}
          <button type="button" class="modal-close" id="pv-close-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
      <div class="pv-body">${bodyHtml}</div>
    </div>`;
  document.body.appendChild(root);

  root.querySelector('#pv-title').textContent = title;
  const subEl = root.querySelector('#pv-subtitle');
  if (subtitle) subEl.textContent = subtitle; else subEl.remove();

  function close() {
    document.removeEventListener('keydown', onKeydown);
    root.remove();
    activeClose = null;
  }
  function onKeydown(e) { if (e.key === 'Escape') close(); }

  activeClose = close;
  document.addEventListener('keydown', onKeydown);
  root.querySelector('#pv-close-btn').addEventListener('click', close);
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  root.querySelectorAll('[data-pv-action]').forEach((btn, i) => {
    btn.addEventListener('click', () => actions[i].onClick(close));
  });

  return { close, root };
}

export function closeViewOverlay() {
  activeClose?.();
}
