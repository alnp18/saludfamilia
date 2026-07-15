import { state } from '../state.js';
import * as api from '../lib/api.js';
import * as xport from '../lib/exportImport.js';
import { showModal, closeModal, showToast } from '../lib/modal.js';
import { esc, avatarColor, fmtDate } from '../lib/utils.js';

/**
 * Vista Familia: quiénes comparten este household, invitaciones (solo el
 * owner) y canje de código para unirse a otra familia. Las reglas duras
 * (solo owner invita/saca, canje bloqueado si hay datos, un solo uso,
 * caducidad) viven en la base — la UI solo las refleja.
 */

const USERS_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>';

export async function render() {
  const container = document.getElementById('view-family');
  if (!container) return;

  container.innerHTML = `
    <div class="view-header">
      <div>
        <div class="view-title">${USERS_ICON} Familia</div>
        <div class="view-sub">Quiénes comparten la información de "${esc(state.household.name)}"</div>
      </div>
    </div>
    <div id="family-content" style="display:flex;flex-direction:column;gap:14px"></div>
  `;

  const el = document.getElementById('family-content');
  let members;
  try {
    members = await api.listHouseholdMembers(state.household.id);
  } catch (err) {
    showToast(err.message || 'Error al cargar los miembros', 'err');
    return;
  }

  const me = members.find(m => m.userId === state.user.id);
  const isOwner = me?.role === 'owner';

  el.innerHTML = `
    <div class="card">
      <div class="card-hd"><h2>Miembros</h2><span class="card-meta">${members.length} ${members.length === 1 ? 'persona' : 'personas'}</span></div>
      <div>
        ${members.map(m => `
          <div class="fam-member">
            <div class="fam-avatar" style="background:${avatarColor(m.email)}">${esc((m.email || '?')[0].toUpperCase())}</div>
            <div class="fam-info">
              <div class="fam-email">${esc(m.email)}${m.userId === state.user.id ? ' <span class="tag tag-teal">Tú</span>' : ''}</div>
              <div class="fam-meta">${m.role === 'owner' ? 'Administra la familia' : 'Miembro'} · desde ${fmtDate((m.joinedAt || '').slice(0, 10))}</div>
            </div>
            ${isOwner && m.userId !== state.user.id
              ? `<button class="btn btn-sm btn-danger" data-remove-id="${m.userId}">Sacar</button>` : ''}
            ${!isOwner && m.userId === state.user.id
              ? `<button class="btn btn-sm btn-danger" id="btn-leave-family">Salir de la familia</button>` : ''}
          </div>`).join('')}
      </div>
    </div>
    ${isOwner ? `
    <div class="card">
      <div class="card-hd">
        <h2>Invitaciones</h2>
        <button class="btn btn-sm btn-primary" id="btn-new-invite" style="margin-left:auto">Generar código</button>
      </div>
      <div id="family-invites"></div>
    </div>` : ''}
    <div class="card">
      <div class="card-hd"><h2>Unirse a otra familia</h2></div>
      <div class="fam-join">
        <p class="fam-join-help">Si alguien te compartió un código de invitación, canjealo acá. Solo es posible si tu familia actual no tiene información registrada ni otros miembros.</p>
        <div class="fam-join-row">
          <input class="fi" id="join-code" type="text" placeholder="XXXX-XXXX-XXXX" autocomplete="off" spellcheck="false"/>
          <button class="btn btn-primary" id="btn-join-family">Unirme</button>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-hd"><h2>Exportar / Importar información</h2></div>
      <div class="fam-join">
        <p class="fam-join-help">Exportá pacientes con toda su historia (órdenes, medicamentos, signos vitales y los médicos y centros que referencian) a un archivo cifrado que se descarga a tu dispositivo, e importalo en otra familia. El archivo se protege con una contraseña propia — sin ella no puede abrirse.</p>
        <div class="fam-join-row">
          <button class="btn" id="btn-export-info">Exportar información</button>
          <button class="btn" id="btn-import-info">Importar información</button>
        </div>
      </div>
    </div>
  `;

  el.querySelectorAll('[data-remove-id]').forEach(b =>
    b.addEventListener('click', () => removeMemberConfirm(b.dataset.removeId, members)));
  document.getElementById('btn-leave-family')?.addEventListener('click', leaveFamilyConfirm);
  document.getElementById('btn-new-invite')?.addEventListener('click', generateInvite);
  document.getElementById('btn-join-family').addEventListener('click', joinFamily);
  document.getElementById('join-code').addEventListener('keydown', e => {
    if (e.key === 'Enter') joinFamily();
  });
  document.getElementById('btn-export-info').addEventListener('click', openExportModal);
  document.getElementById('btn-import-info').addEventListener('click', openImportModal);

  if (isOwner) await renderInvites(members);
}

