import * as auth from './lib/auth.js';
import * as api from './lib/api.js';
import { state, restoreActivePatientId, persistActivePatientId, updatePatientHeader, updateNoPatientBanner, applyPatientTheme } from './state.js';
import { initModalOverlay, showToast } from './lib/modal.js';
import { wireHeader, closePatientDrop } from './modules/header.js';

import * as Dashboard from './modules/dashboard.js';
import * as Patients from './modules/patients.js';
import * as Orders from './modules/orders.js';
import * as Meds from './modules/meds.js';
import * as Vitals from './modules/vitals.js';
import * as Centers from './modules/centers.js';
import * as Doctors from './modules/doctors.js';

const VIEW_RENDERERS = {
  dashboard: Dashboard.render,
  orders: Orders.render,
  meds: Meds.render,
  vitals: Vitals.render,
  centers: Centers.render,
  doctors: Doctors.render,
  patients: Patients.render,
};

function goView(v, options) {
  if (v === 'orders' && options) Orders.setPendingOptions(options);
  if (v === 'meds' && options) Meds.setPendingOptions(options);
  if (v === 'vitals' && options) Vitals.setPendingOptions(options);

  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.sb-item').forEach(el => el.classList.remove('active'));
  document.getElementById(`view-${v}`)?.classList.add('active');
  document.querySelector(`[data-view="${v}"]`)?.classList.add('active');
  state.currentView = v;
  closePatientDrop();
  VIEW_RENDERERS[v]?.();
}

async function setActivePatient(patient) {
  state.activePatient = patient;
  persistActivePatientId(patient ? patient.id : null);
  updatePatientHeader();
  updateNoPatientBanner();
  applyPatientTheme(patient);
  VIEW_RENDERERS[state.currentView]?.();
  closePatientDrop();
}

function wireSidebar() {
  document.querySelectorAll('.sb-item').forEach(el => {
    el.addEventListener('click', () => goView(el.dataset.view));
  });
}

async function bootstrapApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app-header').style.display = 'flex';
  document.getElementById('app-shell').style.display = 'flex';

  initModalOverlay();
  wireHeader({ setActivePatient, goView });
  wireSidebar();
  Dashboard.setNavigator(goView);
  Patients.setActivePatientSetter(setActivePatient);

  try {
    state.household = await auth.ensureHousehold(state.user.id);
  } catch (err) {
    showToast(err.message || 'Error al preparar tu cuenta', 'err');
    return;
  }

  const patients = await api.listPatients(state.household.id);
  document.getElementById('sb-badge-patients').textContent = patients.length;

  const savedId = restoreActivePatientId();
  const restored = savedId ? patients.find(p => p.id === savedId) : null;
  if (restored) {
    state.activePatient = restored;
    updatePatientHeader();
    applyPatientTheme(restored);
  }
  updateNoPatientBanner();

  goView('dashboard');
}

// ─────────────────────────────────────────
// AUTH SCREEN
// ─────────────────────────────────────────
let authMode = 'signin'; // 'signin' | 'signup'

function setAuthMode(mode) {
  authMode = mode;
  document.getElementById('auth-title').textContent = mode === 'signin' ? 'Iniciar sesión' : 'Crear cuenta';
  document.getElementById('auth-sub').textContent = mode === 'signin'
    ? 'Entra con tu correo y contraseña.'
    : 'Crea tu cuenta para empezar a gestionar la salud de tu familia.';
  document.getElementById('auth-submit').textContent = mode === 'signin' ? 'Entrar' : 'Crear cuenta';
  document.getElementById('auth-switch-text').textContent = mode === 'signin' ? '¿No tienes cuenta?' : '¿Ya tienes cuenta?';
  document.getElementById('auth-switch-btn').textContent = mode === 'signin' ? 'Crear una' : 'Iniciar sesión';
  document.getElementById('auth-error').classList.remove('show');
}

function wireAuthScreen() {
  document.getElementById('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = document.getElementById('auth-submit');
    if (submitBtn.disabled) return;

    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const errEl = document.getElementById('auth-error');
    errEl.classList.remove('show');

    submitBtn.disabled = true;
    try {
      if (authMode === 'signin') {
        await auth.signIn(email, password);
      } else {
        await auth.signUp(email, password);
      }
      // onAuthStateChange dispara bootstrapApp()
    } catch (err) {
      errEl.textContent = err.message || 'Ocurrió un error. Intenta de nuevo.';
      errEl.classList.add('show');
    } finally {
      submitBtn.disabled = false;
    }
  });
}

async function init() {
  wireAuthScreen();

  const session = await auth.getSession();
  if (session) {
    state.user = session.user;
    await bootstrapApp();
  }

  auth.onAuthStateChange(async (session) => {
    if (session && !state.user) {
      state.user = session.user;
      await bootstrapApp();
    } else if (!session && state.user) {
      state.user = null;
      state.household = null;
      state.activePatient = null;
      window.location.reload();
    }
  });
}

init();
