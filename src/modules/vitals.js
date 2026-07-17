import { state } from '../state.js';
import * as api from '../lib/api.js';
import { showModal, closeModal, showToast, setModalMaxWidth } from '../lib/modal.js';
import { esc, fmtDate, today } from '../lib/utils.js';
import { emptyStateHtml, errorStateHtml } from '../lib/emptyState.js';
import { Icons } from '../lib/icons.js';

const VITAL_FIELDS = [
  { key: 'peso', label: 'Peso', unit: 'kg', color: '#14b8a6', low: 40, high: 150 },
  { key: 'presion', label: 'Presión', unit: 'mmHg', color: '#ef4444', low: null, high: null },
  { key: 'glucosa', label: 'Glucosa', unit: 'mg/dL', color: '#f59e0b', low: 70, high: 140 },
  { key: 'saturacion', label: 'Saturación O₂', unit: '%', color: '#3b82f6', low: 95, high: 100 },
  { key: 'temperatura', label: 'Temperatura', unit: '°C', color: '#f97316', low: 36, high: 37.5 },
  { key: 'frecCardiaca', label: 'Frec. cardíaca', unit: 'bpm', color: '#ec4899', low: 60, high: 100 },
  { key: 'perCintura', label: 'P. cintura', unit: 'cm', color: '#8b5cf6', low: null, high: null },
  { key: 'perCadera', label: 'P. cadera', unit: 'cm', color: '#22c55e', low: null, high: null },
];

let vActiveField = 'peso';
let pendingOptions = null;
export function setPendingOptions(opts) { pendingOptions = opts; }

function getVitalValue(rec, key) {
  if (key === 'presion') return rec.presionSis && rec.presionDia ? rec.presionSis + '/' + rec.presionDia : null;
  return rec[key] != null && rec[key] !== '' ? rec[key] : null;
}
function getVitalNumeric(rec, key) {
  if (key === 'presion') return rec.presionSis ? parseFloat(rec.presionSis) : null;
  const v = rec[key];
  return v != null && v !== '' ? parseFloat(v) : null;
}
function trendArrow(current, previous) {
  if (previous == null || current == null) return { cls: 'same', arrow: '→', delta: '' };
  const diff = current - previous;
  if (Math.abs(diff) < 0.01) return { cls: 'same', arrow: '→', delta: '±0' };
  return diff > 0 ? { cls: 'up', arrow: '↑', delta: '+' + diff.toFixed(1) } : { cls: 'down', arrow: '↓', delta: diff.toFixed(1) };
}

