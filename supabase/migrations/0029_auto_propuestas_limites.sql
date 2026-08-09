-- 0029 — Tope antispam para las propuestas anónimas, y hora redondeada
--
-- Aplicada a producción el 2026-08-04 (versión 20260804213144). El commit que
-- la acompañaba (605e157) nunca llegó a subirse al repo. Recuperada el
-- 2026-08-09 desde supabase_migrations.schema_migrations, tal cual quedó
-- ejecutada. NO reaplicar: ya está en la base.
--
-- Dos agujeros que introdujo 0028:
--
-- 1. El tope antispam quedó anulado. La migración 0021 limita las propuestas
--    pendientes contando por propuesto_por; al entrar anónimas, ese conteo daba
--    siempre cero. Bastaba crear médicos privados en serie para inundar la
--    cola, encima sin rastro. No se podía arreglar devolviendo el proponente
--    (el anonimato era el punto) ni contando por household (eso exigiría
--    guardar el household en la tabla pública, que es justo la vinculación a
--    evitar). Se optó por un tope GLOBAL de pendientes anónimos: más tosco,
--    pero acota el daño sin reintroducir vinculación.
--
-- 2. La hora exacta era una huella. Con microsegundos se puede reagrupar por
--    cercanía temporal lo que una familia creó en una sesión y volver a atar el
--    conjunto a una persona. Se redondea a la hora (date_trunc('hour', now())).

create or replace function public.hay_cupo_propuestas_anonimas(p_tabla text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_n int;
  c_tope constant int := 200;
begin
  if p_tabla = 'public_doctors' then
    select count(*) into v_n from public.public_doctors
     where estado = 'pendiente' and propuesto_por is null;
  elsif p_tabla = 'public_centers' then
    select count(*) into v_n from public.public_centers
     where estado = 'pendiente' and propuesto_por is null;
  else
    select count(*) into v_n from public.public_specialties
     where estado = 'pendiente' and propuesto_por is null;
  end if;
  return v_n < c_tope;
end;
$$;

revoke execute on function public.hay_cupo_propuestas_anonimas(text) from public, anon, authenticated;

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
  if not public.hay_cupo_propuestas_anonimas('public_doctors') then return new; end if;

  select nombre into v_centro from public.medical_centers where id = new.centro_id;

  begin
    insert into public.public_doctors
      (nombre, especialidad, tarjeta_profesional, centro, estado, propuesto_por, created_at)
    values
      (btrim(new.nombre), new.especialidad, new.tarjeta_profesional, v_centro,
       'pendiente', null, date_trunc('hour', now()));
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
  if not public.hay_cupo_propuestas_anonimas('public_centers') then return new; end if;

  begin
    insert into public.public_centers
      (nombre, direccion, tel1, tel2, email, web, estado, propuesto_por, created_at)
    values
      (btrim(new.nombre), new.direccion, new.tel1, new.tel2, new.email, new.web,
       'pendiente', null, date_trunc('hour', now()));
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
  if not public.hay_cupo_propuestas_anonimas('public_specialties') then return new; end if;

  begin
    insert into public.public_specialties (nombre, estado, propuesto_por, created_at)
    values (btrim(new.valor), 'pendiente', null, date_trunc('hour', now()));
  exception when unique_violation then
    null;
  end;

  return new;
end;
$$;
