# SaludFamilia — Contexto del proyecto

_Última actualización: 2026-07-16 (P1.5 — Órdenes médicas, Medicamentos,
Médicos e imágenes/documentos transversal)_

## Qué es

Aplicación de gestión médica familiar. Multiusuario vía Supabase Auth, con
datos aislados por grupo familiar (`household`) mediante Row Level Security.
Frontend estático (Vite, sin framework) desplegado en Vercel.

## Objetivo actual

El MVP público (70% de funcionalidades CORE) está **desbloqueado, accesible
y verificado E2E en producción** (ver sección de datos y de historial). El
trabajo que sigue tiene tres frentes, documentados con prioridad y agente
recomendado en `docs/Plan_de_Avance_MVP.docx`:

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
7. Ajustes de interfaz (P1.5, Sonnet) — **la mayoría COMPLETADA** el
   2026-07-16: tema visual, Ficha de paciente, Órdenes médicas,
   Medicamentos, Médicos, y el cambio transversal de imágenes/documentos
   (foto→PDF + captura por cámara). Detalle en la sección dedicada abajo.
   Quedan pendientes de esa tanda: el componente de ampliar/descargar
   imágenes (lightbox), P2, y migrar Pólizas (Pacientes) al helper
   compartido de catálogo extensible.
8. Pieza A de arquitectura (directorio público auditado de médicos y
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
│       └── 0011_medicos_tarjeta_profesional.sql
├── src/
│   ├── lib/
│   │   ├── supabaseClient.js
│   │   ├── auth.js            ← signUp/signIn/signOut + ensureHousehold()
│   │   │                        + requestPasswordReset/updatePassword
│   │   ├── api.js              ← + sección FAMILIA (miembros/invitaciones)
│   │   ├── files.js            ← adjuntos en Storage (subir/firmar/borrar) +
│   │   │                          processUploadFile() (validación + foto→PDF)
│   │   ├── exportImport.js     ← exportar/importar cifrado (.sfam)
│   │   ├── extensibleCatalog.js ← patrón "Otra…" compartido (Medicamentos,
│   │   │                           Médicos; Pólizas aún con su propia copia)
│   │   ├── theme.js            ← ThemeEngine: paleta determinista por paciente
│   │   ├── icons.js
│   │   ├── modal.js
│   │   └── utils.js
│   ├── modules/                ← incluye header.js y family.js
│   ├── state.js
│   └── main.js                 ← auth screen + bootstrap + router
├── index.html / vite.config.js / vercel.json / package.json
```

## Infraestructura

- **Supabase**: proyecto `smbnogsvqaowfwqchuvy` (región `sa-east-1`),
  `ACTIVE_HEALTHY`, 11 migraciones aplicadas (las últimas, `0009`–`0011`,
  del trabajo P1.5 de esta sesión). Plan gratuito — "Leaked password
  protection" NO se puede activar (requiere Pro); el mínimo de contraseña
  se subió a 8 caracteres en Auth (2026-07-16). PostgreSQL 17. Bucket
  privado de Storage `adjuntos` (10MB máx., imágenes y PDF). Tabla de
  catálogo compartida `custom_catalog_options` (household_id, categoria,
  valor) para el patrón "Otra… extensible".
- **Vercel**: proyecto `saludfamilia` (team `alnp`, id
  `team_upa18NsIqLYAoLBKzY61ioPk`). URL de producción:
  **https://saludfamilia.vercel.app** (alias también
  `saludfamilia-alnp.vercel.app` y `saludfamilia-git-main-alnp.vercel.app`).
  Deployment Protection desactivado. Variables `VITE_SUPABASE_URL` y
  `VITE_SUPABASE_ANON_KEY` en el environment **Production**. Cada push a
  `main` dispara deploy automático.
- **GitHub**: [alnp18/saludfamilia](https://github.com/alnp18/saludfamilia),
  rama `main`. **Sin conector MCP para Claude ni `gh` autenticado** en el
  sandbox de las sesiones — confirmado de nuevo el 2026-07-15. El repo es
  público, así que sí se puede clonar en modo lectura sin credenciales;
  para hacer push hace falta un token o que el usuario lo haga desde su
  PowerShell local (`git add` / `commit` / `push`). Verificar deploys con
  `Vercel:list_deployments`.
- **Navegador (Claude in Chrome)**: la extensión NO viene conectada por
  defecto. Para un E2E real por UI hay que pedirle al usuario que active la
  extensión y dé permiso al dominio `saludfamilia.vercel.app`. Con la
  ventana angosta el menú lateral se colapsa; conviene `resize_window` a
  ~1200×760 (1440 falla por exceder pantalla) para navegar con fiabilidad.
- **Entorno local**: funcional. Node v24.18.0, npm operativo. `.env` con
  credenciales de Supabase (formato `sb_publishable_...`).

## Estado de los datos (importante para el próximo agente)

**La base de datos YA NO está vacía.** Se conservaron deliberadamente los
datos de prueba generados en los E2E, tanto los de P1 (2026-07-15) como
los de la verificación de P1.5 hecha en producción esta sesión
(Órdenes/Medicamentos/Médicos e imágenes→PDF). Conteo real verificado por
SQL el 2026-07-16:

- `auth.users`: **2**
  - `alnp.alnp@gmail.com` (id `c310a4a2-887d-47fe-840b-221c9deb746c`) —
    household "Mi familia" (`f1196d77-f03f-40a7-b84c-36fc338cac36`), rol
    owner. Concentra **todo** el set de datos de prueba (ver abajo),
    incluidos los generados durante el E2E de P1.5.
  - `dacn.2026@gmail.com` (id `09c80114-1114-4932-966d-ddd6f3d66c60`) —
    su household (`2d3348a6-fe8c-4822-a87f-6024039da6bd`) sigue **vacío**
    (0 pacientes/órdenes/medicamentos/médicos/centros).
- `households`: 2 · `household_members`: 2
- Datos de `alnp.alnp` (todos "prueba E2E", crecieron durante la
  verificación de P1.5 — ya no son solo 1 registro por tabla como en el
  snapshot del 2026-07-15):
  - `patients`: **1** — "Prueba E2E Paciente" (1990-05-15, Masculino, O+,
    EPS Prueba, afiliado TEST-000123).
  - `medical_orders`: **18** — generadas probando el nuevo flujo de
    navegación por etapas con confirmación, el filtro por especialidad y
    el alta rápida de médico/centro desde la orden.
  - `medications`: **3** — probando el rediseño de Frecuencia/Horarios de
    toma (dosis por horario, recálculo automático) y Vía de
    administración extensible.
  - `doctors`: **4** · `medical_centers`: **4** — creados vía alta rápida
    desde Órdenes/Médicos durante el E2E (antes ambos directorios estaban
    vacíos).
  - `vital_signs`: **1** (sin cambios).
  - `custom_catalog_options`: **2** — `especialidad = "Endocrinologia"` y
    `via_administracion = "Grandes Pliegues"`, cargadas probando el
    patrón "Otra… extensible" en Médicos y Medicamentos.

**Consecuencia práctica**: si se necesita un E2E limpio de nuevo, o bien
usar un tercer correo, o limpiar estos datos primero. El esquema, funciones,
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
  extensibleCatalog.js`, nuevo): un único módulo (`catalogOptionsHtml`,
  `resolveCatalogValue`, constante `OTRA_VALUE`) reutilizado por
  Medicamentos (Vía de administración) y Médicos (Especialidad), en vez
  de reimplementar el patrón en cada módulo. **Pendiente (opcional, no
  bloqueante)**: Pólizas (Ficha de paciente) sigue con su propia
  implementación inline, previa a este helper — migrarla es limpieza de
  código, no un bug.
