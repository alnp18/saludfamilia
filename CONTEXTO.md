# SaludFamilia — Contexto del proyecto

_Última actualización: 2026-07-11_

## Qué es

Aplicación de gestión médica familiar. Multiusuario vía Supabase Auth, con
datos aislados por grupo familiar (`household`) mediante Row Level Security.
Frontend estático (Vite, sin framework) desplegado en Vercel.

## Objetivo actual

El MVP público (70% de funcionalidades CORE) está **desbloqueado y
accesible**: los dos bloqueantes de lanzamiento (env vars y Deployment
Protection en Vercel) ya se resolvieron. Lo que queda por delante son tres
frentes separados: (1) verificación E2E formal contra producción, (2) una
tanda extensa de ajustes de interfaz ya relevados y documentados, y (3) dos
piezas de arquitectura nueva que requieren diseño cuidadoso antes de tocar
RLS. Ver el detalle completo y priorizado en
`docs/Plan_de_Avance_MVP.docx` (versión unificada, reemplaza la anterior).

## Arquitectura

```
saludfamilia/
├── supabase/
│   └── migrations/
│       ├── 0001_init_schema.sql
│       ├── 0002_harden_functions.sql
│       ├── 0003_indexes_and_rls_perf.sql
│       └── 0004_fix_households_select_rls.sql   ← aplicada esta sesión
├── src/
│   ├── lib/
│   │   ├── supabaseClient.js
│   │   ├── auth.js            ← signUp/signIn/signOut + ensureHousehold()
│   │   ├── api.js
│   │   ├── theme.js            ← ThemeEngine: paleta determinista por paciente
│   │   ├── icons.js
│   │   ├── modal.js
│   │   └── utils.js
│   ├── modules/                ← incluye header.js
│   ├── state.js
│   └── main.js                 ← auth screen + bootstrap + router
├── index.html / vite.config.js / vercel.json / package.json
```

## Infraestructura

- **Supabase**: proyecto `smbnogsvqaowfwqchuvy` (región `sa-east-1`),
  `ACTIVE_HEALTHY`, 4 migraciones aplicadas.
- **Vercel**: proyecto `saludfamilia` (team `alnp`). **Deployment
  Protection desactivado** (confirmado). Variables `VITE_SUPABASE_URL` y
  `VITE_SUPABASE_ANON_KEY` cargadas en el environment **Production**
  (pendiente replicar en Preview/Development si se necesitan a futuro).
  Cada push a `main` dispara deploy automático.
