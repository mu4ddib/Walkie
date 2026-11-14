# Plan: Walkie Live — Importar proyecto local

Basado en `spec.md` (aprobada el 2026-11-14), ADR-0012 y ADR-0013. Issue padre: #162.

## Archivos a tocar

- `packages/schema/`:
  - `walkie-discovery-pack`, `walkie-discovery`, `walkie-discovery-snapshot`, `walkie-discovery-binding`, `walkie-discovery-review`, `walkie-discovery-apply` y `walkie-discovery-apply-result` (tarea 1, ADR-0014);
  - ejemplos en `examples/walkiepack/`.
- `apps/cli/Walkie.Cli/` y sus pruebas: herramienta .NET (tareas 2, 7 y 8).
- `apps/api/src/Walkie.Shared/`:
  - `WalkieSchemas` (schemas nuevos);
  - `SafeZip`, la lectura de zip con límites que sale de `ImportHandlers`.
- `apps/api/src/Walkie.Modules.Discovery/` (nuevo): fuentes, análisis, entidades, relaciones, evidencia y vínculos en el schema `discovery`.
- `apps/api/src/Walkie.Modules.Apps/`: `IAppWriter`, para crear un elemento del catálogo con id dado y borrarlo para compensar.
- `apps/web/src/discovery/`, `routes.tsx`, `pages/AppPage.tsx`, `pages/AppsPage.tsx`, `api/hooks.ts` y `test/fakeApi.ts`.
- `.github/workflows/ci.yml`: ejemplos del paquete y CLI.

## Flujo completo y qué tarea lo cubre

| Etapa | Qué pasa | Tareas |
|---|---|---|
| CLI | `walkie scan` lee el proyecto sin ejecutar nada | 2, 7, 8 |
| `.walkiepack` | manifest + `discovery.json`, validados con `WalkieSchemas` | 1 (contrato), 2 (escritura) |
| Importación web | «Importar proyecto local» y «Crear app desde proyecto local»: `dryRun` → resumen (tecnologías, alcance, limitaciones) → confirmar | 3 (API), 5 (web), 10 (crear app) |
| Discovery Review | hallazgos por tipo y estado, evidencia, filtros y paginación | 4 (API), 5 (web) |
| Matching | vínculo previo → firma → título (solo sugerencia); descartar y vincular | 4 |
| Preview Changes | `apply?dryRun=true`: qué se crea, vincula y no cambia, con las validaciones de aplicar | 6 (catálogo), 9 (módulos y features) |
| Aplicación aprobada | bitácora, ids del cliente, escritura idempotente y compensación; nunca toca lienzos existentes ni borra | 6, 9 |
| Editor actual | lo creado se abre en el catálogo, el módulo o la feature con el editor de siempre; desde un componente se ve su evidencia | 6, 9 |
| Reanálisis | cambiado y ya no aparece, sin borrar | 10 |

## Puertas

- **Seguridad (bloqueo):** Walkie Live no se habilita para usuarios reales (piloto ni producción) hasta que exista autorización por app (ADR-0012). Hasta entonces, `Discovery:Enabled` apagado fuera de Development. Encenderlo con usuarios reales exige el ADR de esa autorización.
- **Compatibilidad:** cada tarea de la API que escribe (6 y 9) prueba que los lienzos existentes (contenido y `version`) y los elementos vinculados no cambian.

## Tareas

Cada tarea cabe en una sesión y en un PR.

