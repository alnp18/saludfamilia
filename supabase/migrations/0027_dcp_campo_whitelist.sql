-- ═══════════════════════════════════════════════════════════
-- Curación: restringir QUÉ campos se pueden proponer — 2026-07-26, Fase 4
--
-- Corrige un agujero de escalación de privilegios de la 0026.
--
-- El problema: `campo` era texto libre. El panel de revisión aplica lo
-- aceptado con un update cuya CLAVE es ese texto, y ese update corre con los
-- permisos de la ADMIN. Cualquier autenticado podía entonces insertar
-- directamente contra la API una corrección con `campo = 'estado'` y
-- `valor_propuesto = 'publicado'` apuntando a su propia entrada pendiente:
-- a la admin le aparecía un renglón más en la lista y, al aceptarlo,
-- publicaba una entrada que nunca revisó. Con `propuesto_por` o
-- `revisado_por` el efecto era equivalente sobre los metadatos de auditoría.
--
-- Es el patrón del "diputado confundido": quien ataca no tiene el permiso,
-- pero consigue que lo ejecute quien sí lo tiene. La RLS estaba bien; lo que
-- faltaba era acotar el dato que después se usa como nombre de columna.
--
-- La lista blanca vive acá, en la base, y no solo en el cliente, porque el
-- cliente no es el único que puede escribir en esta tabla: PostgREST expone
-- la API directamente y la RLS permite insertar a cualquier autenticado.
-- ═══════════════════════════════════════════════════════════

-- Además de acotar los campos, se exige que el campo corresponda al TIPO de
-- entrada: 'especialidad' solo tiene sentido en un médico, 'web' solo en un
-- centro. Un update con una columna que no existe en la tabla destino
-- fallaría en el momento de aplicar, dejando el grupo entero sin poder
-- guardarse.
alter table public.directory_change_proposals
  add constraint dcp_campo_permitido check (
    (public_doctor_id is not null and campo in (
      'nombre', 'especialidad', 'tarjeta_profesional', 'centro',
      'consultorio', 'telefono', 'notas'))
    or
    (public_center_id is not null and campo in (
      'nombre', 'direccion', 'tel1', 'tel2', 'email', 'web'))
  );

-- `nombre` es NOT NULL en las dos tablas públicas: aceptar una corrección
-- que lo deja vacío reventaría el update y, peor, tumbaría de paso los otros
-- campos aceptados en el mismo guardado. Se corta al proponer, que es donde
-- se puede explicar.
alter table public.directory_change_proposals
  add constraint dcp_nombre_no_vacio check (
    campo <> 'nombre' or coalesce(btrim(valor_propuesto), '') <> ''
  );

-- Solo se corrigen entradas YA publicadas. Una entrada pendiente todavía se
-- revisa como "ingreso nuevo" (se aprueba, se edita o se rechaza entera):
-- admitir además correcciones sueltas sobre ella mezcla dos flujos y fue
-- justamente el camino que hacía alcanzable la escalación de arriba.
-- Va como trigger y no como CHECK porque necesita consultar otra tabla.
create or replace function public.dcp_validar_destino_publicado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estado text;
begin
  if new.public_doctor_id is not null then
    select estado into v_estado from public.public_doctors where id = new.public_doctor_id;
  else
    select estado into v_estado from public.public_centers where id = new.public_center_id;
  end if;

  if v_estado is distinct from 'publicado' then
    raise exception 'Solo se pueden proponer correcciones a entradas publicadas';
  end if;

  return new;
end;
$$;

revoke execute on function public.dcp_validar_destino_publicado() from public, anon, authenticated;

create trigger trg_dcp_destino_publicado
  before insert on public.directory_change_proposals
  for each row execute function public.dcp_validar_destino_publicado();
