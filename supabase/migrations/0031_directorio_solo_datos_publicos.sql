-- 0031 — El directorio compartido guarda solo datos públicos del médico
--
-- Última tarea de Fase 4 de la auditoría móvil: "información pública de
-- médicos (vistas/RLS)". El plan lo dice desde el principio:
--
--   público  → nombre, tarjeta profesional, especialidad, centros
--   privado  → consultorio, extensión telefónica, notas
--
-- Hasta ahora esa frontera vivía en el código que decidía qué copiar, y no en
-- el esquema. Los dos caminos no coincidían: la propuesta automática de 0028
-- ya omitía los tres campos privados, pero el botón manual "Proponer" los
-- enviaba enteros, y el formulario de la admin los mostraba y editaba.
--
-- No era teórico. Al aplicar esta migración había una entrada publicada con
-- consultorio cargado: un dato de una familia, legible por cualquier cuenta
-- autenticada. Se verificó antes de borrar que el mismo valor está en el
-- registro privado de esa familia, así que quien lo anotó no lo pierde.
--
-- Las notas son el caso que más incomoda de los tres: son el campo donde una
-- familia escribe "el que ve lo del hijo mayor" o el horario que le dieron por
-- teléfono. No hay forma de que eso viaje a un directorio compartido sin
-- filtrar algo sobre quien lo escribió.
--
-- Borrar la columna, y no solo dejar de escribirla, es el punto: mientras
-- exista, cualquier camino nuevo puede volver a llenarla sin que nadie lo
-- note. PostgREST expone estas tablas directamente, así que la única barrera
-- que no depende de recordar algo es que la columna no esté.

-- La lista blanca de 0027 acota qué campos admite una corrección propuesta, y
-- ese texto se usa después como nombre de columna en el update de la admin.
-- Si quedara admitiendo los tres borrados, una corrección apuntaría a una
-- columna inexistente y reventaría el guardado entero del grupo.
alter table public.directory_change_proposals
  drop constraint dcp_campo_permitido;

alter table public.directory_change_proposals
  add constraint dcp_campo_permitido check (
    (public_doctor_id is not null and campo in (
      'nombre', 'especialidad', 'tarjeta_profesional', 'centro'))
    or
    (public_center_id is not null and campo in (
      'nombre', 'direccion', 'tel1', 'tel2', 'email', 'web'))
  );

alter table public.public_doctors
  drop column consultorio,
  drop column telefono,
  drop column notas;

comment on table public.public_doctors is
  'Directorio compartido de médicos. Solo datos públicos del profesional: '
  'nombre, especialidad, tarjeta profesional y centro. El consultorio, el '
  'teléfono y las notas son del household y no tienen columna acá a propósito '
  '(ver 0031) — cada familia los guarda en su tabla doctors.';
