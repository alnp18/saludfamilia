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
let authMode = 'signin'; // 'signin' | 'signup' | 'recover' | 'reset'
let recoveryMode = false; // true mientras el usuario restablece su contraseña vía enlace

// El flag lo setea un <script> inline en el <head> (index.html), antes de que
// supabase-js procese y limpie el hash. Se combina con una lectura directa por
// si el flag no estuviera disponible.
const RECOVERY_IN_URL = window.__recoveryInUrl === true
  || (window.location.hash || '').includes('type=recovery');

const EYE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

// Muestra u oculta el texto de un campo de contraseña, con el icono acorde.
function setPwVisible(inputId, btnId, visible) {
  const input = document.getElementById(inputId);
  const btn = document.getElementById(btnId);
  input.type = visible ? 'text' : 'password';
  btn.innerHTML = visible ? EYE_OFF_SVG : EYE_SVG;
  btn.setAttribute('aria-label', visible ? 'Ocultar contraseña' : 'Mostrar contraseña');
}

function wirePwToggle(inputId, btnId) {
  const input = document.getElementById(inputId);
  document.getElementById(btnId).addEventListener('click', () => {
    setPwVisible(inputId, btnId, input.type === 'password');
  });
}

const AUTH_MODES = {
  signin: {
    title: 'Iniciar sesión',
    sub: 'Entra con tu correo y contraseña.',
    submit: 'Entrar',
    email: true, password: true, confirm: false, forgot: true, showSwitch: true,
    passwordLabel: 'Contraseña', passwordAutocomplete: 'current-password',
    switchText: '¿No tienes cuenta?', switchBtn: 'Crear una',
  },
  signup: {
    title: 'Crear cuenta',
    sub: 'Crea tu cuenta para empezar a gestionar la salud de tu familia.',
    submit: 'Crear cuenta',
    email: true, password: true, confirm: false, forgot: false, showSwitch: true,
    passwordLabel: 'Contraseña', passwordAutocomplete: 'new-password',
    switchText: '¿Ya tienes cuenta?', switchBtn: 'Iniciar sesión',
  },
  recover: {
    title: 'Recuperar contraseña',
    sub: 'Ingresá tu correo y te enviaremos un enlace para restablecerla.',
    submit: 'Enviar enlace',
    email: true, password: false, confirm: false, forgot: false, showSwitch: true,
    switchText: '¿La recordaste?', switchBtn: 'Iniciar sesión',
  },
  reset: {
    title: 'Nueva contraseña',
    sub: 'Elegí una contraseña nueva para tu cuenta.',
    submit: 'Guardar contraseña',
    email: false, password: true, confirm: true, forgot: false, showSwitch: true,
    passwordLabel: 'Nueva contraseña', passwordAutocomplete: 'new-password',
    switchText: '¿Cambiaste de idea?', switchBtn: 'Volver a iniciar sesión',
  },
};

function toggleField(fieldId, inputId, visible) {
  document.getElementById(fieldId).classList.toggle('hidden', !visible);
  const input = document.getElementById(inputId);
  // El atributo required en un campo oculto rompe la validación del navegador,
  // así que se activa solo cuando el campo está visible.
  if (visible) input.setAttribute('required', '');
  else input.removeAttribute('required');
}

function showAuthScreen() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app-header').style.display = 'none';
  document.getElementById('app-shell').style.display = 'none';
}

function setAuthMode(mode) {
  authMode = mode;
  const cfg = AUTH_MODES[mode];

  document.getElementById('auth-title').textContent = cfg.title;
  document.getElementById('auth-sub').textContent = cfg.sub;
  document.getElementById('auth-submit').textContent = cfg.submit;

  toggleField('auth-email-field', 'auth-email', cfg.email);
  toggleField('auth-password-field', 'auth-password', cfg.password);
  toggleField('auth-confirm-field', 'auth-confirm', cfg.confirm);

  if (cfg.password) {
    document.getElementById('auth-password-label').textContent = cfg.passwordLabel;
    document.getElementById('auth-password').setAttribute('autocomplete', cfg.passwordAutocomplete);
  }

  document.getElementById('auth-forgot-row').classList.toggle('hidden', !cfg.forgot);

  const switchRow = document.querySelector('.auth-switch');
  switchRow.classList.toggle('hidden', !cfg.showSwitch);
  if (cfg.showSwitch) {
    document.getElementById('auth-switch-text').textContent = cfg.switchText;
    document.getElementById('auth-switch-btn').textContent = cfg.switchBtn;
  }

  // Limpiar campos sensibles, resetear la visibilidad de contraseña y el
  // mensaje al cambiar de modo.
  document.getElementById('auth-password').value = '';
  document.getElementById('auth-confirm').value = '';
  setPwVisible('auth-password', 'auth-password-toggle', false);
  setPwVisible('auth-confirm', 'auth-confirm-toggle', false);
  document.getElementById('auth-error').classList.remove('show');
}

