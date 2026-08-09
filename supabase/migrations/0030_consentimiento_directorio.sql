-- 0030 — Consentimiento para compartir con el directorio público
--
-- Desde 0028, todo médico, centro o especialidad nueva del directorio privado
-- de una familia entra automáticamente a la cola de revisión del directorio
-- compartido. Entra anónima, sí, pero entra siempre: la familia nunca decidió
-- que eso ocurriera y, una vez enviado, no había forma de retractarse.
--
-- Decisión tomada el 2026-08-09: pedir permiso, con la casilla marcada por
-- defecto. El directorio sigue creciendo con el uso normal, pero la familia ve
-- la decisión en el momento de crear y puede desmarcarla ahí mismo.
--
-- Una casilla en la interfaz no alcanza: la inserción la hacen triggers
-- AFTER INSERT del lado del servidor, que no saben nada de la pantalla. Por eso
-- la elección viaja como columna de la fila privada y los triggers la leen.
--
-- El default es true por dos razones: es la decisión que se tomó para lo nuevo,
-- y las filas que ya existían fueron creadas bajo el régimen de 0028, donde ya
-- se compartieron. Ponerles false fingiría un consentimiento denegado que nadie
-- expresó, y volvería a ofrecer "Proponer al directorio" sobre entradas que ya
-- están en la cola.
--
-- Alcance: solo se leen en INSERT. Cambiar la casilla al editar no retira nada
-- de la cola — retirar una propuesta ya enviada es otra tarea, y la interfaz no
-- ofrece la casilla al editar justamente para no prometer lo que no cumple.

alter table public.doctors
  add column compartir_directorio boolean not null default true;
alter table public.medical_centers
  add column compartir_directorio boolean not null default true;
alter table public.custom_catalog_options
  add column compartir_directorio boolean not null default true;

comment on column public.doctors.compartir_directorio is
  'Si la familia autorizó enviar esta entrada, anónima, a la cola de revisión '
  'del directorio público. Solo se lee en INSERT (ver 0030).';
comment on column public.medical_centers.compartir_directorio is
  'Ídem doctors.compartir_directorio (ver 0030).';
comment on column public.custom_catalog_options.compartir_directorio is
  'Ídem doctors.compartir_directorio. Solo tiene efecto en categoria = '
  'especialidad, que es la única que alimenta el directorio (ver 0030).';

create or replace function public.auto_proponer_medico()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_centro text;
begin
  if not new.compartir_directorio then return new; end if;
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
  if not new.compartir_directorio then return new; end if;
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
  if not new.compartir_directorio then return new; end if;
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
