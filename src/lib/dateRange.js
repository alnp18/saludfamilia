import { fmtDate, today } from './utils.js';

/**
 * Patrón transversal "Rango de fechas" — auditoría móvil 2026-07-25, Fase 1.
 * Un solo control (no dos cajas de fecha sueltas) que abre un calendario
 * desplegable de 2 meses para elegir inicio y fin. Se usa en Órdenes
 * (autorización), Medicamentos (vigencia) y Pólizas (vigencia).
 *
 * API por campo, identificado por `prefix`:
 *  - `dateRangeFieldHtml(prefix, opts)`  → HTML a insertar en el formulario.
 *  - `wireDateRangeField(prefix, opts)`  → conecta el botón con el popover.
 *  - `fillDateRangeField(prefix, start, end)` → carga valores existentes.
 *  - `readDateRangeField(prefix)`        → { inicio, fin } en formato ISO
 *    (yyyy-mm-dd) o '' si no se eligió esa punta.
 *
 * Los valores viajan en dos `<input type="hidden">` (`${prefix}-inicio` /
 * `${prefix}-fin`); el resto de la app sigue leyendo/guardando fechas ISO
 * como siempre, sin enterarse de que ahora se eligen con un calendario.
 */

let openPopover = null; // referencia al popover abierto, para poder cerrarlo

function closeOpenPopover() {
  if (openPopover) {
    openPopover.remove();
    openPopover = null;
  }
}

/** Exportado para que closeModal() también cierre un calendario abierto
 * (el popover vive en document.body, fuera del modal, así que no
 * desaparece solo cuando se cierra el modal). */
export function closeDateRangePopover() {
  closeOpenPopover();
}

/** HTML del control (botón que muestra el rango + inputs ocultos con el valor real). */
export function dateRangeFieldHtml(prefix, { label = 'Rango de fechas', span = false } = {}) {
  const cls = span ? 'form-field span2' : 'form-field';
  return `
    <div class="${cls}">
      <label class="fl">${label}</label>
      <button type="button" class="fi dr-trigger" id="${prefix}-trigger">Seleccionar fechas</button>
      <input type="hidden" id="${prefix}-inicio"/>
      <input type="hidden" id="${prefix}-fin"/>
    </div>`;
}

function displayText(inicio, fin) {
  if (!inicio && !fin) return 'Seleccionar fechas';
  if (inicio && !fin) return `Desde ${fmtDate(inicio)}`;
  if (!inicio && fin) return `Hasta ${fmtDate(fin)}`;
  return `${fmtDate(inicio)} – ${fmtDate(fin)}`;
}

function updateTrigger(prefix) {
  const inicio = document.getElementById(`${prefix}-inicio`)?.value || '';
  const fin = document.getElementById(`${prefix}-fin`)?.value || '';
  const btn = document.getElementById(`${prefix}-trigger`);
  if (btn) {
    btn.textContent = displayText(inicio, fin);
    btn.classList.toggle('dr-trigger-empty', !inicio && !fin);
  }
}

/** Conecta el botón disparador con el popover de calendario. Llamar una vez, después de insertar el HTML del formulario. */
export function wireDateRangeField(prefix, { onChange } = {}) {
  const trigger = document.getElementById(`${prefix}-trigger`);
  if (!trigger) return;
  updateTrigger(prefix);
  trigger.addEventListener('click', () => {
    if (openPopover?.dataset.forPrefix === prefix) { closeOpenPopover(); return; }
    openCalendarPopover(prefix, trigger, onChange);
  });
}

/** Pobla el control con valores existentes (edición). Llamar después de wireDateRangeField. */
export function fillDateRangeField(prefix, inicio, fin) {
  const inicioEl = document.getElementById(`${prefix}-inicio`);
  const finEl = document.getElementById(`${prefix}-fin`);
  if (inicioEl) inicioEl.value = inicio || '';
  if (finEl) finEl.value = fin || '';
  updateTrigger(prefix);
}

/** Lee el valor actual del rango. */
export function readDateRangeField(prefix) {
  return {
    inicio: document.getElementById(`${prefix}-inicio`)?.value || '',
    fin: document.getElementById(`${prefix}-fin`)?.value || '',
  };
}

// ─────────────────────────────────────────
// Popover: calendario de 2 meses
// ─────────────────────────────────────────

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
  'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const DIAS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