export async function render() {
  const container = document.getElementById('view-vitals');
  if (!container) return;

  container.innerHTML = `
    <div class="view-header">
      <div>
        <div class="view-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> Signos vitales</div>
        <div class="view-sub">Registros periódicos y evolución gráfica</div>
      </div>
      <button class="btn btn-primary" id="btn-new-vital"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Nuevo registro</button>
    </div>
    <div id="vitals-kpi" class="vitals-kpi"></div>
    <div id="vitals-tabs" class="vitals-tabs"></div>
    <div id="vitals-chart-card" class="vitals-chart-card" style="display:none">
      <div class="vchart-header"><div class="vchart-title" id="vchart-title">Evolución</div><div class="vchart-meta" id="vchart-meta"></div></div>
      <canvas id="vitals-canvas" class="no-tr" height="220"></canvas>
      <div class="vchart-footer" id="vchart-footer"></div>
    </div>
    <div id="vitals-table-section" style="display:none">
      <div class="card">
        <div class="card-hd"><h2>Historial de registros</h2><span class="card-meta" id="vitals-hist-meta"></span></div>
        <div id="vitals-table-body" style="overflow-x:auto"></div>
      </div>
    </div>
    <div id="vitals-empty" style="display:none"></div>
  `;
  document.getElementById('btn-new-vital').addEventListener('click', () => openVitalModal());

  const emptyEl = document.getElementById('vitals-empty');

  if (!state.activePatient) {
    emptyEl.innerHTML = emptyStateHtml({ icon: Icons.users, title: 'Selecciona un paciente' });
    emptyEl.style.display = 'flex';
    return;
  }

  let records;
  try {
    records = (await api.listVitalsByPatient(state.activePatient.id)).sort((a, b) => a.fecha.localeCompare(b.fecha));
  } catch (err) {
    showToast(err.message || 'No se pudieron cargar los signos vitales', 'err');
    emptyEl.innerHTML = errorStateHtml({ retryId: 'btn-retry-vitals' });
    emptyEl.style.display = 'flex';
    document.getElementById('btn-retry-vitals').addEventListener('click', () => render());
    return;
  }

  if (!records.length) {
    emptyEl.innerHTML = emptyStateHtml({
      title: 'Sin registros aún',
      message: 'Comienza registrando los signos vitales del paciente para ver su evolución.',
      action: { id: 'btn-first-vital', label: 'Primer registro' },
    });
    emptyEl.style.display = 'flex';
    document.getElementById('btn-first-vital').addEventListener('click', () => openVitalModal());
    if (pendingOptions?.openModal) { pendingOptions = null; openVitalModal(); }
    return;
  }
  document.getElementById('vitals-chart-card').style.display = 'block';
  document.getElementById('vitals-table-section').style.display = 'block';

  const last = records[records.length - 1];
  const prev = records.length > 1 ? records[records.length - 2] : null;

  document.getElementById('vitals-kpi').innerHTML = VITAL_FIELDS.map(f => {
    const val = getVitalValue(last, f.key);
    const num = getVitalNumeric(last, f.key);
    const prevNum = prev ? getVitalNumeric(prev, f.key) : null;
    const trend = trendArrow(num, prevNum);
    const active = vActiveField === f.key ? 'active' : '';
    return `<div class="vkpi ${active}" style="--vkpi-color:${f.color}" data-select-field="${f.key}">
      <div class="vkpi-label">${f.label}</div>
      <div class="vkpi-value">${val != null ? val : '—'}</div>
      <div class="vkpi-unit">${val != null ? f.unit : 'sin datos'}</div>
      ${num != null && prevNum != null ? `<div class="vkpi-trend ${trend.cls}">${trend.arrow} ${trend.delta} ${f.unit}</div>` : ''}
    </div>`;
  }).join('');

  document.getElementById('vitals-tabs').innerHTML = VITAL_FIELDS.map(f => {
    const hasData = records.some(r => getVitalNumeric(r, f.key) != null);
    return `<div class="vtab ${vActiveField === f.key ? 'active' : ''}" style="${vActiveField === f.key ? 'background:' + f.color + ';border-color:' + f.color : ''};${!hasData ? 'opacity:.5' : ''}" data-select-field="${f.key}">
      <span class="vtab-dot" style="background:${f.color}"></span>${f.label}
    </div>`;
  }).join('');

  document.querySelectorAll('[data-select-field]').forEach(el =>
    el.addEventListener('click', () => { vActiveField = el.dataset.selectField; render(); }));

  renderVitalsChart(records);
  renderVitalsTable(records);

  if (pendingOptions?.openModal) { pendingOptions = null; openVitalModal(); }
}

