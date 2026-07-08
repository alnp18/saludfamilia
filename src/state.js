import { ThemeEngine } from './lib/theme.js';
import { initials, avatarColor } from './lib/utils.js';

export const state = {
  user: null,        // sesión de Supabase Auth
  household: null,   // { id, name }
  activePatient: null,
  currentView: 'dashboard',
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

export function applyPatientTheme(patient) {
  if (!patient) { ThemeEngine.reset(); return; }
  const spec = ThemeEngine.generate(patient);
  ThemeEngine.apply(spec, !!patient._lightMode);
}