async function renderInvites(members) {
  const el = document.getElementById('family-invites');
  if (!el) return;

  let invites;
  try {
    invites = await api.listInvitations(state.household.id);
  } catch (err) {
    el.innerHTML = `<div class="fam-invites-empty">No se pudieron cargar las invitaciones.</div>`;
    return;
  }

  if (!invites.length) {
    el.innerHTML = `<div class="fam-invites-empty">Sin invitaciones. Generá un código y compartilo con quien quieras sumar — vale por 7 días y un solo uso.</div>`;
    return;
  }

  const emailOf = id => members.find(m => m.userId === id)?.email;
  const now = Date.now();

  el.innerHTML = invites.map(inv => {
    const expired = !inv.usedAt && new Date(inv.expiresAt).getTime() < now;
    const status = inv.usedAt
      ? `<span class="tag tag-green">Usada</span> por ${esc(emailOf(inv.usedBy) || 'un usuario que ya no está')} el ${fmtDate(inv.usedAt.slice(0, 10))}`
      : expired
        ? `<span class="tag tag-amber">Vencida</span> el ${fmtDate(inv.expiresAt.slice(0, 10))}`
        : `<span class="tag tag-teal">Pendiente</span> vence el ${fmtDate(inv.expiresAt.slice(0, 10))}`;
    return `
      <div class="fam-invite">
        <div class="fam-info">
          <div class="fam-meta">Creada el ${fmtDate(inv.createdAt.slice(0, 10))} · ${status}</div>
        </div>
        ${!inv.usedAt ? `<button class="btn btn-sm btn-ghost" data-revoke-id="${inv.id}">${expired ? 'Eliminar' : 'Revocar'}</button>` : ''}
      </div>`;
  }).join('');

  el.querySelectorAll('[data-revoke-id]').forEach(b =>
    b.addEventListener('click', async () => {
      try {
        await api.revokeInvitation(b.dataset.revokeId);
        showToast('Invitación revocada', 'warn');
        render();
      } catch (err) {
        showToast(err.message || 'Error al revocar', 'err');
      }
    }));
}

async function generateInvite() {
  const btn = document.getElementById('btn-new-invite');
  btn.disabled = true;
  let code;
  try {
    code = await api.createInvitation(state.household.id);
  } catch (err) {
    showToast(err.message || 'Error al generar el código', 'err');
    btn.disabled = false;
    return;
  }
  btn.disabled = false;

  // El código solo existe en claro en este momento: en la base queda
  // únicamente su hash. Si se pierde, se genera otro.
  showModal(
    'Código de invitación',
    `<div class="form-body" style="text-align:center">
      <div class="fam-code" id="invite-code-box">${esc(code)}</div>
      <p class="fam-join-help" style="margin-top:12px">
        Compartí este código con la persona que querés sumar. Vale por 7 días
        y un solo uso, y no se puede volver a consultar: si se pierde,
        simplemente generá otro. La persona debe crear su cuenta (o iniciar
        sesión) y canjearlo en Familia → "Unirse a otra familia".
      </p>
    </div>`,
    [
      { label: 'Copiar código', cls: 'btn btn-primary', action: () => copyInviteCode(code) },
      { label: 'Listo', cls: 'btn', action: () => { closeModal(); render(); } },
    ]
  );
}

async function copyInviteCode(code) {
  try {
    await navigator.clipboard.writeText(code);
    showToast('Código copiado');
  } catch {
    // Sin permiso de portapapeles (o contexto no seguro): queda visible
    // en el modal para copiarlo a mano.
    showToast('No se pudo copiar automáticamente — copialo del recuadro', 'warn');
  }
}

async function joinFamily() {
  const input = document.getElementById('join-code');
  const code = input.value.trim();
  if (!code) { showToast('Ingresá el código de invitación', 'err'); return; }

  const btn = document.getElementById('btn-join-family');
  btn.disabled = true;

  // El canje exige una familia vacía (regla de la base). Si hay datos, en
  // vez de dejar que falle, ofrecer exportarlos primero.
  try {
    const [patients, doctors, centers] = await Promise.all([
      api.listPatients(state.household.id),
      api.listDoctors(state.household.id),
      api.listCenters(state.household.id),
    ]);
    if (patients.length || doctors.length || centers.length) {
      btn.disabled = false;
      offerExportBeforeJoin(patients.length, doctors.length, centers.length);
      return;
    }
  } catch {
    // Si el chequeo falla, se intenta el canje igual: la base decide.
  }

  try {
    const res = await api.redeemInvitation(code);
    showToast(`Ahora eres parte de "${res.householdName}"`);
    // El household activo cambió: rearrancar la app sobre el nuevo.
    setTimeout(() => window.location.reload(), 900);
  } catch (err) {
    showToast(err.message || 'No se pudo canjear el código', 'err');
    btn.disabled = false;
  }
}

