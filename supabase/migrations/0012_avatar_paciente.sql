-- MI AUDITORIA — Pacientes #1: avatar/foto del paciente.
-- Igual que patient_policies.imagen, se guarda como jsonb apuntando a
-- Storage (bucket privado "adjuntos"): {name, type, size, path}. No es una
-- foto convertida a PDF (a diferencia de los adjuntos de órdenes/pólizas):
-- se sube y se muestra tal cual, redimensionada en el cliente antes de
-- subir (ver processAvatarFile en src/lib/files.js).
alter table public.patients add column foto jsonb;
