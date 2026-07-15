-- ═══════════════════════════════════════════════════════════
-- Invitaciones al household (P1 #6 — multiusuario real)
--
-- Modelo: el owner genera un código de invitación y lo comparte por el
-- canal que quiera. El invitado crea su cuenta normal y canjea el código.
--
-- Decisiones de seguridad:
--  · El código NUNCA se guarda en claro: solo su hash sha256. El texto
--    plano se devuelve una única vez al owner que lo genera.
--  · Un solo uso, caduca a los 7 días, revocable (borrando la fila).
--  · Crear y canjear pasan por funciones SECURITY DEFINER con validación
--    propia — el cliente no tiene INSERT/UPDATE sobre la tabla.
--  · Canjear exige mantener el modelo "un household por usuario": si el
--    invitado tiene su household propio vacío (sin pacientes, médicos ni
--    centros y sin otros miembros), se elimina y pasa a la familia que lo
--    invitó; si ya tiene datos u otros miembros, el canje se bloquea con
--    un mensaje claro (mover pacientes entre familias es la pieza de
--    exportar/importar, aún sin diseñar).
--  · Además: un 'member' puede salir de la familia por sí mismo, y el
--    owner ya no puede borrar su propia membership (el household nunca
--    queda sin owner).
-- ═══════════════════════════════════════════════════════════

-- ───────────────────────────────────────────
-- 1. Tabla de invitaciones
-- ───────────────────────────────────────────
create table public.household_invitations (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  code_hash     text not null unique,
  created_by    uuid not null references auth.users(id) on delete cascade,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '7 days',
  used_by       uuid references auth.users(id) on delete set null,
  used_at       timestamptz
);

create index idx_invitations_household on public.household_invitations(household_id);

alter table public.household_invitations enable row level security;

-- El owner ve las invitaciones de su familia (pendientes y usadas).
create policy invitations_select on public.household_invitations
  for select using (
    exists (
      select 1 from public.household_members hm
      where hm.household_id = household_invitations.household_id
        and hm.user_id = (select auth.uid())
        and hm.role = 'owner'
    )
  );

-- Revocar = borrar una invitación aún no usada. Las usadas se conservan
-- como registro de quién entró y cuándo.
create policy invitations_delete on public.household_invitations
  for delete using (
    used_at is null
    and exists (
      select 1 from public.household_members hm
      where hm.household_id = household_invitations.household_id
        and hm.user_id = (select auth.uid())
        and hm.role = 'owner'
    )
  );

-- Sin políticas de INSERT/UPDATE: solo las funciones de abajo escriben.

-- ───────────────────────────────────────────
-- 2. Crear invitación (solo owner) — devuelve el código en claro
-- ───────────────────────────────────────────
-- Código: 12 caracteres de un alfabeto sin ambiguos (sin I/O/0/1),
-- 32^12 ≈ 60 bits de entropía, formateado XXXX-XXXX-XXXX.
-- 256 % 32 = 0, así que el módulo no introduce sesgo.
create or replace function public.create_household_invitation(p_household_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text := '';
  v_i int;
begin
  if not exists (
    select 1 from public.household_members hm
    where hm.household_id = p_household_id
      and hm.user_id = auth.uid()
      and hm.role = 'owner'
  ) then
    raise exception 'Solo quien administra la familia puede generar invitaciones';
  end if;

  for v_i in 1..12 loop
    v_code := v_code || substr(
      v_alphabet,
      (get_byte(extensions.gen_random_bytes(1), 0) % 32) + 1,
      1
    );
  end loop;

  insert into public.household_invitations (household_id, code_hash, created_by)
  values (
    p_household_id,
    encode(extensions.digest(v_code, 'sha256'), 'hex'),
    auth.uid()
  );

  return substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4) || '-' || substr(v_code, 9, 4);
end;
$$;

-- ───────────────────────────────────────────
-- 3. Canjear invitación
-- ───────────────────────────────────────────
create or replace function public.redeem_household_invitation(p_code text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_inv  public.household_invitations%rowtype;
  v_household public.households%rowtype;
  v_uid uuid := auth.uid();
  v_own record;
begin
  if v_uid is null then
    raise exception 'Necesitas una sesión activa para canjear una invitación';
  end if;

  -- Normalizar: mayúsculas, sin guiones ni espacios.
  v_code := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));

  -- Marcar como usada en la misma sentencia que la valida: dos canjes
  -- concurrentes del mismo código no pueden pasar los dos.
  update public.household_invitations
     set used_by = v_uid, used_at = now()
   where code_hash = encode(extensions.digest(v_code, 'sha256'), 'hex')
     and used_at is null
     and expires_at > now()
  returning * into v_inv;

  if v_inv.id is null then
    raise exception 'Código inválido, vencido o ya usado';
  end if;

  if exists (
    select 1 from public.household_members hm
    where hm.household_id = v_inv.household_id and hm.user_id = v_uid
  ) then
    raise exception 'Ya eres parte de esta familia';
  end if;

  -- Modelo de un household por usuario: el household propio del invitado
  -- solo se elimina si está completamente vacío y él es su único miembro.
  for v_own in
    select hm.household_id, hm.role
    from public.household_members hm
    where hm.user_id = v_uid
  loop
    if v_own.role <> 'owner'
       or (select count(*) from public.household_members where household_id = v_own.household_id) > 1
       or exists (select 1 from public.patients        where household_id = v_own.household_id)
       or exists (select 1 from public.doctors         where household_id = v_own.household_id)
       or exists (select 1 from public.medical_centers where household_id = v_own.household_id)
    then
      raise exception 'Tu familia actual ya tiene información registrada u otros miembros. Para unirte a otra familia primero habría que mover esos datos (función de exportar/importar pendiente).';
    end if;

    delete from public.households where id = v_own.household_id;
  end loop;

  insert into public.household_members (household_id, user_id, role)
  values (v_inv.household_id, v_uid, 'member');

  select * into v_household from public.households where id = v_inv.household_id;

  return json_build_object('household_id', v_household.id, 'household_name', v_household.name);
