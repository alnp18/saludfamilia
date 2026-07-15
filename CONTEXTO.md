# SaludFamilia — Contexto del proyecto

_Última actualización: 2026-07-14_

## Qué es

Aplicación de gestión médica familiar. Multiusuario vía Supabase Auth, con
datos aislados por grupo familiar (`household`) mediante Row Level Security.
Frontend estático (Vite, sin framework) desplegado en Vercel.

## Objetivo actual

El MVP público (70% de funcionalidades CORE) está **desbloqueado y
accesible**. La base de datos de producción está **completamente limpia**
(0 usuarios, 0 registros) tras un borrado deliberado de las cuentas de
prueba usadas hasta ahora — ver detalle más abajo. El trabajo que sigue
tiene tres frentes, documentados con prioridad y agente recomendado en
`docs/Plan_de_Avance_MVP.docx`:

1. Verificación E2E formal contra producción, arrancando desde cero.
2. Una tanda extensa de ajustes de interfaz, ya relevada y lista para
   ejecutar módulo por módulo.
3. Dos piezas de arquitectura nueva (directorio público auditado y
   exportar/importar pacientes entre households), diseñadas a alto nivel
   pero sin implementar — requieren cuidado especial por tocar RLS.

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
  `ACTIVE_HEALTHY`, 4 migraciones aplicadas. **Base de datos vacía** (ver
  sección "Estado de los datos" abajo).
- **Vercel**: proyecto `saludfamilia` (team `alnp`). Deployment Protection
  desactivado. Variables `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`
  cargadas en el environment **Production** (pendiente replicar en
  Preview/Development si se necesitan a futuro). Cada push a `main`
  dispara deploy automático.
- **GitHub**: [alnp18/saludfamilia](https://github.com/alnp18/saludfamilia),
  rama `main`. **Sin conector MCP disponible para Claude en las sesiones
  hasta ahora**, pese a figurar "conectado" a nivel cuenta en
  Configuración → Conectores — revisar si esto cambió antes de asumir que
  sigue así. Mientras no esté disponible, todo cambio de código se aplica
  manualmente: editar con Notepad → verificar con `git status` → `add` /
  `commit` / `push` desde PowerShell local. Verificar deploys con
  `Vercel:list_deployments` en vez de leer el repo directamente.
- **Entorno local**: funcional. Node v24.18.0, npm operativo. `.env` con
  credenciales de Supabase (formato `sb_publishable_...`).

## Estado de los datos (importante para el próximo agente)

**La base de datos de producción está vacía a propósito**, tras una
limpieza deliberada el 2026-07-14. Se borraron 3 cuentas de prueba
generadas durante las sesiones de fixes y verificación E2E:

- `alnp.alnp@gmail.com` (cuenta principal de pruebas, tenía 3 pacientes
  cargados manualmente durante la verificación E2E en local)
- `dacn.2026@gmail.com` (cuenta usada para probar el bug de doble submit;
  quedó con **2 households duplicados**, sin pacientes — evidencia directa
  del bug de RLS corregido en la migración `0004`, antes del fix)
- `ing.bryamca@outlook.com` (cuenta de prueba en producción, nunca
  confirmó el correo)

Se verificó con un `count(*)` sobre todas las tablas (`auth.users`,
`households`, `patients`, `medical_orders`, `medications`, `vital_signs`,
`medical_centers`, `doctors`) que todo quedó en cero. **El esquema,
funciones, triggers y políticas RLS no se tocaron** — solo se borraron
filas de datos.

**Consecuencia práctica**: cualquier verificación E2E en producción a
partir de ahora debe arrancar creando una cuenta nueva desde cero. No hay
datos previos de los que depender ni con los que confundirse.

## Historial relevante de sesiones previas (resumen)

1. **P0 #1 y #2 completadas**: variables de entorno en Vercel y
   Deployment Protection desactivado — el sitio público es accesible.
2. **Bug crítico de RLS corregido (migración `0004`)**: `ensureHousehold()`
   fallaba con 403 al crear el primer household de un usuario nuevo,
   porque la política `households_select` (vía `is_household_member()`,
   función `STABLE`) no veía la membership creada por el trigger
   `on_household_created` dentro de la misma sentencia `INSERT ...
   RETURNING`. Fix: se agregó `(select auth.uid()) = created_by` como
   condición adicional de la política.
3. **Bug de doble submit en signup corregido**: sin guard de
   `submitBtn.disabled`, un doble clic disparaba dos `signUp()`
   concurrentes con el mismo correo → 500 por `duplicate key`. Fix en
   `main.js` (commit `78a7081`).
4. **Mensajería de auth mejorada**: confirmación al crear cuenta, error
   de login más útil sin distinguir "contraseña incorrecta" de "correo no
   confirmado" (deliberado, evita enumeración de cuentas).
5. **Relevamiento extenso de UI/UX** completado y volcado en
   `docs/Plan_de_Avance_MVP.docx` (sección P1.5), módulo por módulo:
   Auth, Header/tema, Pacientes, Órdenes, Medicamentos, Médicos.
6. **Dos piezas de arquitectura diseñadas a alto nivel (sin implementar)**:
   directorio público auditado de centros/médicos, y exportar/importar
   pacientes entre households (este último, el de mayor riesgo).

## Criterio de asignación de agentes de Claude

- **Fable** (máxima capacidad): seguridad RLS y migraciones de datos.
  Incluye: invitar miembros al household, migración a Supabase Storage,
  auditoría RLS pre-lanzamiento, directorio público auditado,
  exportar/importar pacientes.
- **Opus**: flujos que cruzan varios archivos y estados — verificación
  E2E con criterio, recuperación de contraseña.
- **Sonnet**: tareas acotadas y mecánicas — configuración, UI, limpieza,
  contenido. Incluye toda la sección P1.5 de edición de interfaz.

## Próximos pasos sugeridos para quien retome

1. Confirmar si el conector de GitHub ya está disponible en la nueva
   sesión (probar con una búsqueda de herramientas) — si lo está, se
   simplifica mucho el flujo de commits.
2. Decidir si arrancar por la verificación E2E en producción (P0 #3,
   ahora con base limpia) o por la tanda de UI (P1.5, ya lista).
3. Antes de tocar cualquier política RLS nueva, reproducir el error
   primero con `set local role authenticated` + `request.jwt.claims`
   simulados en una transacción con `rollback` — permite confirmar la
   causa raíz sin arriesgar datos reales.

Ver el plan de avance detallado y priorizado en
`docs/Plan_de_Avance_MVP.docx`.