0. [x] Auditoría, spec, ADR-0012, ADR-0013 y correcciones de documentación.
1. [x] (#163) Contratos y fundamentos de Discovery (ADR-0014):
   - schemas del paquete (manifest con capacidades y completitud; entidades, relaciones y evidencia con base observada o inferida y fingerprint) y de los registros de Walkie (snapshot, vínculo, revisión y operaciones);
   - `Walkie.Shared/Discovery`: `DiscoveryKeys`, `DiscoveryFingerprint`, `DiscoveryPackValidator` y `DiscoveryFormat` (versiones y migraciones);
   - ejemplos completo y parcial, y registros de la API, validados en el CI;
   - pruebas de schema, integridad, compatibilidad y versiones;
   - tipos generados en la web.
2. [x] (#164) CLI mínimo, `walkie scan [carpeta] -o <archivo>.walkiepack` (el nombre del comando pasó de `analyze` a `scan`):
   - detectores de manifiestos (`.csproj`, `.sln`/`.slnx`, `package.json`), docker-compose y OpenAPI;
   - `.walkie/source.json`, exclusión de secretos y salida determinista;
   - lector de YAML para compose y OpenAPI (candidato YamlDotNet, MIT; justificar en el PR);
   - valida su salida con `WalkieSchemas`.
3. [x] (#165) API, recibir el paquete:
   - módulo Discovery con su migración;
   - `POST /api/apps/{appId}/sources/snapshots` con `dryRun`, límites, errores con ruta e idempotencia por hash;
   - integridad que el schema no expresa: claves únicas, evidencia y extremos existentes, `snippet` solo con `includeSnippets` y `stats` coherentes;
   - `SafeZip` en `Walkie.Shared`;
   - todo el módulo detrás de `Discovery:Enabled` (404 apagado).
4. [x] (#166) Revisión calculada:
   - `GET /api/snapshots/{id}/review`, que empareja por vínculo, por firma y por título (este último solo como sugerencia) y pagina;
   - `POST /api/snapshots/{id}/apply` solo con `reject`, `link` y `reset`, para descartar, vincular o deshacer (las creaciones llegan en la tarea 6);
   - `GET /api/apps/{appId}/sources`.
5. [ ] (#167) Web, cargar y revisar:
   - «Importar proyecto local» en la página de la app (`dryRun` → resumen → confirmar);
   - página de revisión con filtros, motivo de la coincidencia, evidencia, descartar, vincular y vista previa.
6. [ ] (#168) Aplicar al catálogo:
   - `POST /api/snapshots/{id}/apply` con `applyId`; con `dryRun=true` es la vista previa;
   - bitácora `discovery.applies` (plan con ids antes de escribir; `pending` → `completed` o `compensated`), `IAppWriter.CreateCatalogItemAsync` con id dado y recuperación de una aplicación `pending`;
   - crear o vincular elementos del catálogo, sin tocar los vinculados ni los lienzos;
   - desde un elemento del catálogo, ver de qué evidencia viene.
7. [x] (#169) Detectores ASP.NET Core y EF con Roslyn solo sintáctico:
   - Minimal APIs y controllers → `api`;
   - `DbContext`/`DbSet` → `database`;
   - proyectos → `service` y candidatos a módulo.
8. [ ] (#170) Detectores React y Angular (hoy solo tecnologías por `package.json` y la limitación `frontend-semantics-not-analyzed`):
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

Última actualización: 2026-11-14 — tarea 0 hecha: auditoría de la fase 0, spec aprobada, ADR-0012 y ADR-0013 aceptados y documentación alineada con el código. Tarea 1 hecha (fase 1, contratos y fundamentos; ADR-0014): siete schemas (`walkie-discovery-pack`, `walkie-discovery`, `walkie-discovery-snapshot`, `walkie-discovery-binding`, `walkie-discovery-review`, `walkie-discovery-apply`, `walkie-discovery-apply-result`); `Walkie.Shared/Discovery` con claves normalizadas (`DiscoveryKeys`), fingerprints en JSON canónico (`DiscoveryFingerprint`), integridad (`DiscoveryPackValidator`: duplicados, referencias, orden, capacidades, parcialidad, fragmentos, estadísticas) y versiones (`DiscoveryFormat`: versión actual, migraciones, rechazo de versiones futuras antes del schema); ejemplos `tienda-demo` (completo) y `parcial` más los registros de la API, validados en el job `schema`; pruebas `DiscoveryPackSchemaTests`, `DiscoveryPackValidatorTests` y `DiscoveryCompatibilityTests` (los fingerprints de los ejemplos los calculó un script independiente y C# los reproduce); tipos en `apps/web/src/schema/`. Cambio de alcance: el `PUT .../bindings/{key}` de la spec se reemplazó por operaciones `reject`/`link`/`reset` en `apply`. Tareas 2 y 7 hechas (fase 2, analizador y CLI): `apps/cli` con `Walkie.Analyzer` (biblioteca: recorrido seguro, `Findings`, detectores `csproj`, `package-json`, `compose`, `openapi`, `aspnetcore-endpoints` y `efcore` con Roslyn solo sintáctico y YamlDotNet) y `Walkie.Cli` (`walkie scan`, `dotnet tool`). Cada paquete pasa `DiscoveryPackValidator` antes de escribirse. 46 pruebas sin Docker (proyectos ficticios en rutas con espacios, malformados, parciales, sin tecnologías, secretos, límites, escaneo repetido byte a byte, claves estables, CLI y el propio repo). Walkie analizado por sí mismo en `analisis-de-walkie.md`: 38 APIs (todas las de `apps/api/src`), 5 módulos, 5 bases, 2 recursos, 1 servicio y 56 relaciones. Job `cli` en el CI. Tarea 8: solo tecnologías del front; el parser de TypeScript sigue pendiente (ADR-0013). Tarea 3 hecha (fase 3, Discovery API): módulo `Walkie.Modules.Discovery` (schema `discovery`: `sources`, `snapshots`, `entities`, `relations`, `evidence`; migración `InitialDiscovery`; análisis inmutable; índice único por app, fuente y hash del archivo), `POST /api/apps/{appId}/sources/snapshots` (`dryRun`, duplicados por archivo o por contenido, 400 con la ruta, 413, 404, detrás de `Discovery:Enabled`) con la respuesta en el schema nuevo `walkie-discovery-upload`, `IDiscoveryReader` para leerlo, y `SafeZip` en `Walkie.Shared` (la importación del `.walkie` lo usa con su comportamiento de siempre). Pruebas con paquetes de la CLI real, incluido el del propio repo (guardado, consultado, reimportado sin duplicar, sin tocar lienzo ni catálogo). Tarea 4 hecha: `GET /api/snapshots/{id}/review` (revisión calculada, no guardada; precedencia changed → decisión → firma → título → new; `missing` solo con `MissingRules`: detectores que corrieron, alcance y limitaciones), coincidencias como candidatos y nunca vinculadas (firma desde el contrato con `DiscoveryKeys`; título normalizado como sugerencia; ambigüedad como `candidates`; solo de la misma app y sin destinos tomados por otro hallazgo), `POST /api/snapshots/{id}/apply` con `reject`, `link` y `reset` (validación previa, una transacción, `bindingVersion` con 409, idempotencia por `applyId` con bitácora `discovery.applies`, solo sobre el último análisis) y `GET /api/apps/{id}/sources`. Migración `BindingsAndApplies` (`discovery.bindings` con restricción de decisión y `ix_bindings_app_target`; `discovery.applies`). Contratos agregados: `candidates` en la revisión y `walkie-discovery-sources`. Rendimiento medido con 20.000 entidades, 5.000 decisiones y 200 elementos del catálogo: revisión con mediana de 130 ms por página; subida de 8 s, que bajó de 17 s al evaluar los schemas primero con `OutputFormat.Flag`. Sigue: tarea 5 (web, cargar y revisar).
