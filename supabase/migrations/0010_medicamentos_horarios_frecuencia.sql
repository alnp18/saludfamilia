-- P1.5 — Medicamentos: nuevo "Horarios de toma" (cada horario con su propia
-- dosis, filas auto-generadas y espaciadas según la frecuencia) y nuevas
-- opciones fijas de Frecuencia.
--
-- 1) horarios: antes text[] con solo la hora ("08:00"); ahora jsonb con
--    {hora, dosis} por cada toma, para poder registrar una dosis distinta
--    en cada horario. Postgres no permite subconsultas en la cláusula
--    USING de "alter column ... type", así que se hace con una columna
--    puente: se agrega en jsonb, se llena con UPDATE, se borra la vieja
--    y se renombra.
-- 2) frecuencia: se remapean a las nuevas 5 opciones fijas SOLO los valores
--    antiguos con un equivalente directo y sin ambigüedad clínica. El valor
--    antiguo "Cada 4 horas" (6 tomas/día) NO tiene equivalente en el nuevo
--    listado de 5 opciones — se deja intacto a propósito, igual que "Otra":
--    no se reinterpreta una frecuencia de dosificación médica sin que la
--    persona la confirme explícitamente al editar el registro. Esos casos
--    simplemente no quedan preseleccionados en el desplegable hasta que se
--    edite el medicamento.

-- 1) horarios: text[] → jsonb [{hora, dosis}]
alter table medications add column horarios_new jsonb not null default '[]'::jsonb;

update medications set horarios_new = (
  select coalesce(jsonb_agg(jsonb_build_object('hora', h, 'dosis', '')), '[]'::jsonb)
  from unnest(horarios) as h
);

alter table medications drop column horarios;
alter table medications rename column horarios_new to horarios;

-- 2) frecuencia: remapeo de los valores antiguos con equivalente directo
update medications set frecuencia = 'Una vez al día'
  where frecuencia in ('Una vez al día', 'Cada 24 horas');
update medications set frecuencia = 'Dos veces al día o cada 12 horas'
  where frecuencia in ('Dos veces al día', 'Cada 12 horas');
update medications set frecuencia = 'Tres veces al día o cada 8 horas'
  where frecuencia in ('Tres veces al día', 'Cada 8 horas');
update medications set frecuencia = 'Cuatro veces al día o cada 6 horas'
  where frecuencia = 'Cada 6 horas';
update medications set frecuencia = 'A demanda'
  where frecuencia = 'Según necesidad';