end;
$$;

-- ───────────────────────────────────────────
-- 4. Miembros con correo (para la vista Familia)
-- ───────────────────────────────────────────
-- auth.users no es accesible desde el cliente; esta función expone SOLO
-- el correo de los co-miembros del household consultado, y solo si quien
-- consulta pertenece a él.
create or replace function public.household_members_with_email(p_household_id uuid)
returns table (user_id uuid, role text, joined_at timestamptz, email text)
language sql
stable
security definer
set search_path = public
as $$
  select hm.user_id, hm.role, hm.joined_at, u.email::text
  from public.household_members hm
  join auth.users u on u.id = hm.user_id
  where hm.household_id = p_household_id
    and public.is_household_member(p_household_id)
  order by hm.role desc, hm.joined_at;
$$;

-- ───────────────────────────────────────────
-- 5. Salir de la familia / gestión de bajas
-- ───────────────────────────────────────────
-- Antes: solo el owner borraba memberships (incluida la suya, dejando un
-- household huérfano). Ahora: el owner saca a otros pero nunca a sí
-- mismo, y un member puede salir por su cuenta.
drop policy household_members_delete on public.household_members;
create policy household_members_delete on public.household_members
  for delete using (
    (
      household_members.user_id <> (select auth.uid())
      and exists (
        select 1 from public.household_members hm
        where hm.household_id = household_members.household_id
          and hm.user_id = (select auth.uid())
          and hm.role = 'owner'
      )
    )
    or (
      household_members.user_id = (select auth.uid())
      and household_members.role = 'member'
    )
  );

-- ───────────────────────────────────────────
-- 6. Permisos de ejecución
-- ───────────────────────────────────────────
revoke execute on function public.create_household_invitation(uuid) from public, anon;
revoke execute on function public.redeem_household_invitation(text) from public, anon;
revoke execute on function public.household_members_with_email(uuid) from public, anon;
grant execute on function public.create_household_invitation(uuid) to authenticated;
grant execute on function public.redeem_household_invitation(text) to authenticated;
grant execute on function public.household_members_with_email(uuid) to authenticated;
