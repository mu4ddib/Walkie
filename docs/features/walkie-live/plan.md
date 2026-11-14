# Plan: Walkie Live — Importar proyecto local

Basado en `spec.md` (aprobada el 2026-11-14), ADR-0012 y ADR-0013. Issue padre: #162.

## Archivos a tocar

- `packages/schema/`:
  - `walkie-discovery-pack.schema.json` y `walkie-discovery.schema.json` (tarea 1);
  - `walkie-discovery-review.schema.json` (tarea 4);
  - `walkie-discovery-apply.schema.json` (tarea 6);
  - ejemplos en `examples/walkiepack/`.
- `apps/cli/Walkie.Cli/` y sus pruebas: herramienta .NET (tareas 2, 7 y 8).
- `apps/api/src/Walkie.Shared/`:
  - `WalkieSchemas` (schemas nuevos);
  - `SafeZip`, la lectura de zip con límites que sale de `ImportHandlers`.
- `apps/api/src/Walkie.Modules.Discovery/` (nuevo): fuentes, análisis, entidades, relaciones, evidencia y vínculos en el schema `discovery`.
- `apps/api/src/Walkie.Modules.Apps/`: `IAppWriter`, para crear un elemento del catálogo con id dado y borrarlo para compensar.
- `apps/web/src/discovery/`, `routes.tsx`, `pages/AppPage.tsx`, `pages/AppsPage.tsx`, `api/hooks.ts` y `test/fakeApi.ts`.
- `.github/workflows/ci.yml`: ejemplos del paquete y CLI.

## Tareas

Cada tarea cabe en una sesión y en un PR.

0. [x] Auditoría, spec, ADR-0012, ADR-0013 y correcciones de documentación.
1. [x] (#163) Contrato del `.walkiepack`: schemas del manifest y de entidades, relaciones y evidencia; tipos generados; ejemplos válidos; pruebas de que los válidos pasan y los inválidos fallan con la ruta del error; validación de los ejemplos en el CI.
2. [ ] (#164) CLI mínimo, `walkie analyze <carpeta> -o <archivo>.walkiepack`:
   - detectores de manifiestos (`.csproj`, `.sln`/`.slnx`, `package.json`), docker-compose y OpenAPI;
   - `.walkie/source.json`, exclusión de secretos y salida determinista;
   - valida su salida con `WalkieSchemas`.
3. [ ] (#165) API, recibir el paquete:
   - módulo Discovery con su migración;
   - `POST /api/apps/{appId}/sources/snapshots` con `dryRun`, límites, errores con ruta e idempotencia por hash;
   - integridad que el schema no expresa: claves únicas, evidencia y extremos existentes, `snippet` solo con `includeSnippets` y `stats` coherentes;
   - `SafeZip` en `Walkie.Shared`.
4. [ ] (#166) Revisión calculada:
   - `GET /api/snapshots/{id}/review`, que empareja por vínculo, por firma y por título (este último solo como sugerencia) y pagina;
   - `PUT /api/sources/{id}/bindings/{key}` para descartar, vincular o deshacer;
   - `GET /api/apps/{appId}/sources`.
5. [ ] (#167) Web, cargar y revisar:
   - «Importar proyecto local» en la página de la app (`dryRun` → resumen → confirmar);
   - página de revisión con filtros, motivo de la coincidencia, evidencia, descartar, vincular y vista previa.
6. [ ] (#168) Aplicar al catálogo: `POST /api/snapshots/{id}/apply` con `applyId`, crear o vincular elementos del catálogo, compensación, y desde un elemento del catálogo ver de qué evidencia viene.
7. [ ] (#169) Detectores ASP.NET Core y EF con Roslyn solo sintáctico:
   - Minimal APIs y controllers → `api`;
   - `DbContext`/`DbSet` → `database`;
   - proyectos → `service` y candidatos a módulo.
8. [ ] (#170) Detectores React y Angular:
   - prueba de concepto del parser de TS/TSX, con la decisión registrada en ADR-0013;
   - rutas → `screen` y candidatos a feature;
   - llamadas HTTP con URL literal → relación con `api`.
9. [ ] (#171) Aplicar módulos y features: módulo con su lienzo e interfaces `provides` y feature con lienzo inicial (pantallas y `ref`, ubicadas con `freeSpot`/`autoLayout`).
10. [ ] (#172) Reanalizar: diferencias con el análisis anterior (cambiado, ya no aparece; sin borrar nada) y «Crear app desde proyecto local» (`POST /api/sources/import`).
11. [ ] (#173) Rendimiento y E2E de punta a punta con Walkie analizándose a sí mismo; límites del paquete medidos.

Dependencias:
- 2 y 3 dependen de 1;
- 4 depende de 3;
- 5 depende de 4;
- 6 depende de 4 y 5;
- 7 y 8 dependen de 2;
- 9 depende de 6, 7 y 8;
- 10 depende de 9;
- 11 depende de 10.

## Pruebas

- **Unitarias:**
  - schemas con ejemplos válidos e inválidos;
  - detectores del CLI con proyectos ficticios (sin datos reales);
  - determinismo del paquete;
  - en Vitest, la revisión y la vista previa.
- **Integración:**
  - cada endpoint: 401, 404, 400 con ruta, 413, `dryRun` e idempotencia;
  - aplicar crea solo lo aprobado, no duplica, compensa y no cambia los lienzos existentes;
  - un descarte persiste entre análisis.
- **E2E:**
  - cargar un paquete, revisar, aplicar y abrir en el editor;
  - reanalizar sin perder lo confirmado.

## Estado

Última actualización: 2026-11-14 — tarea 0 hecha: auditoría de la fase 0, spec aprobada, ADR-0012 y ADR-0013 aceptados y documentación alineada con el código. Tarea 1 hecha: `walkie-discovery-pack.schema.json` (manifest) y `walkie-discovery.schema.json` (un solo `discovery.json` con entidades, relaciones y evidencia, en vez de tres archivos: la integridad entre ellas se valida en una pasada; ADR-0013 ajustado), ejemplos en `packages/schema/examples/walkiepack/` validados en el job `schema` del CI, `WalkieSchemas.Discovery`/`DiscoveryPack` con `DiscoveryPackSchemaTests` (ejemplos válidos, 23 variantes inválidas con su ruta de error, rutas con puntos que no suben de carpeta) y tipos en `apps/web/src/schema/`. Sigue: tarea 2 (CLI) o 3 (API), que ya pueden empezar en paralelo.