function renderVitalsChart(records) {
  const field = VITAL_FIELDS.find(f => f.key === vActiveField);
  if (!field) return;

  const pts = records.map(r => ({ x: r.fecha, y: getVitalNumeric(r, vActiveField) })).filter(p => p.y != null);

  document.getElementById('vchart-title').textContent = field.label;
  document.getElementById('vchart-meta').textContent = pts.length + ' registro' + (pts.length !== 1 ? 's' : '');

  const canvas = document.getElementById('vitals-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.offsetWidth || 700;
  const H = 220;
  canvas.width = W * devicePixelRatio;
  canvas.height = H * devicePixelRatio;
  canvas.style.height = H + 'px';
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(devicePixelRatio, devicePixelRatio);

  const PAD = { top: 20, right: 24, bottom: 44, left: 52 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;

  ctx.clearRect(0, 0, W, H);

  if (!pts.length) {
    ctx.fillStyle = '#6b84a8';
    ctx.font = '13px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Sin datos para esta variable', W / 2, H / 2);
    document.getElementById('vchart-footer').innerHTML = '';
    return;
  }

  const vals = pts.map(p => p.y);
  let minY = Math.min(...vals);
  let maxY = Math.max(...vals);
  const padding = (maxY - minY) * .2 || 5;
  minY -= padding; maxY += padding;
  const rangeY = maxY - minY || 1;
  const xStep = pts.length > 1 ? cW / (pts.length - 1) : cW / 2;
  const toX = i => PAD.left + (pts.length > 1 ? i * xStep : cW / 2);
  const toY = v => PAD.top + cH - ((v - minY) / rangeY) * cH;

  if (field.low != null) {
    ctx.fillStyle = 'rgba(34,197,94,.06)';
    const bandTop = toY(field.high);
    const bandBot = toY(field.low);
    ctx.fillRect(PAD.left, bandTop, cW, bandBot - bandTop);
  }

  const gridCount = 5;
  ctx.strokeStyle = 'rgba(255,255,255,.05)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= gridCount; i++) {
    const y = PAD.top + (cH / gridCount) * i;
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke();
    const label = (maxY - (rangeY / gridCount) * i).toFixed(1).replace('.0', '');
    ctx.fillStyle = '#344a6b';
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(label, PAD.left - 6, y + 4);
  }

  const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + cH);
  grad.addColorStop(0, field.color + '40');
  grad.addColorStop(1, field.color + '00');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(toX(0), toY(pts[0].y));
  pts.forEach((p, i) => {
    if (i === 0) return;
    const px = toX(i - 1), py = toY(pts[i - 1].y);
    ctx.bezierCurveTo(px + xStep * .4, py, toX(i) - xStep * .4, toY(p.y), toX(i), toY(p.y));
  });
  ctx.lineTo(toX(pts.length - 1), PAD.top + cH);
  ctx.lineTo(toX(0), PAD.top + cH);
  ctx.closePath(); ctx.fill();

  ctx.strokeStyle = field.color;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(toX(0), toY(pts[0].y));
  pts.forEach((p, i) => {
    if (i === 0) return;
    const px = toX(i - 1), py = toY(pts[i - 1].y);
    ctx.bezierCurveTo(px + xStep * .4, py, toX(i) - xStep * .4, toY(p.y), toX(i), toY(p.y));
  });
  ctx.stroke();

  pts.forEach((p, i) => {
    const x = toX(i), y = toY(p.y);
    ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fillStyle = field.color + '25'; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fillStyle = field.color; ctx.fill();
    ctx.strokeStyle = '#0c0f14'; ctx.lineWidth = 2; ctx.stroke();
    const d = p.x.split('-');
    ctx.fillStyle = '#344a6b'; ctx.font = '10px Inter, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(d[2] + '/' + d[1], x, PAD.top + cH + 18);
    ctx.fillStyle = field.color; ctx.font = '700 11px JetBrains Mono, monospace';
    ctx.fillText(p.y, x, y - 12);
  });

  const avg = (vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(1);
  const min = Math.min(...vals).toFixed(1);
  const max = Math.max(...vals).toFixed(1);
  document.getElementById('vchart-footer').innerHTML = [
    ['Último', vals[vals.length - 1].toFixed(1) + ' ' + field.unit],
    ['Promedio', avg + ' ' + field.unit],
    ['Mínimo', min + ' ' + field.unit],
    ['Máximo', max + ' ' + field.unit],
    ['Registros', pts.length],
  ].map(([l, v]) => `<div class="vcf-stat"><div class="vcf-label">${l}</div><div class="vcf-val">${v}</div></div>`).join('');
}