function offerExportBeforeJoin(nPatients, nDoctors, nCenters) {
  const parts = [];
  if (nPatients) parts.push(`${nPatients} paciente${nPatients > 1 ? 's' : ''}`);
  if (nDoctors) parts.push(`${nDoctors} médico${nDoctors > 1 ? 's' : ''}`);
  if (nCenters) parts.push(`${nCenters} centro${nCenters > 1 ? 's' : ''} médico${nCenters > 1 ? 's' : ''}`);

  showModal(
    'Tu familia actual tiene información',
    `<div class="form-body">
      <p class="fam-join-help">Tu familia registra ${esc(parts.join(', '))}. Para unirte a otra familia, la tuya debe quedar vacía — así ningún dato se pierde por accidente.</p>
      <p class="fam-join-help"><strong>¿Deseás exportar la información antes?</strong> Se descarga como archivo cifrado con una contraseña que elijas, y podrás importarla una vez dentro de la familia nueva.</p>
      <p class="fam-join-help">Los pasos: 1) exportá el archivo y guardalo, 2) eliminá los pacientes, médicos y centros desde sus módulos, 3) volvé acá y canjeá el código.</p>
    </div>`,
    [
      { label: 'Cancelar', cls: 'btn', action: closeModal },
      { label: 'Exportar información', cls: 'btn btn-primary', action: () => openExportModal() },
    ]
  );
}

// ─────────────────────────────────────────
// EXPORTAR
// ─────────────────────────────────────────
async function openExportModal() {
  let patients;
  try {
    patients = await api.listPatients(state.household.id);
  } catch (err) {
    showToast(err.message || 'Error al cargar los pacientes', 'err');
    return;
  }
  if (!patients.length) {
    showToast('No hay pacientes para exportar', 'warn');
    return;
  }

  showModal(
    'Exportar información',
    `<div class="form-body">
      <p class="fam-join-help">Elegí qué pacientes incluir. El archivo lleva su historia completa (órdenes, medicamentos, signos vitales y los médicos/centros referenciados), cifrada con la contraseña que definas acá — no es la de tu cuenta, y si la perdés el archivo no puede abrirse.</p>
      <div class="fam-export-list">
        ${patients.map(p => `
          <label class="fam-export-item">
            <input type="checkbox" data-patient-id="${p.id}" checked/>
            <span>${esc(p.nombre)}</span>
          </label>`).join('')}
      </div>
      <div class="form-row cols-2" style="margin-top:12px">
        <div class="form-field"><label class="fl">Contraseña del archivo (mín. ${xport.MIN_EXPORT_PASSWORD})</label><input class="fi" id="exp-pw" type="password" autocomplete="new-password"/></div>
        <div class="form-field"><label class="fl">Repetir contraseña</label><input class="fi" id="exp-pw2" type="password" autocomplete="new-password"/></div>
      </div>
      <div class="fam-progress" id="exp-progress"></div>
    </div>`,
    [
      { label: 'Cancelar', cls: 'btn', action: closeModal },
      { label: 'Exportar y descargar', cls: 'btn btn-primary', action: () => runExport(patients) },
    ]
  );
}

async function runExport(patients) {
  const pw = document.getElementById('exp-pw').value;
  const pw2 = document.getElementById('exp-pw2').value;
  const progress = document.getElementById('exp-progress');
  const selectedIds = [...document.querySelectorAll('[data-patient-id]:checked')]
    .map(cb => cb.dataset.patientId);
  const selected = patients.filter(p => selectedIds.includes(p.id));

  if (!selected.length) { showToast('Elegí al menos un paciente', 'err'); return; }
  if (pw.length < xport.MIN_EXPORT_PASSWORD) {
    showToast(`La contraseña debe tener al menos ${xport.MIN_EXPORT_PASSWORD} caracteres`, 'err');
    return;
  }
  if (pw !== pw2) { showToast('Las contraseñas no coinciden', 'err'); return; }

  try {
    progress.textContent = 'Reuniendo la información…';
    const payload = await xport.buildExportPayload(state.household.id, state.household.name, selected);
    progress.textContent = 'Cifrando…';
    const envelope = await xport.encryptPayload(payload, pw);
    const filename = xport.downloadEnvelope(envelope);
    const s = xport.summarizePayload(payload);
    closeModal();
    showToast(`Archivo ${filename} descargado (${s.pacientes} paciente${s.pacientes > 1 ? 's' : ''})`);
  } catch (err) {
    progress.textContent = '';
    showToast(err.message || 'Error al exportar', 'err');
  }
}

