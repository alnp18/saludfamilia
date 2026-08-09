-- 0028 — Ingresos automáticos a la cola de revisión del directorio público
--
-- Aplicada a producción el 2026-08-04 (versión 20260804211735). El commit que
-- la acompañaba (9f5cf03) nunca llegó a subirse al repo, así que el archivo se
-- perdió. Recuperado el 2026-08-09 desde supabase_migrations.schema_migrations,
-- tal cual quedó ejecutado. NO reaplicar: ya está en la base.
--
-- Qué hace: todo médico, centro o especialidad nueva del directorio PRIVADO de
-- una familia entra automáticamente a la cola de revisión del directorio
-- público, y entra SIN PROPONENTE (propuesto_por = null).
--
-- Por qué anónima: con el botón manual, propuesto_por era información que la
-- persona entregaba a sabiendas. Si cada médico que una familia registra
-- apareciera en la cola con su nombre al lado, la administradora podría deducir
-- a qué profesionales consulta esa familia — "la familia X propuso a un
-- psiquiatra" es una inferencia sobre su salud que antes no existía en el
-- sistema. El anonimato obliga a que la inserción la haga una función
-- SECURITY DEFINER: la RLS de 0020 exige propuesto_por = auth.uid() al
-- insertar, así que una fila anónima no puede crearla el cliente.
--
-- Qué viaja de un médico: nombre, especialidad, tarjeta profesional y centro.
-- NO viajan consultorio, teléfono ni notas. De un centro viaja todo: sus campos
-- son públicos por definición.
--
-- Ver 0029, que corrige el tope antispam que esta migración dejó anulado.

-- ---------------------------------------------------------------------------
-- Catálogo público de especialidades, con el mismo ciclo de revisión
-- ---------------------------------------------------------------------------

create table public.public_specialties (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null,
  estado         text not null default 'pendiente'
                   check (estado in ('pendiente', 'publicado', 'rechazado')),
  propuesto_por  uuid references auth.users(id) on delete set null,
  nota_revision  text,
  revisado_por   uuid references auth.users(id) on delete set null,
  revisado_en    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index idx_public_specialties_nombre
  on public.public_specialties (lower(btrim(nombre)));
create index idx_public_specialties_estado on public.public_specialties (estado);

create trigger trg_public_specialties_updated_at
  before update on public.public_specialties
  for each row execute function public.set_updated_at();

create trigger trg_public_specialties_review_meta
  before update on public.public_specialties
  for each row execute function public.set_directory_review_meta();

alter table public.public_specialties enable row level security;

create policy public_specialties_select on public.public_specialties
  for select using (
    estado = 'publicado'
    or propuesto_por = (select auth.uid())
    or private.is_app_admin()
  );

create policy public_specialties_insert on public.public_specialties
  for insert with check (
    propuesto_por = (select auth.uid())
    and (estado = 'pendiente' or private.is_app_admin())
  );

create policy public_specialties_update on public.public_specialties
  for update using (private.is_app_admin())
  with check (private.is_app_admin());

create policy public_specialties_delete on public.public_specialties
  for delete using (
    private.is_app_admin()
    or (propuesto_por = (select auth.uid()) and estado in ('pendiente', 'rechazado'))
  );

revoke all on public.public_specialties from anon;

-- ---------------------------------------------------------------------------
-- Antiduplicados: no proponer lo que ya está en el directorio o en la cola
-- ---------------------------------------------------------------------------

create or replace function public.evitar_propuesta_duplicada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existe boolean;
begin
  if new.estado is distinct from 'pendiente' then
    return new;
  end if;

  if tg_table_name = 'public_doctors' then
    select exists (
      select 1 from public.public_doctors
      where lower(btrim(nombre)) = lower(btrim(new.nombre))
    ) into v_existe;
  else
    select exists (
      select 1 from public.public_centers
      where lower(btrim(nombre)) = lower(btrim(new.nombre))
    ) into v_existe;
  end if;

  if v_existe then
    raise exception 'Ya existe una entrada con ese nombre en el directorio o en revisión'
      using errcode = 'unique_violation';
  end if;

  return new;
end;
$$;

revoke execute on function public.evitar_propuesta_duplicada() from public, anon, authenticated;

create trigger trg_public_doctors_sin_duplicados
  before insert on public.public_doctors
  for each row execute function public.evitar_propuesta_duplicada();

create trigger trg_public_centers_sin_duplicados
  before insert on public.public_centers
  for each row execute function public.evitar_propuesta_duplicada();

-- ---------------------------------------------------------------------------
-- Propuestas automáticas y anónimas desde el directorio privado
-- ---------------------------------------------------------------------------
-- public_source_id no nulo = la entrada privada es copia de una pública, así
-- que ya está en el directorio y no hay nada que proponer.
-- El unique_violation se traga en silencio: que otra familia ya haya
-- registrado al mismo médico no es un error para quien está guardando.

create or replace function public.auto_proponer_medico()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_centro text;
begin
  if new.public_source_id is not null then return new; end if;
  if coalesce(btrim(new.nombre), '') = '' then return new; end if;

  select nombre into v_centro from public.medical_centers where id = new.centro_id;

  begin
    insert into public.public_doctors
      (nombre, especialidad, tarjeta_profesional, centro, estado, propuesto_por)
    values
      (btrim(new.nombre), new.especialidad, new.tarjeta_profesional, v_centro, 'pendiente', null);
  exception when unique_violation then
    null;
  end;

  return new;
end;
$$;

create or replace function public.auto_proponer_centro()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.public_source_id is not null then return new; end if;
  if coalesce(btrim(new.nombre), '') = '' then return new; end if;

  begin
    insert into public.public_centers
      (nombre, direccion, tel1, tel2, email, web, estado, propuesto_por)
    values
      (btrim(new.nombre), new.direccion, new.tel1, new.tel2, new.email, new.web, 'pendiente', null);
  exception when unique_violation then
    null;
  end;

  return new;
end;
$$;

create or replace function public.auto_proponer_especialidad()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.categoria is distinct from 'especialidad' then return new; end if;
  if coalesce(btrim(new.valor), '') = '' then return new; end if;

  begin
    insert into public.public_specialties (nombre, estado, propuesto_por)
    values (btrim(new.valor), 'pendiente', null);
  exception when unique_violation then
    null;
  end;

  return new;
end;
$$;

revoke execute on function public.auto_proponer_medico() from public, anon, authenticated;
revoke execute on function public.auto_proponer_centro() from public, anon, authenticated;
revoke execute on function public.auto_proponer_especialidad() from public, anon, authenticated;

create trigger trg_doctors_auto_propuesta
  after insert on public.doctors
  for each row execute function public.auto_proponer_medico();

create trigger trg_centers_auto_propuesta
  after insert on public.medical_centers
  for each row execute function public.auto_proponer_centro();

create trigger trg_catalog_auto_propuesta_especialidad
  after insert on public.custom_catalog_options
  for each row execute function public.auto_proponer_especialidad();
