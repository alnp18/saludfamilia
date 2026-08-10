-- 0034 — La vista de órdenes se había quedado atrás de la tabla
--
-- Encontrado el 2026-08-10 probando la aplicación en un navegador real: en la
-- pestaña Archivo aparecía la historia clínica de una orden pero no su
-- documento de orden, aunque en la base los dos estaban guardados.
--
-- Causa: `medical_orders_with_stage` se creó con una lista de columnas fija.
-- Una vista no hereda las columnas que se agreguen después a la tabla, y la
-- aplicación lee TODAS las órdenes por esta vista (listOrdersByHousehold,
-- listOrdersByPatient y getOrder). Faltaban dos:
--
--   auth_meses       agregada en 0015. La vista es anterior. Nunca se pudo leer.
--   orden_documento  agregada en 0033, ayer.
--
-- Lo que se escribe va a la tabla y queda bien guardado; lo que no se puede es
-- volver a leerlo. El daño real está en la edición: abrir una orden carga sus
-- campos desde la vista, así que estos dos llegaban vacíos, y al guardar se
-- escribía ese vacío encima. El adjunto quedaba huérfano en Storage —sin nadie
-- que lo referencie, tampoco lo borra la limpieza— y la cantidad de meses de
-- una autorización se perdía sin aviso.
--
-- Hoy no hay pérdida consumada: ninguna orden real tiene auth_meses cargado, y
-- la única con orden_documento es la de prueba de esta sesión.
--
-- security_invoker=true no es opcional: sin él la vista corre con los permisos
-- de quien la creó y se salta la RLS de medical_orders, que es lo único que
-- separa a una familia de otra.
--
-- Para la próxima: al agregar una columna a medical_orders hay que recrear
-- también esta vista. Es la tercera vez que el repo y la base se desalinean en
-- este proyecto, siempre por lo mismo — algo que se define una vez y no se
-- revisa cuando cambia lo que describe.
--
-- Las dos columnas van al FINAL y no en su lugar lógico: `create or replace
-- view` solo admite agregar al final, y renombrar en el medio lo interpreta
-- como cambiar el nombre de una columna existente. La alternativa era borrar y
-- recrear la vista, que obliga a rehacer todo lo que dependa de ella. El orden
-- de las columnas de una vista no le importa a nadie; el drop sí.

create or replace view public.medical_orders_with_stage
with (security_invoker = true) as
select
  id,
  household_id,
  patient_id,
  medico_id,
  fecha_orden,
  tipo_orden,
  descripcion,
  orden_archivo,      -- historia clínica (nombre histórico, ver 0033)
  solicitud_fecha,
  solicitud_hora,
  solicitud_numero,
  solicitud_imagen,
  auth_fecha_inicio,
  auth_fecha_vence,
  auth_numero,
  auth_centro_id,
  auth_imagen,
  cita_fecha,
  cita_hora,
  medico_id_cita,
  cita_consultorio,
  cita_direccion,
  cita_indicaciones,
  estado_cita,
  created_at,
  updated_at,
  order_stage(o.*) as stage,
  auth_meses,         -- agregada en 0015, nunca llegó a la vista
  orden_documento     -- orden médica (agregada en 0033)
from public.medical_orders o;