function renderVitalsTable(records) {
  const sorted = [...records].reverse();
  document.getElementById('vitals-hist-meta').textContent = sorted.length + ' registro' + (sorted.length !== 1 ? 's' : '');

  const COLS = [
    { key: 'fecha', label: 'Fecha', fmt: v => fmtDate(v) },
    { key: 'peso', label: 'Peso (kg)', fmt: v => v || '—' },
    { key: 'presion', label: 'Presión (mmHg)', fmt: (v, r) => r.presionSis && r.presionDia ? r.presionSis + '/' + r.presionDia : '—' },
    { key: 'glucosa', label: 'Glucosa (mg/dL)', fmt: v => v || '—' },
    { key: 'saturacion', label: 'SpO₂ (%)', fmt: v => v || '—' },
    { key: 'temperatura', label: 'Temp (°C)', fmt: v => v || '—' },
    { key: 'frecCardiaca', label: 'F.C. (bpm)', fmt: v => v || '—' },
  ];

  const thead = '<tr>' + COLS.map(c => `<th>${c.label}</th>`).join('') + '<th style="text-align:right">Acciones</th></tr>';
  const tbody = sorted.map(r => {
    const cells = COLS.map((c, i) => `<td class="${i === 0 ? 'vt-date' : 'vt-val'}">${c.fmt(r[c.key], r)}</td>`).join('');
    return `<tr>${cells}<td class="vt-actions">
      <button class="btn btn-sm btn-icon btn-ghost" data-edit-vital="${r.id}" title="Editar"><svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5"/></svg></button>
      <button class="btn btn-sm btn-icon btn-danger" data-delete-vital="${r.id}" title="Eliminar"><svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862"/></svg></button>
    </td></tr>`;
  }).join('');

  document.getElementById('vitals-table-body').innerHTML = `<table class="vitals-table"><thead>${thead}</thead><tbody>${tbody}</tbody></table>`;
  document.querySelectorAll('[data-edit-vital]').forEach(b => b.addEventListener('click', () => openVitalModal(b.dataset.editVital)));
  document.querySelectorAll('[data-delete-vital]').forEach(b => b.addEventListener('click', () => deleteVitalConfirm(b.dataset.deleteVital)));
}

