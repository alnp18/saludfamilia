import { calcAgeDecimal } from './utils.js';

/* FNV1a hash 32-bit — rápido y determinista */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h;
}

function saturationFromAge(age) {
  const a = Math.max(0, Math.min(age, 100));
  const S_max = 72;
  const raw = S_max * Math.pow(Math.sin(Math.PI * a / 100), 0.58);
  return Math.max(14, Math.round(raw));
}

function luminosityFromAge(age) {
  const a = Math.max(0, Math.min(age, 100));
  const base = 42;
  const youthBoost = 18 * (1 - Math.pow(Math.sin(Math.PI * a / 100), 0.4));
  return Math.round(base + youthBoost);
}

function warmthShift(age) {
  return -Math.round(5 * Math.pow(age / 100, 2));
}

function hueRangeForSex(sexo) {
  const s = (sexo || '').toLowerCase();
  if (s === 'femenino') return { ranges: [[0, 42], [330, 360]] };
  if (s === 'masculino') return { ranges: [[185, 265]] };
  return { ranges: [[90, 175]] };
}

function pickHue(hueSpec, hash) {
  const ranges = hueSpec.ranges;
  const rangeIdx = (hash % ranges.length + ranges.length) % ranges.length;
  const [lo, hi] = ranges[rangeIdx];
  const pos = ((hash >>> 7) % 1000) / 1000;
  return Math.round(lo + pos * (hi - lo));
}

function accentHue(primaryHue, hash) {
  const spin = 120 + ((hash >>> 12) % 60);
  return (primaryHue + spin) % 360;
}

function ensureContrast(l_text, l_bg, min_ratio = 4.5) {
  function relativeLum(l) {
    const sRGB = l / 100;
    return sRGB <= 0.03928 ? sRGB / 12.92 : Math.pow((sRGB + 0.055) / 1.055, 2.4);
  }
  const L1 = relativeLum(l_text);
  const L2 = relativeLum(l_bg);
  const bright = Math.max(L1, L2);
  const dark = Math.min(L1, L2);
  const ratio = (bright + 0.05) / (dark + 0.05);
  if (ratio >= min_ratio) return l_text;
  return Math.min(95, l_text + Math.round((min_ratio - ratio) * 8));
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return '#' + f(0) + f(8) + f(4);
}

function hsla(h, s, l, a) {
  return `hsla(${h},${s}%,${l}%,${a})`;
}

function describeTheme(hue, sat) {
  const colorName = (() => {
    if (hue < 15 || hue >= 345) return 'Rojo coral';
    if (hue < 35) return 'Terracota';
    if (hue < 55) return 'Durazno';
    if (hue < 75) return 'Ámbar cálido';
    if (hue < 105) return 'Verde olivo';
    if (hue < 145) return 'Verde bosque';
    if (hue < 175) return 'Verde azulado';
    if (hue < 200) return 'Cian';
    if (hue < 230) return 'Azul océano';
    if (hue < 260) return 'Azul índigo';
    if (hue < 285) return 'Violeta';
    if (hue < 315) return 'Magenta';
    return 'Rosa frambuesa';
  })();
  const intensity = sat < 25 ? 'pastel suave' : sat < 42 ? 'apagado' : sat < 58 ? 'equilibrado' : sat < 70 ? 'vivo' : 'intenso';
  return `${colorName} ${intensity}`;
}

