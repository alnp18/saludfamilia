# SaludFamilia — Contexto del proyecto

_Última actualización: 2026-07-15 (tras verificación E2E en producción)_

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
2. Una tanda extensa de ajustes de interfaz, ya relevada y lista para
   ejecutar módulo por módulo (P1.5, Sonnet).
3. Dos piezas de arquitectura nueva (directorio público auditado y
   exportar/importar pacientes entre households), diseñadas a alto nivel
   pero sin implementar — requieren cuidado especial por tocar RLS (Fable).

## Arquitectura

```
saludfamilia/
├── supabase/
│   └── migrations/
│       ├── 0001_init_schema.sql
│       ├── 0002_harden_functions.sql
│       ├── 0003_indexes_and_rls_perf.sql
│       └── 0004_fix_households_select_rls.sql
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

**La base de datos YA NO está vacía.** Tras la verificación E2E del
2026-07-15 se conservaron deliberadamente datos de muestra. Conteo actual:

- `auth.users`: **2**
  - `alnp.alnp@gmail.com` (id `c310a4a2-887d-47fe-840b-221c9deb746c`) —
    cuenta del E2E, correo confirmado. Household "Mi familia"
    (`f1196d77-f03f-40a7-b84c-36fc338cac36`), rol owner. Tiene el set
    completo de datos de prueba (ver abajo).
  - `dacn.2026@gmail.com` (id `09c80114-1114-4932-966d-ddd6f3d66c60`) —
    creada entre sesiones, correo confirmado, household propio, **sin
    pacientes**. (El plan viejo la daba por borrada; reapareció.)
- `households`: 2 · `household_members`: 2
- Datos de `alnp.alnp` (todos marcados como "prueba E2E"):
  - `patients`: 1 — "Prueba E2E Paciente" (1990-05-15, Masculino, O+,
    EPS Prueba, afiliado TEST-000123).
  - `medical_orders`: 1 — tipo Examen (etapa A + B/Solicitud completas;
    C/Autorización y D/Cita vacías por falta de centros/médicos).
  - `medications`: 1 — Metformina 850 mg, dos veces al día,
    horarios `["08:00","20:00"]`, vía Oral.
  - `vital_signs`: 1 — peso 70.5, altura 172, presión 120/80, temp 36.6,
    sat 98, glucosa 90, FC 72, perímetros cintura/cadera/brazo 85/95/30.
- `doctors`: 0 · `medical_centers`: 0 (directorios vacíos).

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
  - `is_household_member(hid uuid)` es SECURITY DEFINER e invocable vía
    `/rest/v1/rpc/is_household_member` por el rol `authenticated` (WARN).
    Es justo el punto a revisar en la auditoría RLS de Fable (P1 #8):
    revocar EXECUTE, pasar a SECURITY INVOKER, o sacarla del schema
    expuesto.
  - "Leaked password protection" desactivado en Auth (WARN) — activar el
    chequeo contra HaveIBeenPwned si se desea.

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
6. **Relevamiento extenso de UI/UX** en `docs/Plan_de_Avance_MVP.docx`
   (sección P1.5), módulo por módulo.
7. **Dos piezas de arquitectura diseñadas a alto nivel (sin implementar)**:
   directorio público auditado y exportar/importar pacientes.

## Criterio de asignación de agentes de Claude

- **Fable** (máxima capacidad): seguridad RLS y migraciones de datos.
  Incluye: invitar miembros al household, migración a Supabase Storage,
  auditoría RLS pre-lanzamiento (empezar por el WARN de
  `is_household_member`), directorio público auditado, exportar/importar
  pacientes.
- **Opus**: flujos que cruzan varios archivos y estados — recuperación de
  contraseña (la verificación E2E ya está hecha).
- **Sonnet**: tareas acotadas y mecánicas — configuración, UI, limpieza,
  contenido. Incluye toda la sección P1.5 de edición de interfaz.

## Próximos pasos sugeridos para quien retome

1. Con el E2E en producción ya cerrado, el frente más "listo para ejecutar"
   es la tanda de UI (P1.5, Sonnet): empezar por el patrón transversal
   'Otra extensible' y el de imágenes ampliables/descargables, que se
   repiten en varios módulos.
2. Recuperación de contraseña (P1 #4, Opus) sigue pendiente de implementar.
3. Antes de tocar cualquier política RLS nueva, reproducir el error primero
   con `set local role authenticated` + `request.jwt.claims` simulados en
   una transacción con `rollback` (patrón usado con éxito en el E2E para
   verificar aislamiento sin arriesgar datos).
4. Decidir qué hacer con los datos de prueba conservados (dejarlos como
   muestra o limpiarlos antes del lanzamiento real).

Ver el plan de avance detallado y priorizado en
`docs/Plan_de_Avance_MVP.docx`.
