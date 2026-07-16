-- MI AUDITORIA — Pacientes #3: nombre de la aseguradora en cada póliza.
-- Campo de texto libre (a diferencia de Tipo de póliza, no se modela como
-- catálogo extensible "Otra…": el nombre de la aseguradora es información
-- puntual de la póliza, no una clasificación que valga la pena reutilizar
-- entre pólizas del mismo household).
alter table public.patient_policies add column aseguradora text;
