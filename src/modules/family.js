import { state } from '../state.js';
import * as api from '../lib/api.js';
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
  `;

  el.querySelectorAll('[data-remove-id]').forEach(b =>
    b.addEventListener('click', () => removeMemberConfirm(b.dataset.removeId, members)));
  document.getElementById('btn-leave-family')?.addEventListener('click', leaveFamilyConfirm);
  document.getElementById('btn-new-invite')?.addEventListener('click', generateInvite);
  document.getElementById('btn-join-family').addEventListener('click', joinFamily);
  document.getElementById('join-code').addEventListener('keydown', e => {
    if (e.key === 'Enter') joinFamily();
  });

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