function ymd(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Grilla de un mes (lunes primero), con celdas vacías al inicio/fin para alinear. */
function monthGridHtml(year, month, state) {
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7; // 0 = lunes
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push('<span class="dr-day dr-day-empty"></span>');
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = ymd(year, month, d);
    let cls = 'dr-day';
    if (state.inicio && iso === state.inicio) cls += ' dr-day-start';
    if (state.fin && iso === state.fin) cls += ' dr-day-end';
    if (state.inicio && state.fin && iso > state.inicio && iso < state.fin) cls += ' dr-day-in-range';
    if (iso === today()) cls += ' dr-day-today';
    cells.push(`<span class="${cls}" data-iso="${iso}">${d}</span>`);
  }
  return `
    <div class="dr-month">
      <div class="dr-month-title">${MESES[month]} ${year}</div>
      <div class="dr-weekdays">${DIAS.map(d => `<span>${d}</span>`).join('')}</div>
      <div class="dr-days">${cells.join('')}</div>
    </div>`;
}

function openCalendarPopover(prefix, anchor, onChange) {
  closeOpenPopover();

  const current = readDateRangeField(prefix);
  const state = { inicio: current.inicio || '', fin: current.fin || '' };
  // Mes base: el de "inicio" si existe, si no el mes actual.
  const base = state.inicio ? new Date(state.inicio) : new Date();
  let viewYear = base.getFullYear();
  let viewMonth = base.getMonth();

  const pop = document.createElement('div');
  pop.className = 'dr-popover';
  pop.dataset.forPrefix = prefix;
  document.body.appendChild(pop);
  openPopover = pop;

  function render() {
    const nextMonth = viewMonth === 11 ? 0 : viewMonth + 1;
    const nextYear = viewMonth === 11 ? viewYear + 1 : viewYear;
    pop.innerHTML = `
      <div class="dr-popover-head">
        <button type="button" class="dr-nav" data-nav="-1" aria-label="Mes anterior">‹</button>
        <button type="button" class="dr-nav" data-nav="1" aria-label="Mes siguiente">›</button>
      </div>
      <div class="dr-months">
        ${monthGridHtml(viewYear, viewMonth, state)}
        ${monthGridHtml(nextYear, nextMonth, state)}
      </div>
      <div class="dr-popover-foot">
        <button type="button" class="btn btn-sm" id="dr-clear">Limpiar</button>
        <div style="flex:1"></div>
        <button type="button" class="btn btn-sm" id="dr-cancel">Cancelar</button>
        <button type="button" class="btn btn-sm btn-primary" id="dr-apply">Aplicar</button>
      </div>`;

    pop.querySelector('[data-nav="-1"]').addEventListener('click', () => {
      viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; }
      render();
    });
    pop.querySelector('[data-nav="1"]').addEventListener('click', () => {
      viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; }
      render();
    });
    pop.querySelectorAll('.dr-day[data-iso]').forEach(cell => {
      cell.addEventListener('click', () => {
        const iso = cell.dataset.iso;
        if (!state.inicio || (state.inicio && state.fin)) {
          // Empezamos una selección nueva.
          state.inicio = iso;
          state.fin = '';
        } else if (iso < state.inicio) {
          // Se eligió una fecha anterior al inicio: se convierte en el nuevo inicio.
          state.inicio = iso;
        } else {
          state.fin = iso;
        }
        render();
      });
    });
    pop.querySelector('#dr-clear').addEventListener('click', () => {
      state.inicio = ''; state.fin = '';
      render();
    });
    pop.querySelector('#dr-cancel').addEventListener('click', closeOpenPopover);
    pop.querySelector('#dr-apply').addEventListener('click', () => {
      fillDateRangeField(prefix, state.inicio, state.fin);
      closeOpenPopover();
      onChange?.(state);
    });
  }
  render();
  positionPopover(pop, anchor);

  // Cierre con Escape; el click afuera NO cierra (mismo criterio que el
  // resto de ventanas flotantes de la app — solo se cierra con un control
  // explícito: Cancelar, Aplicar o Escape).
  document.addEventListener('keydown', onEscape);
  function onEscape(e) {
    if (e.key === 'Escape') { closeOpenPopover(); document.removeEventListener('keydown', onEscape); }
  }
}

function positionPopover(pop, anchor) {
  const rect = anchor.getBoundingClientRect();
  const popWidth = pop.offsetWidth || 560;
  let left = rect.left;
  if (left + popWidth > window.innerWidth - 12) left = Math.max(12, window.innerWidth - popWidth - 12);
  pop.style.left = `${left}px`;
  pop.style.top = `${rect.bottom + 6}px`;
  // Si no entra debajo (poco espacio), se muestra arriba del disparador.
  const popHeight = pop.offsetHeight || 340;
  if (rect.bottom + popHeight + 6 > window.innerHeight) {
    pop.style.top = `${Math.max(12, rect.top - popHeight - 6)}px`;
  }
}