- **Cambio transversal — imágenes y documentos** (commit `d420668`):
  - Opción de tomar la foto directamente desde el navegador (`<input
    capture="environment">`) junto a cada campo de subir archivo, en las
    tres secciones de Órdenes y en Pólizas (Pacientes).
  - Toda foto subida o tomada (no solo en Órdenes) se convierte
    automáticamente a PDF de una sola página antes de guardarse
    (`files.processUploadFile()`), para no acumular adjuntos pesados. Un
    PDF subido directamente pasa sin tocar.
  - **Pendiente del ítem original del plan**: el lightbox/modal para
    ampliar cualquier imagen o documento con un botón de descarga
    (componente reutilizable único) **no se implementó** todavía — lo
    que se hizo esta sesión fue la captura por cámara y la conversión a
    PDF, que son un pedido distinto y posterior del usuario.
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
10. **P1.5 — Edición de interfaz: COMPLETADA casi en su totalidad** el
    2026-07-16 (tema visual, Ficha de paciente, Órdenes médicas,
    Medicamentos, Médicos, imágenes/documentos transversal), con un bug
    crítico de producción encontrado y corregido en el camino (ver
    sección dedicada arriba).
11. **Pieza A de arquitectura diseñada a alto nivel (sin implementar)**:
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
  contenido. Incluye toda la sección P1.5 de edición de interfaz (el
  frente grande restante) y las tareas P2.

## Próximos pasos sugeridos para quien retome

1. **Lightbox/descarga de imágenes y documentos** (ítem transversal del
   plan P1.5 aún no implementado): componente único reutilizable para
   ampliar y descargar cualquier adjunto, en vez de repetirlo por módulo.
2. E2E corto de adjuntos "clásico" en producción si no se ha hecho desde
   el cambio de imágenes/documentos: subir, ver, reemplazar y eliminar
   (verifica la limpieza del bucket) en los módulos que aún no se
   probaron explícitamente con el nuevo flujo (Pólizas en Pacientes).
3. Opcional, limpieza de código (no bloqueante): migrar Pólizas (Ficha de
   paciente) para usar `src/lib/extensibleCatalog.js` en vez de su
   implementación inline propia del mismo patrón "Otra".
4. Sección P2 del plan (responsive móvil, eliminar `SaludFamilia.html`
   legacy, estados vacíos/errores consistentes, aviso de privacidad).
5. Antes de tocar cualquier política RLS nueva, reproducir el error primero
   con `set local role authenticated` + `request.jwt.claims` simulados en
   una transacción con `rollback` (patrón usado con éxito en todos los
   E2E de seguridad de este proyecto). Ojo: `is_household_member` ahora
   vive en el schema `private`, y Supabase bloquea DELETEs directos sobre
   `storage.objects` (usar la API de Storage).
6. Decidir qué hacer con los datos de prueba conservados, que ya
   incluyen bastante volumen de E2E de P1.5 (18 órdenes, 3 medicamentos,
   4 médicos, 4 centros médicos) — dejarlos como muestra o limpiarlos
   antes del lanzamiento real.
7. Pieza A de arquitectura (directorio público auditado) — diseño
   detallado con Fable cuando se decida priorizarla.

Ver el plan de avance detallado y priorizado en
`docs/Plan_de_Avance_MVP.docx`.
