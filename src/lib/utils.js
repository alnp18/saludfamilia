export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Devuelve la URL solo si es http(s); si no, cadena vacía.
 *  Bloquea esquemas peligrosos (javascript:, data:, vbscript:, …). */
export function safeUrl(u) {
  const s = String(u ?? '').trim();
  try {
    const parsed = new URL(s, window.location.origin);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') ? s : '';
  } catch {
    return '';
  }
}

export function initials(name) {
  return (name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

const AVATAR_PALETTE = ['#0e7490', '#7c3aed', '#b45309', '#047857', '#be185d',
  '#1d4ed8', '#c2410c', '#0369a1'];

export function avatarColor(str) {
  let h = 0;
  for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function daysFrom(iso) {
  if (!iso) return null;
  const diff = new Date(iso) - new Date(today());
  return Math.ceil(diff / 86400000);
}

export function calcAge(dob) {
  if (!dob) return null;
  const d = new Date(dob), n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--;
  return a;
}

export function calcAgeDecimal(dob) {
  if (!dob) return 30;
  const d = new Date(dob), n = new Date();
  return (n - d) / (365.25 * 24 * 3600 * 1000);
}

/**
 * Nombre completo del contacto de emergencia a partir de su estructura
 * (columna jsonb `contacto_emergencia`, ver migración 0009). Vive acá
 * porque lo arman por igual la ficha del paciente y el dashboard.
 */
export function nombreContactoEmergencia(ce) {
  if (!ce) return '';
  return [ce.primerNombre, ce.segundoNombre, ce.primerApellido, ce.segundoApellido]
    .filter(Boolean).join(' ');
}

/**
 * Agrupa llamadas seguidas en una sola, `ms` después de la última. Se usa en
 * las búsquedas en vivo: sin esto, cada tecla dispararía una consulta.
 * La función devuelta expone `.cancel()` para descartar una ejecución
 * pendiente (por ejemplo, al cerrar el campo antes de que dispare).
 */
export function debounce(fn, ms = 250) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}