// ─────────────────────────────────────────
// IMPORTAR
// ─────────────────────────────────────────
function openImportModal() {
  showModal(
    'Importar información',
    `<div class="form-body">
      <p class="fam-join-help">Elegí el archivo exportado (${esc(xport.FILE_EXTENSION)}) y escribí la contraseña con la que se cifró. Antes de importar vas a ver un resumen de lo que contiene.</p>
      <div class="form-field"><label class="fl">Archivo</label><input class="fi" id="imp-file" type="file" accept="${esc(xport.FILE_EXTENSION)},application/json"/></div>
      <div class="form-field"><label class="fl">Contraseña del archivo</label><input class="fi" id="imp-pw" type="password" autocomplete="off"/></div>
      <div class="fam-progress" id="imp-progress"></div>
    </div>`,
    [
      { label: 'Cancelar', cls: 'btn', action: closeModal },
      { label: 'Leer archivo', cls: 'btn btn-primary', action: readImportFile },
    ]
  );
}

async function readImportFile() {
  const fileInput = document.getElementById('imp-file');
  const pw = document.getElementById('imp-pw').value;
  const progress = document.getElementById('imp-progress');
  const file = fileInput.files && fileInput.files[0];

  if (!file) { showToast('Elegí el archivo exportado', 'err'); return; }
  if (!pw) { showToast('Escribí la contraseña del archivo', 'err'); return; }

  let payload;
  try {
    progress.textContent = 'Descifrando…';
    const envelope = await xport.readEnvelopeFile(file);
    payload = await xport.decryptEnvelope(envelope, pw);
  } catch (err) {
    progress.textContent = '';
    showToast(err.message || 'No se pudo leer el archivo', 'err');
    return;
  }

  const s = xport.summarizePayload(payload);
  const fecha = payload.exportedAt ? fmtDate(payload.exportedAt.slice(0, 10)) : '—';
  showModal(
    'Confirmar importación',
    `<div class="form-body">
      <p class="fam-join-help">Exportado de "${esc(payload.householdName || '—')}" el ${esc(fecha)}. Se creará en tu familia actual ("${esc(state.household.name)}"):</p>
      <ul class="fam-summary">
        <li><strong>${s.pacientes}</strong> paciente${s.pacientes === 1 ? '' : 's'}</li>
        <li><strong>${s.ordenes}</strong> orden${s.ordenes === 1 ? '' : 'es'} médica${s.ordenes === 1 ? '' : 's'}</li>
        <li><strong>${s.medicamentos}</strong> medicamento${s.medicamentos === 1 ? '' : 's'}</li>
        <li><strong>${s.vitales}</strong> registro${s.vitales === 1 ? '' : 's'} de signos vitales</li>
        <li><strong>${s.medicos}</strong> médico${s.medicos === 1 ? '' : 's'} y <strong>${s.centros}</strong> centro${s.centros === 1 ? '' : 's'} en los directorios</li>
      </ul>
      <p class="fam-join-help">Si alguno ya existe en esta familia, se creará igual como entrada nueva (no se fusionan).</p>
      <div class="fam-progress" id="imp-run-progress"></div>
    </div>`,
    [
      { label: 'Cancelar', cls: 'btn', action: closeModal },
      { label: 'Importar a esta familia', cls: 'btn btn-primary', action: () => runImport(payload) },
    ]
  );
}

async function runImport(payload) {
  const progress = document.getElementById('imp-run-progress');
  const footerBtns = document.querySelectorAll('#modal-footer button');
  footerBtns.forEach(b => (b.disabled = true));

  try {
    const s = await xport.importPayload(payload, state.household.id,
      txt => { progress.textContent = txt; });
    closeModal();
    showToast(`Importación completa: ${s.pacientes} paciente${s.pacientes === 1 ? '' : 's'} con su historia`);
    // Refrescar contadores y vista (pacientes nuevos disponibles).
    setTimeout(() => window.location.reload(), 1200);
  } catch (err) {
    footerBtns.forEach(b => (b.disabled = false));
    progress.textContent = '';
    showToast(err.message || 'Error durante la importación — puede haber quedado parcial. Revisá los módulos antes de reintentar.', 'err');
  }
}

async function removeMemberConfirm(userId, members) {
  const email = members.find(m => m.userId === userId)?.email || 'este miembro';
  if (!confirm(`¿Sacar a ${email} de la familia? Dejará de ver toda la información compartida.`)) return;
  try {
    await api.removeMember(state.household.id, userId);
    showToast('Miembro retirado', 'warn');
    render();
  } catch (err) {
    showToast(err.message || 'Error al retirar al miembro', 'err');
  }
}

async function leaveFamilyConfirm() {
  if (!confirm('¿Salir de esta familia? Dejarás de ver su información y la app te creará una familia nueva vacía.')) return;
  try {
    await api.removeMember(state.household.id, state.user.id);
    showToast('Saliste de la familia', 'warn');
    setTimeout(() => window.location.reload(), 900);
  } catch (err) {
    showToast(err.message || 'Error al salir de la familia', 'err');
  }
}
