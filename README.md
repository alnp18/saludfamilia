# SaludFamilia

Aplicación de gestión médica familiar. Multiusuario vía Supabase Auth,
con datos aislados por grupo familiar (`household`) mediante Row Level
Security. Frontend estático (Vite, sin framework) desplegado en Vercel.

## Arquitectura

```
saludfamilia/
├── supabase/
│   └── migrations/
│       ├── 0001_init_schema.sql
│       ├── 0002_harden_functions.sql
│       ├── 0003_indexes_and_rls_perf.sql
│       ├── 0004_fix_households_select_rls.sql
│       ├── 0005_household_invitations.sql        ← invitaciones + canje + bajas
│       ├── 0006_storage_adjuntos.sql              ← bucket privado + políticas
│       ├── 0007_auditoria_rls_hardening.sql       ← FKs compuestas, schema private…
│       ├── 0008_indices_fks_compuestas.sql
│       ├── 0009_ficha_paciente_edicion.sql        ← nombre en 4 campos, pólizas…
│       ├── 0010_medicamentos_horarios_frecuencia.sql
│       └── 0011_medicos_tarjeta_profesional.sql
├── src/
│   ├── lib/
│   │   ├── supabaseClient.js    ← cliente único de Supabase
│   │   ├── auth.js              ← signUp/signIn/signOut + ensureHousehold()
│   │   │                          + requestPasswordReset/updatePassword
│   │   ├── api.js               ← única capa que habla con Postgres (mapeo snake_case↔camelCase)
│   │   ├── files.js             ← adjuntos en Storage (subir/firmar/borrar) +
│   │   │                          processUploadFile() (validación + foto→PDF)
│   │   ├── viewer.js            ← visor de adjuntos en ventana sobrepuesta
│   │   │                          (zoom 100–300%, arrastre, sin pestañas nuevas)
│   │   ├── exportImport.js      ← exportar/importar pacientes cifrado (.sfam)
│   │   ├── extensibleCatalog.js ← patrón "Otra… extensible" compartido
│   │   │                          (Pólizas, Vía de administración, Especialidad)
│   │   ├── inlineDirectory.js   ← alta rápida de médico/centro sin salir del flujo
│   │   ├── theme.js             ← ThemeEngine: paleta determinista por paciente
│   │   ├── icons.js             ← iconos SVG inline
│   │   ├── modal.js             ← showModal/closeModal/showToast compartidos
│   │   └── utils.js             ← helpers puros (fechas, escape HTML, avatares)
│   ├── modules/                 ← un archivo por vista/dominio: dashboard,
│   │                               patients, orders, meds, vitals, centers,
│   │                               doctors, family, header
│   ├── state.js                 ← estado global en memoria (usuario, household,
│   │                               paciente activo, preferencia claro/oscuro)
│   └── main.js                  ← auth screen + bootstrap + router + nav móvil
├── index.html
├── vite.config.js
├── vercel.json
└── package.json
```

## Modelo de datos

Cada usuario pertenece a uno o más `households` (grupos familiares) vía
`household_members`. Todas las tablas de dominio (`patients`,
`medical_orders`, `medications`, `vital_signs`, `medical_centers`,
`doctors`, `patient_policies`) tienen `household_id` y están protegidas
con RLS: un usuario solo puede leer/escribir filas de los households a
los que pertenece. FKs compuestas `(columna, household_id)` impiden
además referenciar pacientes/médicos/centros de otra familia.

El flujo de una orden médica (Orden → Solicitud → Autorización → Cita)
se calcula también en el servidor: la función SQL `order_stage()` y la
vista `medical_orders_with_stage`.

Los adjuntos (historia clínica, solicitud, autorización, carnets de
póliza) viven en el bucket privado de Storage `adjuntos`, con políticas
que reutilizan la misma función de pertenencia a household. Cualquier
foto subida o tomada con la cámara se convierte automáticamente a PDF
de una página antes de guardarse.

El patrón "Otra… extensible" (una lista con opciones fijas + lo que el
household ya agregó + una opción "Otra…" que suma la entrada al
catálogo) se reutiliza en Pólizas, Vía de administración y Especialidad
vía la tabla genérica `custom_catalog_options` y el helper
`src/lib/extensibleCatalog.js`.

## Cómo correr localmente

```bash
npm install
cp .env.example .env.local   # completar con tu anon key real
npm run dev
```

## Deploy

- **Supabase**: el esquema ya está aplicado al proyecto `saludfamilia`
  (`smbnogsvqaowfwqchuvy`). Si necesitas replicarlo en otro proyecto,
  aplica las migraciones de `supabase/migrations/` en orden con el CLI
  de Supabase o pegándolas en el SQL Editor.
- **Vercel**: importa este repo, configura `VITE_SUPABASE_URL` y
  `VITE_SUPABASE_ANON_KEY` como variables de entorno del proyecto, y
  Vercel detecta `vercel.json` automáticamente (build: `npm run build`,
  output: `dist`). Cada push a `main` dispara un deploy a producción.

## Estado del proyecto

El CRUD principal (autenticación con aislamiento por familia, pacientes,
órdenes médicas con etapas, medicamentos, signos vitales, centros
médicos, médicos, invitaciones multiusuario, exportar/importar cifrado,
adjuntos en Storage) está construido y verificado E2E en producción. El
detalle de qué está completo, en curso o pendiente se mantiene en
`CONTEXTO.md` y `docs/Plan_de_Avance_MVP.docx`, no en este README.
