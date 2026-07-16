-- P1.5 — Médicos: nuevo campo "Número de tarjeta profesional", debajo del
-- nombre del médico en el formulario y en la tarjeta del directorio.
alter table doctors add column tarjeta_profesional text;
