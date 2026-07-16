import { state, applyPatientTheme, persistLightMode } from '../state.js';
import * as api from '../lib/api.js';
import * as auth from '../lib/auth.js';
import { esc, initials, avatarColor } from '../lib/utils.js';

let dropOpen = false;
let navOpen = false;
let setActivePatientCb = null;
let goViewCb = null;

export function wireHeader({ setActivePatient, goView }) {
  setActivePatientCb = setActivePatient;
  goViewCb = goView;

  document.getElementById('patient-selector').addEventListener('click', togglePatientDrop);
  document.getElementById('theme-toggle-btn').addEventListener('click', toggleLightMode);
  updateThemeToggleBtn(state.lightMode);
  document.getElementById('btn-logout').addEventListener('click', async () => {
    await auth.signOut();
    window.location.reload();
  });
  document.getElementById('banner-goto-patients').addEventListener('click', () => goViewCb?.('patients'));

  // Menú móvil: el sidebar se vuelve un panel superpuesto (ver CSS,
  // @media max-width:768px) que se abre/cierra con este botón — a ese
  // ancho no hay otra forma de navegar entre secciones (P2 #9).
  document.getElementById('mobile-nav-btn')?.addEventListener('click', toggleMobileNav);
  document.getElementById('sidebar-backdrop')?.addEventListener('click', closeMobileNav);

  document.addEventListener('click', e => {
    if (!e.target.closest('#patient-selector') && !e.target.closest('#patient-drop')) closePatientDrop();
  });
}

export function closeMobileNav() {
  navOpen = false;
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebar-backdrop')?.classList.remove('open');
}

function toggleMobileNav() {
  navOpen = !navOpen;
  document.getElementById('sidebar')?.classList.toggle('open', navOpen);
  document.getElementById('sidebar-backdrop')?.classList.toggle('open', navOpen);
}

export function closePatientDrop() {
  dropOpen = false;
  document.getElementById('patient-drop').classList.remove('open');
}

async function togglePatientDrop() {
  dropOpen = !dropOpen;
  const drop = document.getElementById('patient-drop');
  if (!dropOpen) { drop.classList.remove('open'); return; }

  const patients = await api.listPatients(state.household.id);
  let html = '';
  if (patients.length) {
    patients.forEach(p => {
      const ac = avatarColor(p.nombre);
      const cur = state.activePatient?.id === p.id ? 'current' : '';
      html += `<div class="pdrop-item ${cur}" data-select-id="${p.id}">
        <div style="background:${ac};width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;flex-shrink:0">${initials(p.nombre)}</div>
        <div><div style="font-size:13.5px;font-weight:600">${esc(p.nombre)}</div><div style="font-size:11px;color:var(--ts)">${esc(p.eps || 'Sin EPS registrada')}</div></div>
        ${cur ? '<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" style="color:var(--t-primary-lt);margin-left:auto"><path stroke-linecap="round" d="M5 13l4 4L19 7"/></svg>' : ''}
      </div>`;
    });
  } else {
    html = `<div style="padding:14px 16px;font-size:13px;color:var(--ts)">Sin pacientes registrados</div>`;
  }
  html += `<div class="pdrop-sep"></div><div class="pdrop-action" id="pdrop-manage">Gestionar pacientes</div>`;
  drop.innerHTML = html;
  drop.classList.add('open');

  drop.querySelectorAll('[data-select-id]').forEach(el => el.addEventListener('click', async () => {
    const p = patients.find(x => x.id === el.dataset.selectId);
    if (p) await setActivePatientCb?.(p);
    closePatientDrop();
  }));
  document.getElementById('pdrop-manage').addEventListener('click', () => { goViewCb?.('patients'); closePatientDrop(); });
}

function updateThemeToggleBtn(isLight) {
  const btn = document.getElementById('theme-toggle-btn');
  if (!btn) return;
  btn.classList.toggle('is-light', isLight);
  const moonSVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>';
  const sunSVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/></svg>';
  // El texto va en su propio <span> para poder ocultarlo en pantallas
  // angostas (queda solo el ícono) sin tocar esta función — ver CSS.
  btn.innerHTML = isLight
    ? `${moonSVG}<span class="theme-toggle-label">Modo oscuro</span>`
    : `${sunSVG}<span class="theme-toggle-label">Modo claro</span>`;
}

/**
 * Único control de modo claro/oscuro de toda la app: es una preferencia
 * general de accesibilidad/legibilidad, independiente de cualquier paciente.
 * Nunca debe leer ni escribir datos del paciente activo — si hay uno, solo se
 * le vuelve a aplicar su paleta (ThemeEngine) para que su fondo se adapte al
 * modo recién elegido, pero el matiz/color que le asigna ThemeEngine no cambia.
 */
function toggleLightMode() {
  state.lightMode = !state.lightMode;
  persistLightMode(state.lightMode);
  document.body.classList.toggle('light-mode', state.lightMode);
  updateThemeToggleBtn(state.lightMode);
  if (state.activePatient) applyPatientTheme(state.activePatient);
}

export { updateThemeToggleBtn };
