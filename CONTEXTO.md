# SaludFamilia — Contexto del proyecto

_Última actualización: 2026-07-17 (P1.5 completa + P2 100% completa +
backlog "MI AUDITORIA" + segunda auditoría de Ficha de paciente + tercera
auditoría de Medicamentos + cuarta auditoría de Signos Vitales: hora de
toma, edad automática, peso gramos/kg por edad, altura/longitud tibial y
frecuencia respiratoria)_

## Qué es

Aplicación de gestión médica familiar. Multiusuario vía Supabase Auth, con
datos aislados por grupo familiar (`household`) mediante Row Level Security.
Frontend estático (Vite, sin framework) desplegado en Vercel.

## Objetivo actual

El MVP público (70% de funcionalidades CORE) está **desbloqueado, accesible
y verificado E2E en producción** (ver sección de datos y de historial).
Casi todo el trabajo relevado hasta ahora está completado; el detalle por
frente, con prioridad y agente recomendado, está en
`docs/Plan_de_Avance_MVP.docx`:

1. ✅ Verificación E2E formal contra producción — **COMPLETADA** el
   2026-07-15 (signup → paciente → orden → medicamentos → vitales, con
   aislamiento RLS confirmado en ambas direcciones). Detalle abajo.
2. ✅ Recuperación de contraseña (P1 #4) — **COMPLETADA** el 2026-07-15
   (flujo completo de "olvidé mi contraseña" con evento `PASSWORD_RECOVERY`,
   verificado E2E en producción con correo real), junto con la mejora de
   previsualizar contraseña (botón ojo/ojo tachado) surgida del feedback
   del usuario durante ese E2E.
3. ✅ Invitar miembros al household (P1 #6) — **COMPLETADA** el 2026-07-15
   y verificada E2E en producción con el ciclo completo (generar código →
   canjear → salir de la familia). Detalle abajo.
4. ✅ Exportar/Importar pacientes entre familias (pieza B de arquitectura)
   — **COMPLETADA** el 2026-07-15, con diseño cambiado respecto al plan
   original: archivo cifrado descargado al dispositivo en vez de llave en
   el servidor. Verificada por el usuario en producción. Detalle abajo.
5. ✅ Migrar adjuntos a Supabase Storage (P1 #7) — **COMPLETADA** el
   2026-07-15 (migración 0006; producción tenía 0 adjuntos base64, no
   hubo datos que mover). Pendiente su E2E por UI en producción.
6. ✅ Auditoría de seguridad RLS pre-lanzamiento (P1 #8) — **COMPLETADA**
   el 2026-07-16 (migraciones 0007 y 0008). Detalle abajo.
7. ✅ Ajustes de interfaz (P1.5, Sonnet) — **COMPLETADA al 100%** el
   2026-07-16: tema visual, Ficha de paciente, Órdenes médicas,
   Medicamentos, Médicos, cambio transversal de imágenes/documentos
   (foto→PDF + captura por cámara + visor con lightbox y descarga), y la
   migración de Pólizas al helper compartido de catálogo extensible. No
   queda ningún ítem pendiente de esta tanda. Detalle en la sección
   dedicada abajo.
8. ✅ Prioridad P2 (Sonnet) — **4 de 4 tareas COMPLETADAS** el 2026-07-16:
   responsive móvil, eliminar `SaludFamilia.html` legacy, aviso médico y
   de privacidad, y estados vacíos/manejo de errores consistente (P2 #11,
   último ítem, cerrado el mismo día). No queda ningún ítem pendiente de
   esta tanda.
9. ✅ Backlog adicional relevado por la usuaria, "**MI AUDITORIA**" —
   **COMPLETADO** el 2026-07-16: 5 ajustes en Ficha de paciente y una
   restructuración de 5 partes en Órdenes médicas. No estaba en el plan
   original — ver sección dedicada abajo.
10. Pieza A de arquitectura (directorio público auditado de médicos y
    centros), diseñada a alto nivel pero sin implementar (Fable).

## Arquitectura

```
saludfamilia/
├── supabase/
│   └── migrations/
│       ├── 0001_init_schema.sql
│       ├── 0002_harden_functions.sql
│       ├── 0003_indexes_and_rls_perf.sql
│       ├── 0004_fix_households_select_rls.sql
│       ├── 0005_household_invitations.sql   ← invitaciones + canje + bajas
│       ├── 0006_storage_adjuntos.sql        ← bucket privado + políticas
│       ├── 0007_auditoria_rls_hardening.sql ← FKs compuestas, schema private…
│       ├── 0008_indices_fks_compuestas.sql
│       ├── 0009_ficha_paciente_edicion.sql   ← nombre en 4 campos, dirección,
│       │                                       contacto emergencia, pólizas
│       ├── 0010_medicamentos_horarios_frecuencia.sql ← horarios jsonb {hora,dosis}
│       ├── 0011_medicos_tarjeta_profesional.sql
│       ├── 0012_avatar_paciente.sql          ← MI AUDITORIA Pacientes #1
│       ├── 0013_poliza_aseguradora.sql       ← MI AUDITORIA Pacientes #3
│       ├── 0014_diagnosticos_cronicos.sql    ← MI AUDITORIA Pacientes #5
│       ├── 0015_autorizaciones_medicamentos.sql ← MI AUDITORIA Órdenes #4
│       ├── 0016_patient_diagnoses_update_rls.sql ← 2ª auditoría (editar diagnósticos)
│       ├── 0017_medicamentos_indicacion_controlado_usos.sql ← auditoría Medicamentos
│       └── 0018_vital_signs_auditoria.sql       ← auditoría Signos Vitales
├── src/
│   ├── lib/
│   │   ├── supabaseClient.js
│   │   ├── auth.js            ← signUp/signIn/signOut + ensureHousehold()
│   │   │                        + requestPasswordReset/updatePassword
│   │   ├── api.js              ← + FAMILIA (miembros/invitaciones) +
│   │   │                          order_authorizations (MI AUDITORIA Órdenes #4)
│   │   ├── files.js            ← adjuntos en Storage (subir/firmar/borrar) +
│   │   │                          processUploadFile() (validación + foto→PDF)
│   │   ├── avatar.js           ← foto de perfil del paciente (redimensiona
│   │   │                          en el cliente, no se convierte a PDF)
│   │   ├── viewModeOverlay.js  ← ventana sobrepuesta de solo lectura
│   │   │                          (Pacientes y Órdenes, barra fija + Editar)
│   │   ├── viewer.js           ← visor de adjuntos: ampliar/descargar,
│   │   │                          zoom 100–300%, arrastre
│   │   ├── inlineDirectory.js  ← alta rápida de médico/centro sin salir del flujo
│   │   ├── legal.js            ← aviso médico y de privacidad (P2 #12)
│   │   ├── emptyState.js       ← empty state / error state compartidos
│   │   │                          (P2 #11)
│   │   ├── imageCropper.js     ← recorte/encuadre de imagen (arrastre + zoom)
│   │   │                          para avatar y carnet de póliza (auditoría 2026-07-17)
│   │   ├── exportImport.js     ← exportar/importar cifrado (.sfam)
│   │   ├── extensibleCatalog.js ← patrón "Otra…" compartido (Pólizas,
│   │   │                           Medicamentos, Médicos — los tres módulos)
│   │   ├── theme.js            ← ThemeEngine: paleta determinista por paciente
│   │   ├── icons.js
│   │   ├── modal.js
│   │   └── utils.js
│   ├── modules/                ← incluye header.js y family.js; orders.js
│   │                             agrupa además la pestaña Flujo (línea de
│   │                             tiempo, MI AUDITORIA Órdenes #5)
│   ├── state.js
│   └── main.js                 ← auth screen + bootstrap + router
├── index.html / vite.config.js / vercel.json / package.json
```

## Infraestructura

- **Supabase**: proyecto `smbnogsvqaowfwqchuvy` (región `sa-east-1`),
  `ACTIVE_HEALTHY`, **18 migraciones** aplicadas (`0012`–`0015` del backlog
  MI AUDITORIA: avatar de paciente, aseguradora de pólizas, diagnósticos
  crónicos CIE10, y autorizaciones mes a mes de Órdenes; `0016` de la
  segunda auditoría: política RLS de UPDATE en `patient_diagnoses`; `0017`
  de la auditoría de Medicamentos: columnas `indicacion`/`controlado` en
  `medications` y tabla nueva `med_usage_events` con RLS; `0018` de la
  auditoría de Signos Vitales: columnas `hora`/`frecuencia_respiratoria`/
  `longitud_tibial` en `vital_signs` y `peso` ampliado a `numeric(6,3)`).
  **Ojo con la 0018**: en la tabla de migraciones de Supabase quedó
  registrada con el nombre `0005_vital_signs_auditoria` (se aplicó desde
  otra conversación que trabajaba sobre una copia local desactualizada). El
  esquema quedó correcto; el archivo del repo es el `0018` bien numerado y
  es idempotente (`add column if not exists`), así que reaplicarlo no rompe
  nada — es solo una inconsistencia cosmética de nombre entre la DB y el repo.
  Plan gratuito — "Leaked password protection" NO se puede activar
  (requiere Pro); el mínimo de contraseña se subió a 8 caracteres en Auth
  (2026-07-16). PostgreSQL 17. Bucket privado de Storage `adjuntos` (10MB
  máx., imágenes y PDF). Tabla de catálogo compartida
  `custom_catalog_options` (household_id, categoria, valor) para el
  patrón "Otra… extensible", usada ahora por los tres módulos (Pólizas,
  Vía de administración, Especialidad).
- **Vercel**: proyecto `saludfamilia` (team `alnp`, id
  `team_upa18NsIqLYAoLBKzY61ioPk`). URL de producción:
  **https://saludfamilia.vercel.app** (alias también
  `saludfamilia-alnp.vercel.app` y `saludfamilia-git-main-alnp.vercel.app`).
  Deployment Protection desactivado. Variables `VITE_SUPABASE_URL` y
  `VITE_SUPABASE_ANON_KEY` en el environment **Production**. Cada push a
  `main` dispara deploy automático.
- **GitHub**: [alnp18/saludfamilia](https://github.com/alnp18/saludfamilia),
  rama `main`. **Sin conector MCP para Claude ni credenciales de `git push`**
  en el sandbox de las sesiones — reconfirmado el 2026-07-16 (`git push`
  falla con `could not read Username for 'https://github.com': terminal
  prompts disabled`). El repo es público, así que sí se puede clonar en
  modo lectura sin credenciales; el patrón que funciona es generar un
  `git bundle` (`git bundle create archivo.bundle origin/main..main`),
  entregarlo con `SendUserFile` + `device_commit_files` a `~/Downloads/`
  del usuario, y que el usuario lo fusione y empuje desde su PowerShell
  local (`git fetch archivo.bundle main:bundle-N` → `git merge bundle-N`
  → `git push origin main`). Usado con éxito repetidas veces durante la
  sesión de MI AUDITORIA. Verificar deploys con `Vercel:list_deployments`.
- **Navegador (Claude in Chrome)**: la extensión NO viene conectada por
  defecto. Para un E2E real por UI hay que pedirle al usuario que active la
  extensión y dé permiso al dominio `saludfamilia.vercel.app`. Con la
  ventana angosta el menú lateral se colapsa; conviene `resize_window` a
  ~1200×760 (1440 falla por exceder pantalla) para navegar con fiabilidad.
- **Entorno local**: funcional. Node v24.18.0, npm operativo. `.env` con
  credenciales de Supabase (formato `sb_publishable_...`).

## Estado de los datos (importante para el próximo agente)

**La base de datos de producción está vacía de datos clínicos de nuevo.**
Conteo real verificado por SQL el 2026-07-16 (después del backlog MI
AUDITORIA, sin que esta sesión escribiera datos de prueba — todas las
verificaciones de MI AUDITORIA se hicieron con Playwright reconstruyendo
HTML en local, no contra Supabase):

- `auth.users`: **2** (`alnp.alnp@gmail.com` y `dacn.2026@gmail.com`).
- `households`: 2 · `household_members`: 2.
- `patients`, `medical_orders`, `medications`, `doctors`,
  `medical_centers`, `vital_signs`, `patient_policies`,
  `patient_diagnoses`, `order_authorizations`: **0 en todas** — el volumen
  de datos de prueba que existía tras el E2E de P1.5 (18 órdenes, 3
  medicamentos, 4 médicos, 4 centros, etc.) **ya no está**; alguien lo
  limpió entre sesiones (no fue esta sesión).
- `custom_catalog_options`: **2** (quedan `especialidad =
  "Endocrinologia"` y `via_administracion = "Grandes Pliegues"`, restos
  de pruebas del patrón "Otra… extensible" — limpieza opcional, no
  bloqueante).

**Consecuencia práctica**: la base está en buen estado para un E2E limpio
de MI AUDITORIA (Avatar, Pólizas, Crónicos, Autorizaciones, Flujo) contra
producción si se quiere verificar por UI real — hoy solo se verificó con
capturas de pantalla locales, no con datos reales. El esquema, funciones,
triggers y políticas RLS están intactos.

## Resultado de la verificación E2E en producción (2026-07-15)

Ejecutada por UI real (Claude in Chrome) contra `saludfamilia.vercel.app`,
con verificación cruzada por SQL en Supabase en cada paso. **Todos los
pasos PASAN:**

1. **Signup** (`alnp.alnp@gmail.com`): cuenta creada, una sola fila (guard
   de doble submit OK), mensaje de confirmación no-enumerante correcto,
   `email_confirmed_at` null hasta confirmar. **Sin household prematuro** —
   `ensureHousehold()` no corre hasta el login autenticado.
2. **Confirmación de correo + login**: el usuario confirmó desde su bandeja
   e inició sesión con su contraseña (Claude no ingresa contraseñas ni
   crea cuentas — esos pasos los hace el usuario).
3. **ensureHousehold / bug 403**: **el bug 403 sigue corregido**. Tras el
   login se creó exactamente un household + membership (rol owner), sin
   duplicados y sin error. Este era el punto crítico de la migración 0004.
4. **Paciente / Orden / Medicamento / Signos vitales**: cada creación
   persistió con todos los campos correctos y `household_id` consistente.
5. **Aislamiento RLS** (simulando el JWT de cada usuario en una transacción
   con rollback): el otro usuario (`dacn`) ve **0 filas** en patients,
   medical_orders, medications y vital_signs; el dueño (`alnp`) ve
   exactamente 1 de cada uno. Aislamiento bidireccional confirmado.

### Hallazgos menores durante el E2E (no bloqueantes)

- **`vital_signs.edad` se guarda null**: la app calcula la edad al vuelo
  desde `fecha_nacimiento` para mostrarla (paciente "36 años"), pero no la
  persiste en el registro de signos vitales. La columna existe y queda
  vacía. Revisar si se quiere poblar al guardar.
- **Advisors de seguridad (preexistentes, Supabase):**
  - `is_household_member(hid uuid)` era SECURITY DEFINER invocable vía
    RPC (WARN). **Resuelto en la auditoría P1 #8 del 2026-07-16**: se
    movió al schema `private`, fuera del API expuesto.
  - "Leaked password protection" desactivado en Auth (WARN) — se intentó
    activar el 2026-07-16: **requiere plan Pro**. Mitigación aplicada:
    mínimo de contraseña 8 caracteres.

## Recuperación de contraseña (P1 #4) — completada el 2026-07-15

Diseñada a alto nivel en la sesión del 2026-07-11, implementada y verificada
E2E en esta sesión. Commits `6674da3` (flujo completo) y `8e6736d`
(previsualizar contraseña, ver más abajo).

**Flujo implementado:**

1. Enlace "¿Olvidaste tu contraseña?" en la pantalla de login pasa el
   formulario a modo `recover` (solo pide correo).
2. `auth.requestPasswordReset(email, window.location.origin)` llama a
   `supabase.auth.resetPasswordForEmail`, y muestra un mensaje neutro
   ("Si el correo está registrado, te enviamos un enlace…") — mismo
   criterio anti-enumeración que el resto del flujo de auth.
3. El enlace del correo vuelve a la app con `#type=recovery` en la URL.
   Se captura en un `<script>` inline en el `<head>` de `index.html`
   (`window.__recoveryInUrl`), **antes** de que cargue el bundle de
   `supabase-js`, porque `createClient()` procesa y limpia ese hash de la
   URL apenas se importa — capturarlo dentro de `main.js` llegaba tarde.
4. El evento `PASSWORD_RECOVERY` de `onAuthStateChange` intercepta la
   sesión temporal que crea ese enlace y fuerza el modo `reset` (nueva
   contraseña + repetir), sin dejar que la app haga bootstrap con esa
   sesión.
5. Al confirmar, `auth.updatePassword(password)` llama a
   `supabase.auth.updateUser({ password })`, luego se cierra la sesión
   temporal (`signOut`), se limpia el hash de la URL y se vuelve al login
   con mensaje de éxito — así el usuario inicia sesión de nuevo con la
   contraseña nueva en vez de quedar logueado desde el enlace de
   recuperación.
6. Toda la lógica de estados (`signin` / `signup` / `recover` / `reset`)
   quedó centralizada en un objeto `AUTH_MODES` en `main.js`, que controla
   qué campos se muestran, textos y navegación entre modos.

**Verificación E2E**: flujo real de punta a punta con el correo del propio
usuario (`dacn.2026@gmail.com`) contra `saludfamilia.vercel.app` — solicitud
de recuperación, recepción del correo, click en el enlace, detección
correcta de la pantalla "Nueva contraseña", cambio de contraseña, y login
posterior con la contraseña nueva. Confirmado por SQL en Supabase (token de
recuperación generado y consumido) y por el salto fresco de
`last_sign_in_at` tras el login con la contraseña nueva.

### Previsualizar contraseña (mejora agregada durante la sesión, no planeada)

Durante la verificación E2E de recuperación, el usuario señaló que no
existía forma de previsualizar la contraseña antes de iniciar sesión, lo
que puede llevar a errores de tipeo constantes. Se agregó un botón de
mostrar/ocultar (íconos ojo / ojo tachado) en los campos de contraseña y
repetir contraseña del formulario de auth, reseteado a oculto cada vez que
cambia el modo del formulario. Verificado por el usuario en producción:
"la visualización está perfecta, super eficiente".

## Invitar miembros al household (P1 #6) — completada el 2026-07-15

Multiusuario real: varias cuentas (cada una con su propio login) comparten
el mismo household y ven/editan los mismos datos. Migración `0005` +
vista **Familia** en el sidebar (grupo Gestión). Commit `9c312df`.

- **Modelo**: el owner genera un **código de invitación** desde la app y
  lo comparte por el canal que quiera (sin infraestructura de correo). El
  invitado crea su cuenta normal y lo canjea en Familia → "Unirse a otra
  familia". Un solo uso, caduca a los 7 días, revocable.
- **Seguridad**: el código nunca se guarda en claro (solo hash sha256; el
  texto plano se muestra una única vez). Crear y canjear son funciones
  SECURITY DEFINER con autorización interna (`create_household_invitation`
  solo owner; `redeem_household_invitation` valida y marca usada de forma
  atómica). El cliente no tiene INSERT/UPDATE sobre la tabla.
- **Un household por usuario**: al canjear, el household propio del
  invitado se elimina solo si está completamente vacío; si tiene datos u
  otros miembros, el canje se bloquea sin quemar el código (el camino para
  mover datos es Exportar/Importar, ver abajo).
- **Roles**: owner invita/revoca/saca miembros y no puede borrarse a sí
  mismo; los members tienen CRUD completo de datos, pueden salir por su
  cuenta (al recargar se les crea una familia nueva vacía) y no pueden
  invitar. `household_members_with_email` expone el correo SOLO de
  co-miembros (auth.users no es accesible desde el cliente).
- **Verificación**: 19 casos de seguridad con JWT simulado + rollback, y
  E2E real en producción con el ciclo completo (alnp generó código → dacn
  canjeó → household viejo eliminado → dacn salió → familia nueva vacía),
  confirmado por SQL en cada paso.

## Exportar / Importar pacientes (pieza B) — completada el 2026-07-15

**El diseño cambió respecto al plan original** (llave guardada en el
servidor): ahora es un **archivo cifrado que se descarga al dispositivo**
(`.sfam`). El servidor nunca ve el contenido exportado ni la contraseña;
no hubo cambios de esquema ni RLS (todo por el API existente). Commit
`2118b64`. Verificado por el usuario en producción.

- **Exportar** (vista Familia): selección de pacientes (todos por defecto)
  + contraseña propia del archivo escrita dos veces (mín. 8; NO es la de
  la cuenta — el archivo puede compartirse). Incluye órdenes,
  medicamentos (con cadenas de versiones), signos vitales, adjuntos
  embebidos, y los médicos/centros referenciados por esas órdenes.
- **Cifrado**: AES-256-GCM, clave derivada por PBKDF2 (SHA-256, 310k
  iteraciones), en el navegador (Web Crypto). GCM autentica: contraseña
  incorrecta o archivo alterado fallan al descifrar. Sin la contraseña el
  archivo es ilegible; si se pierde, se exporta de nuevo.
- **Importar**: selector de archivo + contraseña → resumen del contenido →
  confirmación → se crea todo en la familia actual con IDs remapeados.
- **Flujo "Unirse a otra familia" con datos**: al tocar "Unirme" aparece
  una ventana que ofrece exportar primero y explica los pasos (exportar →
  vaciar manualmente los módulos → volver a canjear). Decisión del
  usuario: sin borrado masivo automático.

## Adjuntos en Supabase Storage (P1 #7) — completada el 2026-07-15

Migración `0006` + `src/lib/files.js`. Commit `b3161d4`. Los archivos de
las órdenes (orden/solicitud/autorización) dejaron de guardarse como
base64 dentro de jsonb: ahora van al bucket privado `adjuntos`, con rutas
`<household_id>/<order_id>/<slot>-<ts>-<nombre>` y políticas de Storage
que reutilizan `is_household_member()` — probadas con JWT simulado.

- Formato persistido nuevo: `{name, type, size, path}`; el viejo
  `{name, type, data}` se sigue **leyendo** (compatibilidad).
- Migración perezosa: editar una orden con adjuntos base64 los sube a
  Storage; importar un `.sfam` viejo también.
- Límite por archivo: 4MB → 10MB. Miniaturas y apertura con URLs firmadas
  (bucket privado). Limpieza del bucket al reemplazar/quitar/eliminar.
- Verificado por SQL que producción tenía **0 adjuntos base64** — no hubo
  datos que migrar. **Pendiente: E2E por UI en producción** (subir un
  archivo real a una orden y verlo).

## Auditoría de seguridad RLS (P1 #8) — completada el 2026-07-16

Migraciones `0007` (endurecimiento) y `0008` (índices). Commit `aa7d92d`.

**Hallazgos corregidos:**

1. `is_household_member()` movida al schema `private` (no expuesto por
   PostgREST): desaparece el WARN que motivó la auditoría. Las políticas
   la referencian por OID — flujo de invitaciones verificado intacto.
2. **FKs compuestas** `(col, household_id)` en órdenes/medicamentos/
   vitales/médicos: ya no se puede referenciar pacientes, médicos o
   centros de otra familia (antes era posible — sin fuga de lectura, pero
   con contaminación referencial). 0 violaciones preexistentes.
3. `households.created_by` era reasignable y otorga visibilidad
   permanente vía `households_select` (un ex-miembro podría retener
   acceso). Ahora solo `name` es actualizable (grants de columna).
4. Defensa en profundidad: revocado UPDATE en `household_members`,
   INSERT/UPDATE en `household_invitations`, y TODO acceso de `anon` a
   tablas de public.

**Aceptado y documentado** (comment on function): las 3 RPC definer del
sistema de invitaciones son intencionales. "Leaked password protection"
**requiere plan Pro** (la API lo rechaza en el gratuito) — pendiente si
se paga; como mitigación, mínimo de contraseña subido a 8 en Auth y en el
cliente (commit `884b428`).

**Matriz de pruebas** (todas pasan): 12 casos cross-tenant, FK compuesta
bloqueando referencias ajenas, created_by inmutable, escalada de rol
bloqueada, anon sin acceso, canje intacto, y regresión de los flujos
normales incluido el camino del bug 403 histórico.

## Prioridad P1.5 — Edición de interfaz (sesión 2026-07-16)

Tanda de ajustes de interfaz relevada en `docs/Plan_de_Avance_MVP.docx`.
**Completada casi en su totalidad esta sesión**, módulo por módulo, todo
verificado E2E en producción salvo donde se indica lo contrario.

- **Tema visual** (commit `4df95ff`): un solo control de modo claro/oscuro
  en el header, independiente de `ThemeEngine` (paleta por paciente).
  Eliminado el botón redundante de la tarjeta del paciente.
- **Ficha de paciente** (commit `2c9103c` + `986ff77`): nombre en 4 campos
  (primer/segundo nombre, primer/segundo apellido), dirección de
  residencia, contacto de emergencia estructurado (incluye parentesco
  desplegable, ampliado luego con más opciones), y pólizas de seguro
  adicionales (uno-a-muchos, tabla `patient_policies`, con "Otra" propio
  — ver nota de `extensibleCatalog.js` abajo). Migración `0009`.
- **Órdenes médicas** (commit `943dbd6`): vista de solo lectura por
  defecto al expandir una orden; navegación por etapas con alerta de
  confirmación antes de editar una etapa anterior a la actual; filtro
  combinado por etapa y especialidad; alta rápida de médico/centro médico
  sin salir del flujo; sección "Historia clínica" (antes "Archivo PDF de
  la orden") acepta subir fotos directamente. **Verificado E2E en
  producción por el usuario** ("Verifique E2E, todo ok en ordenes").
- **Medicamentos** (commit `41c4211`): campo "Dosis" → "Dosis diaria";
  Frecuencia reemplazada por las 5 opciones fijas del plan (Una vez al
  día · Dos veces al día o cada 12h · Tres veces al día o cada 8h ·
  Cuatro veces al día o cada 6h · A demanda); nueva sección "Horarios de
  toma" con dos columnas (hora + dosis de ese horario), filas
  auto-generadas según la frecuencia, primer horario editable y los
  siguientes recalculados automáticamente al cambiarlo — **decisión
  explícita del usuario: cambiar el horario base siempre recalcula todos
  los siguientes**, incluso sobre ediciones manuales previas (no cambiar
  esto sin volver a confirmar con el usuario). Vía de administración
  ahora incluye "Vía sonda" fija y "Otra" extensible. Migración `0010`
  (conversión de `horarios` de `text[]` a `jsonb`, remapeo conservador de
  frecuencias viejas — solo se reinterpretan los valores con equivalencia
  clara; el resto queda intacto para revisión humana).
- **Médicos** (commit `97c2115`): Especialidad con "Otra" extensible;
  nuevo campo "Número de tarjeta profesional" debajo del nombre.
  Migración `0011`.
- **Patrón "Otra… extensible" — helper compartido** (`src/lib/
  extensibleCatalog.js`): un único módulo (`catalogOptionsHtml`,
  `resolveCatalogValue`, constante `OTRA_VALUE`) reutilizado por
  Medicamentos (Vía de administración), Médicos (Especialidad) y, desde
  el **commit `6ef6bbc`** (2026-07-16), también por Pólizas (Ficha de
  paciente) — los tres módulos ya comparten una sola implementación, sin
  cambios de comportamiento para el usuario.
- **Cambio transversal — imágenes y documentos** (commit `d420668`):
  - Opción de tomar la foto directamente desde el navegador (`<input
    capture="environment">`) junto a cada campo de subir archivo, en las
    tres secciones de Órdenes y en Pólizas (Pacientes).
  - Toda foto subida o tomada (no solo en Órdenes) se convierte
    automáticamente a PDF de una sola página antes de guardarse
    (`files.processUploadFile()`), para no acumular adjuntos pesados. Un
    PDF subido directamente pasa sin tocar.
  - **Ítem original del plan completado** con el **commit `db4fc95`**
    (2026-07-16, sesión siguiente): visor de adjuntos en ventana
    sobrepuesta (`src/lib/viewer.js`), reemplazando el viejo
    `files.openAttachment()` (que abría una pestaña nueva). Barra
    superior fija con descarga y cierre, zoom 100–300% sin salir de la
    app, y arrastre para desplazar el documento ampliado. A 100% un PDF
    conserva su scroll nativo.
- **Bug de producción encontrado y corregido** (commit `fb4e042`,
  **relevante para cualquier trabajo futuro sobre adjuntos**): al guardar
  una orden con una foto recién convertida a PDF, Supabase Storage
  rechazaba la subida con "mime type application/octet-stream is not
  supported". Causa raíz: `dataUrlToBlob()` en `src/lib/files.js`
  parseaba el header de la data-URL con una regex que exigía
  `;base64` pegado al mime type (`^data:([^;]+);base64`), pero el
  `datauristring` real que produce jsPDF trae un parámetro intermedio
  (`data:application/pdf;filename=x.pdf;base64,...`) — la regex no
  matcheaba, el Blob quedaba tipado `application/octet-stream`, y
  `@supabase/storage-js` usa el `.type` real del Blob al subir (**ignora
  la opción `contentType`** cuando el payload es un Blob, confirmado
  leyendo su fuente). Fix: regex cambiada a `^data:([^;,]+)` (toma todo
  antes del primer `;` o `,`). Afectaba a **toda** conversión foto→PDF
  desde que se introdujo con Órdenes médicas — verificado con Playwright
  contra el formato real de jsPDF, no con un mock.
- Un segundo error reportado por el usuario tras el fix ("Failed to load
  module script… MIME type text/html") **no era un bug de código**: es
  el patrón clásico de chunk de Vite con nombre hasheado + rewrite SPA de
  Vercel — una pestaña con el `index.html` viejo intenta importar un
  chunk que ya no existe tras el deploy nuevo, y el rewrite catch-all
  devuelve HTML en vez de 404. Resuelto por el usuario con un hard
  refresh; sin cambio de código.

## Prioridad P2 — Calidad para el público (4/4 completadas, sesión 2026-07-16)

Sesión posterior al cierre de P1.5. Las cuatro tareas numeradas del plan
quedaron completadas:

- **P2 #9 — Responsive móvil** (commit `c9c3477`): a ≤768px el sidebar
  quedaba oculto por completo (`display:none`) **sin ningún reemplazo** —
  no había forma de cambiar de sección desde el teléfono, en una app que
  se usa sobre todo así. Se agregó un botón de menú en el header (solo en
  móvil) que abre el sidebar como panel superpuesto (drawer) con backdrop;
  se cierra al tocar el fondo o elegir una sección.
- **P2 #10 — Eliminar `SaludFamilia.html` legacy** (commit `1292cfb`): HTML
  monolítico de 207KB de una versión previa, no referenciado por nada
  (ni `index.html`, ni `vercel.json`, ni `package.json`). Eliminado —
  recuperable del historial de git si hiciera falta. README actualizado
  con el árbol de arquitectura real y las 11 migraciones que existían en
  ese momento (hoy son 15, ver más abajo).
- **P2 #12 — Aviso médico y de privacidad** (commit `d14ecbf`, nuevo
  `src/lib/legal.js`): texto simple acorde a lo que es el proyecto (uso
  familiar, no producto comercial). Cubre: no reemplaza atención médica
  profesional, dónde vive la información (Supabase, aislado por
  household), y el control del usuario sobre sus datos. Accesible desde
  un link en la pantalla de login (antes de autenticarse) y desde una
  card en la app.
- **P2 #11 — Estados vacíos y manejo de errores consistente** (commit
  `a515d18`): antes de este cambio cada módulo armaba su propio "empty
  state" a mano, con variantes inconsistentes (ícono envuelto o suelto,
  con o sin `h3`/`p`/botón), y la mayoría de los `render()` no tenían
  `try/catch` alrededor de sus llamadas a la API — un error de red dejaba
  la vista en blanco o con datos viejos, sin ningún aviso. Se agregó
  `src/lib/emptyState.js` (`emptyStateHtml()`/`errorStateHtml()`) como
  helper compartido y se aplicó en los ocho módulos con datos propios
  (Pacientes, Centros, Médicos, Medicamentos, Signos vitales, Órdenes,
  Dashboard, Familia): cada `render()` ahora captura errores de carga y
  muestra un estado de error con botón de reintento, y varios
  manejadores de acción (eliminar, suspender, abrir modal) que no tenían
  manejo de errores ahora sí lo tienen. También se blindó el enrutador
  de `main.js` (`goView()`/`setActivePatient()` invocaban el `render()`
  del módulo sin `await`/`.catch()`, así que una excepción no capturada
  dentro de un módulo quedaba como promesa rechazada silenciosa) y la
  carga inicial de pacientes en `bootstrapApp()`. Verificado con
  `npm run build` y capturas de Playwright de ambos estados (vacío y
  error) en modo claro y oscuro. Con esto se cierra P2 al 100%.

## MI AUDITORIA — Ficha de paciente y Órdenes médicas (completado 2026-07-16)

Backlog **independiente del plan original y de P1.5**, relevado
directamente por la usuaria tras usar la app en producción (título literal
del mensaje: "MI AUDITORIA"). Cubre 5 ajustes puntuales en Ficha de
paciente y una restructuración de 5 partes en Órdenes médicas — 10 tareas
en total, todas completadas y verificadas en esta sesión. Antes de
implementar se confirmaron explícitamente con el usuario tres decisiones
de diseño que no eran obvias a partir del pedido original (ver notas en
cada ítem de Órdenes #4 y Pacientes #5).

**Pacientes (5/5):**

- **#1 — Avatar**: foto de perfil subida y redimensionada en el cliente
  antes de guardar en Storage (bucket `adjuntos`); a diferencia de los
  adjuntos de órdenes/pólizas, **no** se convierte a PDF — se sube y
  muestra tal cual (`src/lib/avatar.js`). Migración `0012` (columna
  `patients.foto`, jsonb). Commit `f31e0ac`.
- **#2 — Parentesco**: se agregó la opción "Pareja/Cónyuge" al
  desplegable de contacto de emergencia. Commit `3dd0368`.
- **#3 — Pólizas**: nuevo campo de texto libre "Nombre de la
  aseguradora" — deliberadamente **no** se modeló como catálogo
  extensible "Otra…", porque es dato puntual de cada póliza, no una
  clasificación reutilizable entre pólizas del household. Migración
  `0013` (columna `patient_policies.aseguradora`). Commit `3dd0368`.
- **#4 — Modo vista**: ventana sobrepuesta de solo lectura al abrir la
  ficha del paciente (`src/lib/viewModeOverlay.js`), con barra superior
  fija que no se mueve al hacer scroll y botón Editar junto a Cerrar —
  mismo patrón que ya usaba Órdenes. Commit `2d95efa`.
- **#5 — Condiciones crónicas**: checkbox que habilita un desplegable
  "Añadir diagnóstico" en modo **manual** (código CIE10 ya conocido por
  el usuario). **Decisión tomada con el usuario**: por ahora solo carga
  manual — la búsqueda por código/nombre contra el catálogo CIE10 (PDF
  de la OPS/PAHO en `ais.paho.org`) queda diferida a una fase futura, ya
  que ese documento no es consultable en vivo por código y requiere
  definir la fuente de datos. Migración `0014` (tabla nueva
  `patient_diagnoses`, uno a muchos). Commit `fdbd65a`.

**Órdenes médicas (5/5):**

- **#1 — Bloqueo de eliminación**: una orden solo puede eliminarse
  mientras sigue en la etapa A (recién creada, nada tramitado todavía);
  a partir de ahí solo es editable, con aviso desde el momento de
  creación. Se revalida contra el servidor al momento de eliminar, no
  solo el botón visible en la tarjeta (cubre el caso de otra
  pestaña/dispositivo que ya la haya hecho avanzar de etapa). Commit
  `d385a2d`.
- **#2 — Filtros expandidos**: etapa, especialidad, médico y tipo de
  orden, todos "extensibles" a la etapa activa — cada selector solo
  lista las opciones presentes entre las órdenes de la etapa
  actualmente filtrada (no todo el histórico), más un filtro de rango
  de fechas. Commit `30666f5`.
- **#3 — Modo vista**: mismo patrón de ventana sobrepuesta de solo
  lectura que Pacientes #4, con botón "Actualizar" que abre el
  asistente directo en la etapa pendiente en vez de en la etapa A.
  Commit `0114249`.
- **#4 — Restructuración de tipo de orden**: se elimina "Insumos
  Médicos" y "Medicamentos" pasa a llamarse
  "Medicamentos/Insumos/Terapias" (las órdenes existentes de ambos
  tipos se migraron automáticamente — se verificó contra producción
  antes de aplicar que ninguna de las 3 órdenes afectadas tenía cita ni
  autorización ya cargada, así que la fusión no perdió datos). Este
  tipo reemplaza la etapa "Autorización" (un registro) por
  "Autorizaciones": se declara un número de meses y se genera **una
  fila por mes** (número de autorización, fecha de inicio, fecha de
  vencimiento, cantidad, entregado) en la nueva tabla
  `order_authorizations`. Nunca pasa por la etapa Cita — queda
  bloqueada en la UI — y se finaliza con un botón manual "Marcar como
  finalizado" (reutiliza `estado_cita`, el mismo campo que ya
  significaba "proceso finalizado manualmente"). "Centro Médico" se
  renombra a "Proveedor" en este flujo (mismo directorio). **Dos
  decisiones tomadas con el usuario**: una fila por mes en vez de un
  dato meramente informativo, y botón manual de finalizado en vez de
  automático (ya que este tipo no pasa por Cita, que es lo que
  normalmente dispara Finalizado). Migración `0015` (columna
  `medical_orders.auth_meses`, tabla `order_authorizations`, ajuste de
  la función `order_stage()` con reglas propias para este tipo antes de
  las generales). Commit `67e7672`.
- **#5 — Pestaña Flujo**: nueva vista de línea de tiempo junto a
  "Lista" en Órdenes, que agrupa en un solo bloque las órdenes
  generadas el mismo día para el mismo médico tratante (mismo médico
  implica misma especialidad). En colapsado cada grupo muestra solo
  especialidad + fecha (línea de tiempo minimalista); al hacer click se
  expande y muestra el médico y el detalle de todo lo ordenado ese día,
  con acceso directo a cada orden. Commit `927cbd9`.

**Verificación**: cada ítem se probó con Playwright reconstruyendo el HTML
real de los componentes afectados (varios no están exportados y requieren
una sesión autenticada de Supabase para ejercitarse de punta a punta) y
tomando capturas de pantalla, **sin escribir datos de prueba en el
proyecto de Supabase de producción**. La migración `0015` se verificó
además contra los datos reales antes de aplicarse por SQL. Los 10 commits
se entregaron por bundles de git (ver nota en Infraestructura → GitHub) y
ya están fusionados en `origin/main` — confirmado por el usuario.

## Segunda auditoría rápida — Ficha de paciente (completada 2026-07-17)

Cuatro hallazgos que el usuario reportó tras una revisión rápida de la app
en producción (independiente del plan original, de P1.5 y de la primera
MI AUDITORIA). Los cuatro se resolvieron en la misma sesión, commit
`0215e0b`:

- **Recorte de imagen al subir**: la foto de perfil del paciente y el
  carnet de una póliza ahora pueden recortarse/encuadrarse antes de
  guardarse (antes se subían tal cual). Nuevo helper compartido
  `src/lib/imageCropper.js` — ventana sobrepuesta propia (mismo criterio
  que `viewer.js`: puede abrirse encima del modal de ficha de paciente,
  que sigue abierto detrás) con arrastre para encuadrar + botones de zoom
  (100%–300%, mismo lenguaje visual que el visor de adjuntos). El marco
  guía es circular para el avatar (salida cuadrada 480×480 — el círculo
  visual lo sigue aplicando el CSS al mostrarlo, como ya se hacía) y tipo
  tarjeta (aspecto 1.586) para el carnet de póliza (salida 1000px de
  ancho). Verificado con Playwright reconstruyendo el componente en
  aislamiento: se generó una imagen de prueba con marcadores de posición,
  se hizo zoom y arrastre, y se confirmó que el recorte final coincide
  exactamente con lo mostrado en el marco antes de guardar — en modo claro
  y oscuro.
- **Editar pólizas y diagnósticos**: antes solo se podían eliminar y
  volver a crear. Ahora cada ítem de la lista tiene un botón "Editar" que
  abre el mismo mini-formulario de alta, precargado, con botón "Guardar
  cambios". `api.savePatientPolicy()` ya soportaba upsert por id (RLS de
  UPDATE ya existía desde la migración `0009`); `patient_diagnoses` no
  tenía política de UPDATE porque el diseño original (migración `0014`)
  asumía que el único flujo era agregar/eliminar — se agregó
  `api.updatePatientDiagnosis()` y la **migración `0016`** con la política
  RLS correspondiente (mismo patrón que `patient_policies_update`).
  Verificada primero en una transacción con `set local role authenticated`
  + `request.jwt.claims` simulados y `rollback` (household member puede
  actualizar, un usuario de otro household no puede — 0 filas afectadas),
  y solo después aplicada a producción con `apply_migration`.
- **Carnet de póliza ya no se convierte a PDF**: cambio respecto a la
  decisión transversal de P1.5. Si el archivo elegido es una imagen, pasa
  por el recortador y se guarda como imagen; si ya es un PDF escaneado, se
  sube tal cual (sin recorte, no aplica). La visualización en ventana
  sobrepuesta (nunca pestaña nueva) ya estaba cubierta por el visor de
  adjuntos existente (`src/lib/viewer.js`) desde P1.5 — no hizo falta
  tocarlo.
- **Bug corregido — selector de "Tipo de póliza" atascado en SOAT**: al
  cambiar la opción elegida, el `<select>` se reconstruía desde cero (para
  mostrar/ocultar el campo "Especificar tipo" cuando se elige "Otra…") sin
  recordar cuál había sido la última elección real del usuario — el
  navegador volvía a marcar la primera opción de la lista (SOAT) en cada
  re-render. Ahora un estado explícito (`pendingPolicyTipo`) guarda el
  valor elegido y se pasa como `selected` en cada reconstrucción.

**Verificación**: `npm run build` limpio y pruebas de interacción con
Playwright contra el recortador en aislamiento (zoom, arrastre, cancelar
con Escape y con el botón, clamps de zoom en 100%/300%, verificación
pixel-por-pixel de que el recorte final coincide con el encuadre
mostrado). No se tocaron datos de pacientes reales en producción — la
única escritura contra producción fue la migración `0016` (aditiva, sin
efecto sobre filas existentes), verificada primero en una transacción con
rollback. El bundle con este commit (más los 3 pendientes de antes:
`b61a305`, `a515d18`, `01278e9`) se entregó al usuario para fusionar y
subir a `origin/main`.

## Tercera auditoría — Medicamentos (completada 2026-07-17)

Backlog que el usuario relevó sobre el área de Medicamentos tras usar la
app. Cinco frentes, todos completados en la misma sesión, commit `1dd9c8e`
+ migración `0017`:

- **Indicación** (columna `medications.indicacion`): campo de texto libre
  con la enfermedad o síntoma que trata el medicamento. Decisión explícita
  del usuario: texto libre, **no** enlazado al catálogo CIE10 de
  diagnósticos crónicos. Se muestra en la tarjeta ("Para: …").
- **Medicamento controlado** (columna `medications.controlado`, boolean):
  checkbox en el formulario. Los controlados se destacan con badge y
  acento rojo, y forman el primer grupo de la lista.
- **Usos de medicamentos "a demanda"** (tabla nueva `med_usage_events`,
  migración `0017`, RLS verificada con rollback antes de aplicar — misma
  metodología que las auditorías anteriores): cuando un medicamento tiene
  frecuencia "A demanda", aparece un botón **USADO** tanto en su tarjeta
  como en un widget nuevo del dashboard ("Medicamentos a demanda"). Al
  presionarlo se pide la razón del uso (obligatoria, con ejemplos tipo
  "subida de tensión 145/95, crisis convulsiva…") y se guarda un apunte
  con fecha y hora. La tarjeta muestra el conteo de usos y el último; los
  apuntes se pueden revisar y eliminar desde el modal. La tabla es
  append-only (sin política de UPDATE — corregir = eliminar y re-registrar).
- **Agrupación jerárquica de activos**: la lista de activos se divide en
  tres grupos en este orden — **Medicamentos controlados** → **Por
  horario** → **A demanda** — y dentro de cada grupo se ordena
  alfabéticamente. Un controlado va al grupo de controlados aunque sea
  también "a demanda" (igual conserva su botón USADO). Al final, un grupo
  **colapsable de inactivos** ("Inactivos / con seguimiento previo"). Por
  decisión del usuario se **conserva además** la sección de "Historial de
  versiones" existente (que agrupa por nombre y versión).
- **Unificación Órdenes → Medicamento**: al guardar una orden de tipo
  "Medicamentos/Insumos/Terapias" en la que se marcó como "entregado" un
  mes que antes no lo estaba (transición false→true en esa edición), se
  ofrece crear un nuevo medicamento. Si se acepta, se abre el formulario de
  medicamento precargado con el nombre = descripción de la orden, para el
  paciente de la orden. La detección compara contra un snapshot del estado
  "entregado" capturado al abrir el asistente (`authOriginalEntregado`).

**Verificación**: `npm run build` limpio y capturas de Playwright de la
agrupación completa (los tres grupos + inactivos colapsable), del widget
del dashboard y del modal de registro de uso, en el CSS real. La única
escritura contra producción fue la migración `0017` (aditiva), verificada
primero en transacción con rollback (miembro puede insertar/ver un uso,
usuario de otro household recibe "row violates row-level security policy").

## Cuarta auditoría — Signos Vitales (completada 2026-07-17)

Auditoría relevada por la usuaria sobre el módulo de Signos Vitales. **Se
hizo originalmente en otra conversación** que trabajaba sobre una copia
local separada; en esta sesión se revisó, se verificó su consistencia con
el estado actual del repo y se integró. Commit `a9753ff` + migración
`0018`.

- **Hora de la toma**: campo de hora en el formulario (además de la fecha)
  y columna "Hora" en el historial.
- **Edad automática**: antes se cargaba a mano y casi siempre quedaba
  vacía (hallazgo del E2E de P0). Ahora se calcula sola como los años
  cumplidos entre la fecha de nacimiento del paciente y la fecha del
  registro; el campo es de solo lectura y se recalcula al cambiar la fecha.
- **Peso por edad**: para pacientes **menores de 2 años** (a la fecha del
  registro) el peso se ingresa en **gramos**; de 2 años en adelante, en
  **kilogramos**. Internamente siempre se guarda en kg con 3 decimales
  (por eso `peso` pasó a `numeric(6,3)`); la conversión gramos→kg es
  automática al guardar. La unidad del input y la del historial cambian
  según la edad del registro.
- **Altura / Longitud tibial**: selector de modo de medición de estatura;
  la longitud tibial (cm) reemplaza a la altura cuando se elige ese modo
  (mutuamente excluyentes en un mismo registro — pensado para lactantes o
  casos donde no se puede medir de pie). El historial aclara "(tibial)".
- **Frecuencia respiratoria**: campo nuevo junto a la frecuencia cardíaca,
  visible también en el historial ("F.R.").

**Revisión y mejora en esta sesión**: se confirmó por `diff` que la otra
conversación no tocó nada más de `api.js` (los cambios de las auditorías
de Medicamentos y Pacientes siguen intactos). Como mejora, la frecuencia
respiratoria ahora también es **variable graficable** (tarjeta KPI +
gráfica de evolución), igual que la frecuencia cardíaca — antes solo
estaba en el formulario y la tabla. Verificado con `npm run build` y
captura de Playwright del formulario y del historial.

**Pendiente menor a confirmar con la usuaria** (heredado del diseño de la
otra sesión): si alguna vez se necesita registrar *altura y longitud
tibial a la vez* en un mismo control, el diseño actual no lo contempla
(son excluyentes).

## Historial relevante de sesiones previas (resumen)

1. **P0 #1 y #2 completadas**: variables de entorno en Vercel y
   Deployment Protection desactivado — el sitio público es accesible.
2. **Bug crítico de RLS corregido (migración `0004`)**: `ensureHousehold()`
   fallaba con 403 al crear el primer household. Fix: `(select auth.uid())
   = created_by` como condición adicional de la política
   `households_select`. **Re-confirmado sin regresión en el E2E del
   2026-07-15.**
3. **Bug de doble submit en signup corregido** (commit `78a7081`).
   Re-confirmado en el E2E.
4. **Mensajería de auth mejorada** (confirmación de signup, error de login
   no-enumerante). Re-confirmada en el E2E.
5. **P0 #3 — Verificación E2E en producción: COMPLETADA** el 2026-07-15
   (ver sección dedicada arriba).
6. **P1 #4 — Recuperación de contraseña: COMPLETADA** el 2026-07-15, junto
   con la mejora de previsualizar contraseña agregada durante su
   verificación E2E (ver sección dedicada arriba).
7. **P1 #6 — Invitaciones al household: COMPLETADA** el 2026-07-15 y
   verificada E2E en producción (ver sección dedicada arriba).
8. **Pieza B — Exportar/Importar pacientes: COMPLETADA** el 2026-07-15
   como archivo cifrado descargable, diseño distinto al original (ver
   sección dedicada arriba).
9. **P1 #7 — Adjuntos en Storage: COMPLETADA** el 2026-07-15 (E2E por UI
   pendiente) y **P1 #8 — Auditoría RLS: COMPLETADA** el 2026-07-16 (ver
   secciones dedicadas arriba).