function wireAuthScreen() {
  wirePwToggle('auth-password', 'auth-password-toggle');
  wirePwToggle('auth-confirm', 'auth-confirm-toggle');
  setAuthMode('signin');

  document.getElementById('auth-switch-btn').addEventListener('click', () => {
    if (authMode === 'reset') recoveryMode = false;
    setAuthMode(authMode === 'signin' ? 'signup' : 'signin');
  });

  document.getElementById('auth-forgot-btn').addEventListener('click', () => {
    setAuthMode('recover');
  });

  document.getElementById('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = document.getElementById('auth-submit');
    if (submitBtn.disabled) return;
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const confirmPw = document.getElementById('auth-confirm').value;
    const errEl = document.getElementById('auth-error');
    errEl.classList.remove('show');

    if (authMode === 'reset') {
      if (password.length < 6) {
        errEl.textContent = 'La contraseña debe tener al menos 6 caracteres.';
        errEl.classList.add('show');
        return;
      }
      if (password !== confirmPw) {
        errEl.textContent = 'Las contraseñas no coinciden.';
        errEl.classList.add('show');
        return;
      }
    }

    submitBtn.disabled = true;
    try {
      if (authMode === 'signin') {
        await auth.signIn(email, password);
        // onAuthStateChange dispara bootstrapApp()
      } else if (authMode === 'signup') {
        await auth.signUp(email, password);
        errEl.textContent = 'Cuenta creada. Revisá tu correo (bandeja de entrada o spam) para confirmarla antes de iniciar sesión. Si no te llega en unos minutos, es posible que ya tengas una cuenta — probá "Iniciar sesión".';
        errEl.classList.add('show');
        document.getElementById('auth-form').reset();
      } else if (authMode === 'recover') {
        await auth.requestPasswordReset(email, window.location.origin);
        // Mensaje neutral: no revela si el correo está registrado.
        errEl.textContent = 'Si el correo está registrado, te enviamos un enlace para restablecer tu contraseña. Revisá tu bandeja de entrada o spam.';
        errEl.classList.add('show');
        document.getElementById('auth-email').value = '';
      } else if (authMode === 'reset') {
        await auth.updatePassword(password);
        // Cerrar la sesión temporal de recuperación y volver al login.
        await auth.signOut().catch(() => {});
        recoveryMode = false;
        history.replaceState(null, '', window.location.pathname + window.location.search);
        setAuthMode('signin');
        errEl.textContent = 'Contraseña actualizada. Iniciá sesión con tu nueva contraseña.';
        errEl.classList.add('show');
      }
    } catch (err) {
      if (authMode === 'signin' && err.message === 'Invalid login credentials') {
        errEl.textContent = 'Correo o contraseña incorrectos. Si acabás de crear tu cuenta, confirmá tu correo antes de iniciar sesión.';
      } else {
        errEl.textContent = err.message || 'Ocurrió un error. Intenta de nuevo.';
      }
      errEl.classList.add('show');
    } finally {
      submitBtn.disabled = false;
    }
  });
}

async function init() {
  wireAuthScreen();

  if (RECOVERY_IN_URL) {
    // Llegamos desde el enlace del correo: mostrar el formulario de nueva
    // contraseña y NO arrancar la app, aunque el enlace haya creado sesión.
    recoveryMode = true;
    setAuthMode('reset');
  } else {
    const session = await auth.getSession();
    if (session) {
      state.user = session.user;
      await bootstrapApp();
    }
  }

  auth.onAuthStateChange(async (event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
      recoveryMode = true;
      showAuthScreen();
      setAuthMode('reset');
      return;
    }
    // Mientras se restablece la contraseña, ignorar los eventos de sesión
    // (el enlace y updateUser generan sesión, pero no debemos bootstrapear).
    if (recoveryMode) return;

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