/** Genera la especificación de tema para un paciente. Determinista: mismo id → mismo tema. */
export function generate(paciente) {
  if (!paciente) return null;

  const id = paciente.id || 'default';
  const sexo = paciente.sexo || '';
  const dob = paciente.fechaNacimiento || '';
  const age = calcAgeDecimal(dob);
  const mode = paciente._lightMode ? 'day' : 'night';

  const hash = fnv1a(id);

  const sat = saturationFromAge(age);
  const lum = luminosityFromAge(age);
  const wShift = warmthShift(age);

  const hueSpec = hueRangeForSex(sexo);
  const hueBase = pickHue(hueSpec, hash);
  const hueFinal = ((hueBase + wShift) % 360 + 360) % 360;

  const hueShift2 = ((hash >>> 3) % 17) - 8;
  const satShift = ((hash >>> 6) % 13) - 6;
  const lumShift = ((hash >>> 9) % 9) - 4;
  const hPrimary = ((hueFinal + hueShift2) % 360 + 360) % 360;
  const sPrimary = Math.max(20, Math.min(85, sat + satShift));
  const lPrimary = Math.max(32, Math.min(68, lum + lumShift));

  const hAccent = accentHue(hPrimary, hash);
  const sAccent = Math.max(30, Math.min(80, sPrimary - 8 + ((hash >>> 14) % 16)));
  const lAccent = Math.max(40, Math.min(72, lPrimary + ((hash >>> 17) % 12)));

  const lBg = mode === 'night' ? 7 : 11;
  const lTextPrimary = ensureContrast(lPrimary, lBg);

  const primary = hslToHex(hPrimary, sPrimary, lTextPrimary);
  const primaryLt = hslToHex(hPrimary, sPrimary, Math.min(lTextPrimary + 14, 88));
  const primaryDk = hslToHex(hPrimary, sPrimary, Math.max(lTextPrimary - 10, 22));
  const accent = hslToHex(hAccent, sAccent, lAccent);
  const accentLt = hslToHex(hAccent, sAccent, Math.min(lAccent + 12, 85));

  const sN = Math.max(22, Math.round(sPrimary * 0.52));
  const nightBg = hslToHex(hPrimary, sN, 10);
  const nightSurface = hslToHex(hPrimary, sN, 14);
  const nightCard = hslToHex(hPrimary, sN, 18);
  const nightCard2 = hslToHex(hPrimary, sN, 22);
  const nightHover = hslToHex(hPrimary, sN, 26);
  const nightBorder = hslToHex(hPrimary, Math.round(sN * 0.85), 30);
  const nightBorderLt = hslToHex(hPrimary, Math.round(sN * 0.90), 38);

  const gradEnd = hslToHex(hPrimary, Math.max(sPrimary - 12, 15), Math.max(lTextPrimary - 14, 20));
  const gradient = `linear-gradient(135deg, ${primary} 0%, ${gradEnd} 100%)`;

  const shadow = hsla(hPrimary, sPrimary, 30, 0.28);
  const border = hsla(hPrimary, sPrimary, 50, 0.18);
  const primaryDim = hsla(hPrimary, sPrimary, 50, 0.13);
  const primaryGlow = hsla(hPrimary, sPrimary, 50, 0.22);
  const accentDim = hsla(hAccent, sAccent, 50, 0.13);

  return {
    '--theme-primary': primary,
    '--theme-primary-lt': primaryLt,
    '--theme-primary-dk': primaryDk,
    '--theme-primary-dim': primaryDim,
    '--theme-primary-glow': primaryGlow,
    '--theme-accent': accent,
    '--theme-accent-lt': accentLt,
    '--theme-accent-dim': accentDim,
    '--theme-gradient': gradient,
    '--theme-shadow': shadow,
    '--theme-border': border,
    '--theme-night-bg': nightBg,
    '--theme-night-surface': nightSurface,
    '--theme-night-card': nightCard,
    '--theme-night-card2': nightCard2,
    '--theme-night-hover': nightHover,
    '--theme-night-border': nightBorder,
    '--theme-night-blt': nightBorderLt,
    _primary: primary, _primaryLt: primaryLt,
    _accent: accent, _accentLt: accentLt,
    _gradient: gradient,
    _label: describeTheme(hPrimary, sPrimary),
  };
}

export function apply(spec, lightMode = false) {
  const root = document.documentElement;
  if (!spec) { reset(); return; }

  Object.entries(spec).forEach(([k, v]) => {
    if (k.startsWith('--')) root.style.setProperty(k, v);
  });

  root.style.setProperty('--t-primary', spec['--theme-primary']);
  root.style.setProperty('--t-primary-lt', spec['--theme-primary-lt']);
  root.style.setProperty('--t-primary-dim', spec['--theme-primary-dim']);
  root.style.setProperty('--t-primary-glow', spec['--theme-primary-glow']);
  root.style.setProperty('--t-accent', spec['--theme-accent']);
  root.style.setProperty('--t-accent-lt', spec['--theme-accent-lt']);
  root.style.setProperty('--t-accent-dim', spec['--theme-accent-dim']);
  root.style.setProperty('--t-gradient', spec['--theme-gradient']);
  root.style.setProperty('--t-shadow', spec['--theme-shadow']);
  root.style.setProperty('--t-border', spec['--theme-border']);

  document.body.classList.toggle('light-mode', lightMode);
  document.body.classList.add('patient-themed');

  if (!lightMode) {
    root.style.setProperty('--bg', spec['--theme-night-bg']);
    root.style.setProperty('--surface', spec['--theme-night-surface']);
    root.style.setProperty('--card', spec['--theme-night-card']);
    root.style.setProperty('--card2', spec['--theme-night-card2']);
    root.style.setProperty('--hover', spec['--theme-night-hover']);
    root.style.setProperty('--border', spec['--theme-night-border']);
    root.style.setProperty('--border-lt', spec['--theme-night-blt']);
  } else {
    ['--bg', '--surface', '--card', '--card2', '--hover', '--border', '--border-lt']
      .forEach(k => root.style.removeProperty(k));
  }
}

export function reset() {
  const root = document.documentElement;
  [
    '--theme-primary', '--theme-primary-lt', '--theme-primary-dk',
    '--theme-primary-dim', '--theme-primary-glow',
    '--theme-accent', '--theme-accent-lt', '--theme-accent-dim',
    '--theme-gradient', '--theme-shadow', '--theme-border',
    '--theme-night-bg', '--theme-night-surface', '--theme-night-card',
    '--theme-night-card2', '--theme-night-hover', '--theme-night-border', '--theme-night-blt',
    '--t-primary', '--t-primary-lt', '--t-primary-dim', '--t-primary-glow',
    '--t-accent', '--t-accent-lt', '--t-accent-dim', '--t-gradient', '--t-shadow', '--t-border',
    '--bg', '--surface', '--card', '--card2', '--hover', '--border', '--border-lt',
  ].forEach(k => root.style.removeProperty(k));
  document.body.classList.remove('patient-themed', 'light-mode');
}

export const ThemeEngine = { generate, apply, reset, hslToHex, fnv1a };