10. **P1.5 — Edición de interfaz: COMPLETADA AL 100%** el 2026-07-16
    (tema visual, Ficha de paciente, Órdenes médicas, Medicamentos,
    Médicos, imágenes/documentos transversal incluido el lightbox, y
    Pólizas migrado al helper compartido), con un bug crítico de
    producción encontrado y corregido en el camino (ver sección dedicada
    arriba).
11. **P2 — Calidad para el público: 4/4 COMPLETADAS** el 2026-07-16
    (responsive móvil, limpieza de HTML legacy, aviso médico/privacidad,
    y estados vacíos/manejo de errores consistente — P2 #11, commit
    `a515d18`). Ver sección dedicada arriba.
12. **MI AUDITORIA — backlog adicional de Ficha de paciente y Órdenes:
    COMPLETADO** el 2026-07-16 (5 ajustes en Pacientes + restructuración
    de 5 partes en Órdenes, incluida la nueva tabla de Autorizaciones
    mes a mes y la pestaña Flujo). Ver sección dedicada arriba.
13. **Segunda auditoría rápida de Ficha de paciente: COMPLETADA** el
    2026-07-17 (commit `0215e0b` + migración `0016`): recorte de imagen
    compartido para avatar y carnet de póliza, pólizas y diagnósticos
    editables (no solo agregar/eliminar), el carnet ya no se convierte a
    PDF, y fix del selector de tipo de póliza que se atascaba en SOAT.
    Ver sección dedicada arriba.