- **GitHub**: [alnp18/saludfamilia](https://github.com/alnp18/saludfamilia),
  rama `main`. **Sin conector MCP disponible en esta sesión de Claude** —
  se intentó habilitar pero no apareció como herramienta utilizable pese a
  figurar "conectado" a nivel cuenta en Configuración → Conectores. Todo
  cambio de código se aplica manualmente: editar con Notepad → verificar
  con `git status` → `git add` / `commit` / `push` desde PowerShell local.
  Claude verifica el resultado indirectamente vía Vercel (`list_deployments`,
  que muestra el commit SHA desplegado).
- **Entorno local**: completamente funcional. Node v24.18.0, npm operativo
  (se resolvió con `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy
  RemoteSigned`). `.env` con credenciales de Supabase (formato nuevo
  `sb_publishable_...`).

## Historial reciente relevante (sesión 2026-07-11)

1. **P0 #1 y #2 completadas**: variables de entorno cargadas en Vercel
   (Production) y Deployment Protection desactivado. Confirmado con
   `web_fetch` al sitio público y prueba manual en ventana in-private.
2. **Bug crítico de RLS corregido (migración `0004`)**: `ensureHousehold()`
   fallaba con 403 al crear el primer household de cualquier usuario nuevo,
   porque la política `households_select` dependía de `is_household_member()`
   (función `STABLE`), que no veía la membership creada por el trigger
   `on_household_created` dentro de la misma sentencia `INSERT ...
   RETURNING`. Se agregó `(select auth.uid()) = created_by` como condición
   adicional. Diagnosticado y verificado reproduciendo el error exacto
   antes/después del fix vía SQL simulando el contexto autenticado
   (`set local role authenticated` + `request.jwt.claims`).
3. **Bug de doble submit en signup corregido**: sin guard de
   `submitBtn.disabled`, un doble clic disparaba dos `signUp()` concurrentes
   con el mismo correo → 500 por `duplicate key` en
   `users_email_partial_key`. Fix en `main.js` (commit `78a7081`).
4. **Mejoras de mensajería de auth implementadas y desplegadas**:
   - Mensaje de confirmación al crear cuenta (revisar correo).
   - Mensaje de error de login más útil sin distinguir explícitamente
     "contraseña incorrecta" de "correo no confirmado" (decisión
     deliberada: evitar enumeración de cuentas registradas).
   - Se decidió **no** avisar si un correo ya tiene cuenta al intentar
     crear una nueva, por el mismo motivo de seguridad.
   - Durante la implementación se perdió accidentalmente el listener de
     `auth-switch-btn` al pegar el primer patch (el botón "Crear una"
     dejó de responder); corregido en un segundo commit (`7a015e4`).
     Lección: verificar `git status` después de cada edición manual con
     Notepad, ya que hubo dos casos en la sesión donde el archivo no se
     guardó antes de cerrarlo.
5. **Verificación de aislamiento de directorios**: confirmado que
   `doctors` y `centers` están aislados por household (misma política
   `is_household_member`), igual que `patients`. Relevante para la
   discusión de diseño del punto 7 más abajo.
6. **Relevamiento extenso de UI/UX** completado módulo por módulo
   (Auth, Header/tema, Pacientes, Órdenes, Medicamentos, Médicos) y
   volcado en el plan de avance actualizado, con formato dónde / qué pasa
   hoy / qué se espera + notas técnicas de esquema donde aplica.
7. **Dos piezas de arquitectura nueva diseñadas a alto nivel (sin
   implementar)**:
   - **Directorio público auditado** de centros médicos y médicos: se
     evaluó y descartó hacerlos públicos sin control; se acordó un diseño
     con rol de administradora, tablas públicas separadas, y flujo de
     "copiar al household propio" (no referencia compartida).
   - **Exportar/Importar pacientes entre households**: mover un paciente
     completo (datos, pólizas, órdenes, medicamentos, vitales, adjuntos)
     a otro household, mediante una llave + password específicos por
     exportación, cifrando el contenido. Identificado como el frente de
     mayor riesgo de todos los pendientes — es un puente controlado entre
     households, algo que el modelo RLS actual no contempla.
8. **Aclaración de privacidad de datos** conversada con la usuaria:
   distinción entre lo que se sube a Claude (infraestructura de
   Anthropic, sujeta a política de retención propia) y los datos reales
   de la aplicación (viven exclusivamente en Supabase, nunca pasan por
   Claude). Se reforzó la buena práctica ya en uso de probar con
   pacientes ficticios en vez de datos reales.

## Pendientes conocidos

Ver `docs/Plan_de_Avance_MVP.docx` (versión unificada) para el detalle
completo, priorizado y con agente recomendado por tarea. Resumen de los
frentes abiertos:

- **P0 #3**: verificación E2E formal contra producción (checklist ya
  validado en local, no repetido aún contra el sitio público desplegado).
- **P1**: recuperación de contraseña (diseño conversado, sin implementar),
  invitar miembros al household, migración de adjuntos a Supabase Storage,
  auditoría de seguridad RLS pre-lanzamiento (confirmar si el WARN de
  `is_household_member()` sigue vigente tras la migración `0004`).
- **P1.5 (nueva)**: tanda extensa de ajustes de interfaz, ya relevada y
  lista para ejecutar módulo por módulo — ver plan de avance.
- **P2**: responsive móvil, limpieza de legacy, estados vacíos/errores
  consistentes, aviso de privacidad y disclaimer médico.
- **Arquitectura futura (Fable, sin implementar)**: directorio público
  auditado y exportar/importar pacientes entre households.

## Criterio de asignación de agentes de Claude

- **Fable** (máxima capacidad): seguridad RLS y migraciones de datos —
  errores ahí son irreversibles o pueden filtrar datos médicos entre
  familias. Incluye ahora también: directorio público auditado y
  exportar/importar pacientes.
- **Opus**: flujos que cruzan varios archivos y estados — verificación
  E2E con criterio, recuperación de contraseña.
- **Sonnet**: tareas acotadas y mecánicas — configuración, UI, limpieza,
  contenido. Incluye toda la nueva sección P1.5 de edición de interfaz.

## Notas operativas para la próxima sesión

- Sin conector de GitHub disponible: seguir con el flujo manual
  (Notepad → `git status` para confirmar el guardado → `add`/`commit`/`push`).
  Verificar deploys con `Vercel:list_deployments` en vez de intentar leer
  el repo directamente (la búsqueda web no indexa bien archivos
  específicos de este repo).
- Antes de tocar cualquier política RLS, reproducir el error primero con
  `set local role authenticated` + `request.jwt.claims` simulados, tal
  como se hizo con el bug de `households_select` — permite confirmar la
  causa raíz sin arriesgar datos reales.

Ver el plan de avance detallado y priorizado en
`docs/Plan_de_Avance_MVP.docx`.
