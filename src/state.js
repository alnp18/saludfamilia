import { ThemeEngine } from './lib/theme.js';
import { initials, avatarColor } from './lib/utils.js';

export const state = {
  user: null,        // sesión de Supabase Auth
  household: null,   // { id, name }
  activePatient: null,
  currentView: 'dashboard',
  // Preferencia general de accesibilidad/legibilidad (claro/oscuro), independiente
  // de cualquier paciente. Es el ÚNICO control de modo claro/oscuro de la app.
  lightMode: false,
};

function storageKey() {
  return `sf_active_patient_${state.user?.id || 'anon'}`;
}

export function restoreActivePatientId() {
  return localStorage.getItem(storageKey());
}

export function persistActivePatientId(id) {
  if (id) localStorage.setItem(storageKey(), id);
  else localStorage.removeItem(storageKey());
}

function lightModeKey() {
  return `sf_light_mode_${state.user?.id || 'anon'}`;
}

/** Restaura la preferencia general de modo claro/oscuro guardada para este usuario. */
export function restoreLightMode() {
  return localStorage.getItem(lightModeKey()) === '1';
}

export function persistLightMode(isLight) {
  localStorage.setItem(lightModeKey(), isLight ? '1' : '0');
}

export function updatePatientHeader() {
  const av = document.getElementById('ps-avatar');
  const name = document.getElementById('ps-name');
  if (!av || !name) return;
  if (state.activePatient) {
    av.textContent = initials(state.activePatient.nombre);
    av.style.background = avatarColor(state.activePatient.nombre);
    name.textContent = state.activePatient.nombre;
  } else {
    av.textContent = '—';
    av.style.background = '#3d5475';
    name.textContent = 'Seleccionar paciente';
  }
}

export function updateNoPatientBanner() {
  document.getElementById('no-patient-banner')?.classList.toggle('hidden', !!state.activePatient);
}

/**
 * Aplica la paleta de color automática del paciente (ThemeEngine). El fondo
 * claro/oscuro sobre el que se renderiza esa paleta sigue la preferencia
 * general del usuario (state.lightMode) — nunca una preferencia propia del
 * paciente. Son dos conceptos independientes: el matiz/color lo decide
 * ThemeEngine según el paciente; el claro/oscuro lo decide el usuario.
 */
export function applyPatientTheme(patient) {
  if (!patient) { ThemeEngine.reset(); return; }
  const spec = ThemeEngine.generate(patient, state.lightMode);
  ThemeEngine.apply(spec, state.lightMode);
}