14. **Tercera auditoría — Medicamentos: COMPLETADA** el 2026-07-17
    (commit `1dd9c8e` + migración `0017`): indicación (texto libre),
    medicamento controlado, registro de usos "a demanda" con botón USADO
    (tarjeta + dashboard) y razón obligatoria, agrupación jerárquica de
    activos (controlados/horario/demanda) con grupo colapsable de
    inactivos, y unificación Órdenes→Medicamento al marcar entregado. Ver
    sección dedicada arriba.
15. **Cuarta auditoría — Signos Vitales: COMPLETADA** el 2026-07-17
    (commit `a9753ff` + migración `0018`, hecha originalmente en otra
    conversación y revisada/integrada acá): hora de toma, edad automática,
    peso gramos/kg por edad, altura/longitud tibial, y frecuencia
    respiratoria (además graficable). Ver sección dedicada arriba.
16. **Pieza A de arquitectura diseñada a alto nivel (sin implementar)**:
    directorio público auditado de médicos y centros.

## Criterio de asignación de agentes de Claude

- **Fable** (máxima capacidad): seguridad RLS y migraciones de datos. Ya
  ejecutó: invitaciones (P1 #6), exportar/importar (pieza B), Storage
  (P1 #7) y la auditoría RLS (P1 #8). Del plan actual solo le queda la
  **pieza A (directorio público auditado)** y cualquier cambio futuro de
  RLS/esquema.
- **Opus**: flujos que cruzan varios archivos y estados. Sin ítems
  pendientes por ahora.
- **Sonnet**: tareas acotadas y mecánicas — configuración, UI, limpieza,
  contenido. P1.5, P2 y MI AUDITORIA ya están completas; sin ítems
  numerados pendientes del plan original.

## Próximos pasos sugeridos para quien retome

Con P1.5, P2 (4/4) y MI AUDITORIA completos, no queda ningún ítem
numerado del plan original pendiente. Lo que sigue es priorizar entre lo
no planeado / de mantenimiento:

1. E2E corto de adjuntos "clásico" en producción si no se ha hecho desde
   el cambio de imágenes/documentos: subir, ver, reemplazar y eliminar
   (verifica la limpieza del bucket), y de paso probar por UI real el
   backlog MI AUDITORIA (Avatar, Pólizas con aseguradora, Crónicos,
   Autorizaciones mes a mes, pestaña Flujo) — hasta ahora solo se
   verificó con capturas de pantalla locales, no contra producción.
2. Antes de tocar cualquier política RLS nueva, reproducir el error primero
   con `set local role authenticated` + `request.jwt.claims` simulados en
   una transacción con `rollback` (patrón usado con éxito en todos los
   E2E de seguridad de este proyecto). Ojo: `is_household_member` ahora
   vive en el schema `private`, y Supabase bloquea DELETEs directos sobre
   `storage.objects` (usar la API de Storage).
3. La base de producción está sin datos clínicos (ver "Estado de los
   datos" arriba) — buen momento para decidir si el próximo E2E genera
   datos de muestra a conservar o si se prueba y se limpia.
4. Pieza A de arquitectura (directorio público auditado) — diseño
   detallado con Fable cuando se decida priorizarla. El usuario confirmó
   que tiene sentido invertir en esto (espera más familias usando la
   app), pero el diseño de detalle (mecanismo de rol admin, si se
   rastrea la procedencia de copias del directorio público al privado)
   quedó sin cerrar — retomar solo si el usuario lo pide de nuevo.
5. Si algún día se pasa al plan Pro de Supabase: activar "Leaked
   password protection" (HaveIBeenPwned) en Auth — hoy rechazado por la
   API en el plan gratuito; el mínimo de contraseña ya se subió a 8.

Ver el plan de avance detallado y priorizado en
`docs/Plan_de_Avance_MVP.docx`.
