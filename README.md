# SaludFamilia

Aplicación de gestión médica familiar. Multiusuario vía Supabase Auth,
con datos aislados por grupo familiar (`household`) mediante Row Level
Security. Frontend estático (Vite, sin framework) desplegado en Vercel.

## Arquitectura

```
saludfamilia/
├── supabase/
│   └── migrations/          ← esquema real, ya aplicado al proyecto Supabase
│       ├── 0001_init_schema.sql
│       ├── 0002_harden_functions.sql
│       └── 0003_indexes_and_rls_perf.sql
├── src/
│   ├── lib/
│   │   ├── supabaseClient.js  ← cliente único de Supabase
│   │   ├── auth.js            ← signUp/signIn/signOut + bootstrap de household
│   │   ├── api.js              ← única capa que habla con Postgres (mapeo snake_case↔camelCase)
│   │   ├── theme.js            ← ThemeEngine: paleta determinista por paciente
│   │   ├── icons.js            ← iconos SVG Lucide inline
│   │   ├── modal.js            ← showModal/closeModal/showToast compartidos
│   │   └── utils.js            ← helpers puros (fechas, escape HTML, avatares)
│   ├── modules/                ← un archivo por vista/dominio (dashboard, patients, orders, meds, vitals, centers, doctors, header)
│   ├── state.js                ← estado global en memoria (usuario, household, paciente activo)
│   └── main.js                 ← auth screen + bootstrap + router
├── index.html
├── vite.config.js
├── vercel.json
└── package.json
```

## Modelo de datos

Cada usuario pertenece a uno o más `households` (grupos familiares) vía
`household_members`. Todas las tablas de dominio (`patients`,
`medical_orders`, `medications`, `vital_signs`, `medical_centers`,
`doctors`) tienen `household_id` y están protegidas con RLS: un usuario
solo puede leer/escribir filas de los households a los que pertenece.

El flujo de una orden médica (Orden → Solicitud → Autorización → Cita)
ya no se calcula solo en el cliente: la función SQL `order_stage()` y la
vista `medical_orders_with_stage` lo calculan también en el servidor.

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
  output: `dist`).

## Pendiente / próximos pasos

- **Archivos adjuntos** (orden en PDF, capturas de solicitud/autorización):
  hoy se guardan como base64 dentro de columnas `jsonb`. Para producción
  real conviene moverlos a **Supabase Storage** y guardar solo la ruta —
  las filas de `medical_orders` crecen rápido con base64 y no escalan bien.
- **Invitar miembros a un household**: el esquema ya soporta N usuarios
  por household (`household_members`), pero falta la UI para invitar a
  otro correo y que se una a un household existente en vez de crear uno
  nuevo al registrarse.
- **Confirmación de correo**: si el proyecto Supabase tiene activada la
  confirmación de email, `signUp()` no deja sesión activa hasta que el
  usuario confirme — hoy el mensaje de error genérico no lo explica.
- Sin conector de GitHub disponible al momento de generar este proyecto,
  así que el repo no se creó ni se comiteó automáticamente: hay que
  subir esta carpeta a `github.com/<tu-usuario>/saludfamilia` a mano
  (`git init && git add . && git commit -m "init" && git push`).