async function openVitalModal(id) {
  let r = null;
  if (id) {
    try {
      r = (await api.listVitalsByPatient(state.activePatient.id)).find(v => v.id === id);
    } catch (err) {
      showToast(err.message || 'No se pudo abrir el registro', 'err');
      return;
    }
  }

  showModal(
    id ? 'Editar registro de signos vitales' : 'Nuevo registro de signos vitales',
    `<div class="form-body">
      <div class="vital-form-section">
        <div class="vital-form-section-title">General</div>
        <div class="form-row cols-2">
          <div class="form-field"><label class="fl">Fecha *</label><input class="fi" id="vf-fecha" type="date" value="${r?.fecha || today()}"/></div>
          <div class="form-field"><label class="fl">Edad (en esta fecha)</label><input class="fi" id="vf-edad" type="number" min="0" max="120" placeholder="años" value="${r?.edad || ''}"/></div>
        </div>
      </div>
      <div class="vital-form-section">
        <div class="vital-form-section-title">Antropometría</div>
        <div class="form-row cols-2">
          <div class="form-field"><label class="fl">Peso (kg)</label><input class="fi" id="vf-peso" type="number" step="0.1" min="1" placeholder="Ej: 68.5" value="${r?.peso || ''}"/></div>
          <div class="form-field"><label class="fl">Altura (cm)</label><input class="fi" id="vf-altura" type="number" step="0.1" min="1" placeholder="Ej: 170" value="${r?.altura || ''}"/></div>
          <div class="form-field"><label class="fl">Perímetro cintura (cm)</label><input class="fi" id="vf-cintura" type="number" step="0.1" placeholder="cm" value="${r?.perCintura || ''}"/></div>
          <div class="form-field"><label class="fl">Perímetro cadera (cm)</label><input class="fi" id="vf-cadera" type="number" step="0.1" placeholder="cm" value="${r?.perCadera || ''}"/></div>
          <div class="form-field"><label class="fl">Perímetro brazo (cm)</label><input class="fi" id="vf-brazo" type="number" step="0.1" placeholder="cm" value="${r?.perBrazo || ''}"/></div>
        </div>
      </div>
      <div class="vital-form-section">
        <div class="vital-form-section-title">Signos vitales</div>
        <div class="form-row cols-2">
          <div class="form-field"><label class="fl">Presión sistólica (mmHg)</label><input class="fi" id="vf-sis" type="number" min="60" max="250" placeholder="Ej: 120" value="${r?.presionSis || ''}"/></div>
          <div class="form-field"><label class="fl">Presión diastólica (mmHg)</label><input class="fi" id="vf-dia" type="number" min="40" max="150" placeholder="Ej: 80" value="${r?.presionDia || ''}"/></div>
          <div class="form-field"><label class="fl">Temperatura (°C)</label><input class="fi" id="vf-temp" type="number" step="0.1" min="34" max="42" placeholder="Ej: 36.6" value="${r?.temperatura || ''}"/></div>
          <div class="form-field"><label class="fl">Saturación O₂ (%)</label><input class="fi" id="vf-spo2" type="number" min="70" max="100" placeholder="Ej: 97" value="${r?.saturacion || ''}"/></div>
          <div class="form-field"><label class="fl">Glucosa (mg/dL)</label><input class="fi" id="vf-gluc" type="number" min="30" max="600" placeholder="Ej: 95" value="${r?.glucosa || ''}"/></div>
          <div class="form-field"><label class="fl">Frec. cardíaca (bpm)</label><input class="fi" id="vf-fc" type="number" min="30" max="250" placeholder="Ej: 72" value="${r?.frecCardiaca || ''}"/></div>
        </div>
      </div>
      <div class="vital-form-section" style="margin-bottom:0">
        <div class="vital-form-section-title">Notas</div>
        <div class="form-field"><textarea class="fi" id="vf-notas" rows="2" placeholder="Observaciones del médico, condiciones especiales…">${r?.notas || ''}</textarea></div>
      </div>
    </div>`,
    [
      { label: 'Cancelar', cls: 'btn', action: closeModal },
      { label: id ? 'Guardar cambios' : 'Guardar registro', cls: 'btn btn-primary', action: () => saveVitalForm(id) },
    ]
  );
  setModalMaxWidth('620px');
}

async function saveVitalForm(editId) {
  if (!state.activePatient) return;
  const fecha = document.getElementById('vf-fecha').value;
  if (!fecha) { showToast('La fecha es obligatoria', 'err'); return; }

  const obj = {
    id: editId || undefined,
    fecha,
    edad: document.getElementById('vf-edad').value || null,
    peso: document.getElementById('vf-peso').value || null,
    altura: document.getElementById('vf-altura').value || null,
    perCintura: document.getElementById('vf-cintura').value || null,
    perCadera: document.getElementById('vf-cadera').value || null,
    perBrazo: document.getElementById('vf-brazo').value || null,
    presionSis: document.getElementById('vf-sis').value || null,
    presionDia: document.getElementById('vf-dia').value || null,
    temperatura: document.getElementById('vf-temp').value || null,
    saturacion: document.getElementById('vf-spo2').value || null,
    glucosa: document.getElementById('vf-gluc').value || null,
    frecCardiaca: document.getElementById('vf-fc').value || null,
    notas: document.getElementById('vf-notas').value.trim(),
  };

  try {
    await api.saveVital(obj, state.household.id, state.activePatient.id);
    closeModal();
    showToast(editId ? 'Registro actualizado' : 'Registro guardado');
    render();
  } catch (err) {
    showToast(err.message || 'Error al guardar el registro', 'err');
  }
}

async function deleteVitalConfirm(id) {
  if (!confirm('¿Eliminar este registro de signos vitales?')) return;
  try {
    await api.deleteVital(id);
    showToast('Registro eliminado', 'warn');
    render();
  } catch (err) {
    showToast(err.message || 'Error al eliminar el registro', 'err');
  }
}
