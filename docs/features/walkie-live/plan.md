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
5. [x] (#167) Web, cargar y revisar:
   - «Importar proyecto local» en la página de la app (`dryRun` → resumen → confirmar);
   - página de revisión con filtros, motivo de la coincidencia, evidencia, descartar, vincular y vista previa;
   - `GET /api/snapshots/{id}/evidence?entityKey=` (la evidencia y las relaciones de un hallazgo; la revisión solo trae `evidenceCount`).
6. [x] (#168) Aplicar al catálogo:
   - `POST /api/snapshots/{id}/apply` con `applyId`; con `dryRun=true` es la vista previa;
   - bitácora `discovery.applies` (plan con ids antes de escribir; `pending` → `completed` o `compensated`), `IAppWriter.CreateCatalogItemAsync` con id dado y recuperación de una aplicación `pending`;
   - crear o vincular elementos del catálogo, sin tocar los vinculados ni los lienzos;
   - desde un elemento del catálogo, ver de qué evidencia viene.
7. [x] (#169) Detectores ASP.NET Core y EF con Roslyn solo sintáctico:
   - Minimal APIs y controllers → `api`;
   - `DbContext`/`DbSet` → `database`;
   - proyectos → `service` y candidatos a módulo.
8. [x] (#170) Detectores React, Angular y Next.js:
   - prueba de concepto del parser de TS/TSX (escáner propio, tree-sitter, TypeScript en Jint), con la decisión y las mediciones en ADR-0013 y `apps/cli/poc/parser-typescript/`;
   - rutas → `screen` y candidatos a feature;
   - llamadas HTTP con URL verificable → relación con `api`;
   - navegación → `navigates`.
9. [x] (#171) Aplicar módulos y features: módulo con su lienzo e interfaces `provides` y feature con lienzo inicial (pantallas y `ref`, ubicadas con `autoLayout`).
10. [x] (#172) Reanalizar: diferencias con el análisis anterior (cambiado, ya no aparece; sin borrar nada) y «Crear app desde proyecto local» (`POST /api/sources/import`).
11. [x] (#173) Rendimiento y E2E de punta a punta con Walkie analizándose a sí mismo; límites del paquete medidos.

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

Última actualización: 2026-11-19 — tarea 0 hecha: auditoría de la fase 0, spec aprobada, ADR-0012 y ADR-0013 aceptados y documentación alineada con el código. Tarea 1 hecha (fase 1, contratos y fundamentos; ADR-0014): siete schemas (`walkie-discovery-pack`, `walkie-discovery`, `walkie-discovery-snapshot`, `walkie-discovery-binding`, `walkie-discovery-review`, `walkie-discovery-apply`, `walkie-discovery-apply-result`); `Walkie.Shared/Discovery` con claves normalizadas (`DiscoveryKeys`), fingerprints en JSON canónico (`DiscoveryFingerprint`), integridad (`DiscoveryPackValidator`: duplicados, referencias, orden, capacidades, parcialidad, fragmentos, estadísticas) y versiones (`DiscoveryFormat`: versión actual, migraciones, rechazo de versiones futuras antes del schema); ejemplos `tienda-demo` (completo) y `parcial` más los registros de la API, validados en el job `schema`; pruebas `DiscoveryPackSchemaTests`, `DiscoveryPackValidatorTests` y `DiscoveryCompatibilityTests` (los fingerprints de los ejemplos los calculó un script independiente y C# los reproduce); tipos en `apps/web/src/schema/`. Cambio de alcance: el `PUT .../bindings/{key}` de la spec se reemplazó por operaciones `reject`/`link`/`reset` en `apply`. Tareas 2 y 7 hechas (fase 2, analizador y CLI): `apps/cli` con `Walkie.Analyzer` (biblioteca: recorrido seguro, `Findings`, detectores `csproj`, `package-json`, `compose`, `openapi`, `aspnetcore-endpoints` y `efcore` con Roslyn solo sintáctico y YamlDotNet) y `Walkie.Cli` (`walkie scan`, `dotnet tool`). Cada paquete pasa `DiscoveryPackValidator` antes de escribirse. 46 pruebas sin Docker (proyectos ficticios en rutas con espacios, malformados, parciales, sin tecnologías, secretos, límites, escaneo repetido byte a byte, claves estables, CLI y el propio repo). Walkie analizado por sí mismo en `analisis-de-walkie.md`: 38 APIs (todas las de `apps/api/src`), 5 módulos, 5 bases, 2 recursos, 1 servicio y 56 relaciones. Job `cli` en el CI. Tarea 8: solo tecnologías del front; el parser de TypeScript sigue pendiente (ADR-0013). Tarea 3 hecha (fase 3, Discovery API): módulo `Walkie.Modules.Discovery` (schema `discovery`: `sources`, `snapshots`, `entities`, `relations`, `evidence`; migración `InitialDiscovery`; análisis inmutable; índice único por app, fuente y hash del archivo), `POST /api/apps/{appId}/sources/snapshots` (`dryRun`, duplicados por archivo o por contenido, 400 con la ruta, 413, 404, detrás de `Discovery:Enabled`) con la respuesta en el schema nuevo `walkie-discovery-upload`, `IDiscoveryReader` para leerlo, y `SafeZip` en `Walkie.Shared` (la importación del `.walkie` lo usa con su comportamiento de siempre). Pruebas con paquetes de la CLI real, incluido el del propio repo (guardado, consultado, reimportado sin duplicar, sin tocar lienzo ni catálogo). Tarea 4 hecha: `GET /api/snapshots/{id}/review` (revisión calculada, no guardada; precedencia changed → decisión → firma → título → new; `missing` solo con `MissingRules`: detectores que corrieron, alcance y limitaciones), coincidencias como candidatos y nunca vinculadas (firma desde el contrato con `DiscoveryKeys`; título normalizado como sugerencia; ambigüedad como `candidates`; solo de la misma app y sin destinos tomados por otro hallazgo), `POST /api/snapshots/{id}/apply` con `reject`, `link` y `reset` (validación previa, una transacción, `bindingVersion` con 409, idempotencia por `applyId` con bitácora `discovery.applies`, solo sobre el último análisis) y `GET /api/apps/{id}/sources`. Migración `BindingsAndApplies` (`discovery.bindings` con restricción de decisión y `ix_bindings_app_target`; `discovery.applies`). Contratos agregados: `candidates` en la revisión y `walkie-discovery-sources`. Rendimiento medido con 20.000 entidades, 5.000 decisiones y 200 elementos del catálogo: revisión con mediana de 130 ms por página; subida de 8 s, que bajó de 17 s al evaluar los schemas primero con `OutputFormat.Flag`. Tarea 5 hecha (web, cargar y revisar): «Importar proyecto local» en la página de la app (solo si la API responde las fuentes; con Discovery apagado no aparece), con el comando `walkie scan .` copiable, cómo instalar la CLI (herramienta .NET desde el repo) y la nota de privacidad, arrastrar o elegir el `.walkiepack`, validación en el navegador (extensión, 50 MB), vista previa (`dryRun`) con el resumen del análisis (fuente, analizador, fecha, commit, tecnologías, componentes por tipo, detectores, limitaciones, completo o parcial) y «Guardar análisis», que abre la revisión; si ya existía, «Abrir revisión». Sección «Proyectos locales» con cada fuente, su último análisis y «Revisar». Página `/apps/:appId/sources/:snapshotId`: cabecera, conteos por los siete estados (glifo y texto), filtros por tipo y estado en la URL, lista paginada en la API (50 por página, flechas del teclado) e inspector con el motivo de la coincidencia, los candidatos sin preselección, la decisión guardada, la evidencia del hallazgo (endpoint nuevo `GET /api/snapshots/{id}/evidence`, schema `walkie-discovery-evidence`) y vincular (coincidencia, candidato elegido u otro elemento del mismo tipo), descartar con nota y restablecer, siempre con vista previa y confirmación con el mismo `applyId`; un 409 avisa y recarga sin reintentar. Un análisis anterior se ve sin decidir. Crear sigue fuera (tarea 6): no hay botón. Pruebas: 26 de Vitest (`src/discovery/discovery.test.tsx`, con la API falsa de Discovery en `src/test/fakeDiscovery.ts`), 3 de integración del endpoint de evidencia y el E2E `walkie-live.spec.ts`, que analiza un proyecto ficticio con la CLI real. Tarea 6 hecha (aplicar al catálogo): `create` en `POST /api/snapshots/{id}/apply` para `api`, `service`, `database` y `resource`, con el id UUID v7 del cliente. Un solo plan para la vista previa y la aplicación (`PlanAsync`): último análisis, `bindingVersion`, decisión activa, id libre, reglas oficiales del catálogo (`IAppWriter.ValidateCatalogItem`), firma repetida (409: vincular), avisos (`inferred`, `logical-database`, `to-complete`, `same-title`) y el elemento tal como quedará (`created[].item`, armado por Apps). Bitácora: candado de sesión por `applyId`, `pending` con plan, pasos (`discovery.apply_steps`) y reserva de hallazgos (`bindings.pending_apply_id`), creación por `IAppWriter.CreateCatalogItemAsync` con id dado (idempotente), y vínculos + `completed` en una transacción; si falla, compensa borrando solo lo que nadie tocó (`DeleteUntouchedCatalogItemAsync`); si se cae, el mismo `applyId` o la siguiente aplicación sobre esos hallazgos la termina. Migración `ApplyJournal`. `GET /api/apps/{appId}/bindings?target=` (procedencia, schema `walkie-discovery-provenance`) y `targetMissing` en la revisión. Web: «Crear en el catálogo…» en el inspector (vista previa con el elemento, su id y avisos; «Confirmar y crear»; resultado con «Abrir en el catálogo»), «De dónde viene» en el detalle del catálogo, y la evidencia distingue ausencia (404) de error (reintentar). Pruebas: 30 de integración (`DiscoveryCatalogTests`: tipos, base de EF, inferido, inválidos, firma, idempotencia, doble clic, concurrencia, versión, análisis viejo, fallo, compensación segura, cuatro caídas, recuperación por otra aplicación, procedencia, edición y reimportación, destino borrado, lienzos intactos, mezcla de operaciones, seguridad), 13 de Vitest (`createInCatalog.test.tsx`) y el E2E de crear desde el análisis real. Sigue: revisión técnica y funcional antes de las tareas 8 y 9. Tarea 8 hecha (front):

- **Lector:** prueba de concepto con el mismo corpus (1.929 archivos con verdad conocida) y con `apps/web/src`. El escáner propio iguala a tree-sitter y al compilador de TypeScript en Jint en el corpus (31/31 rutas, 16/16 llamadas) y es el único sin errores falsos ni falsos positivos en código real. Tarda 0,48 s, contra 1,0 s y 28,4 s. Se elige en ADR-0013.
- **Detectores:** `nextjs`, `react-router`, `angular-router`, `frontend-http` y `frontend-features`, y `package-json` suma cada app de front como `service`.
- **Qué es pantalla:** una ruta con componente; un componente sin ruta no. Las rutas siguen `children`, `index`, `lazy`, `loadChildren` (también NgModules con `forChild`) y `loadComponent`, y las constantes importadas.
- **Llamadas:** van desde la pantalla cuyo componente llama, o desde la app, a la misma clave de API que el backend.
- **Candidatos a feature:** por carga diferida (media) o por recurso, una lista y su detalle (baja), con sus pantallas y APIs como miembros.
- **Limitaciones nuevas:** `dynamic-http-url`, `external-http-url`, `lazy-routes-unresolved`, `next-pages-api` y `frontend-routes-not-found`. Un detector sin nada que mirar queda `ran` con su motivo.
- **Walkie analizado:** 11 de sus 11 rutas no comodín como pantallas, 9 navegaciones y 3 candidatos. Sus llamadas van por `request()` con una URL armada en tiempo de ejecución y quedan como limitación.
- **Pruebas:** 33 nuevas de la CLI (escáner, React, Next.js, Angular standalone y NgModules, HTTP, atribución por componente, features, monorepo, parcial, archivo roto, identidad y determinismo) y 2 de integración (un paquete de front se sube y se revisa; lo decidido que desaparece se marca sin borrar).

**Cierre de la tarea 8** (ADR-0014, decisiones del 2026-11-15):

- **Identidad con la app (`formatVersion` 1):** `screen:<ámbito>:<ruta>` y `feature:<ámbito>:<nombre>`, con `app` en la entidad. El ámbito es la carpeta de la app (`.` en la raíz) o el que fija el equipo en `.walkie/source.json` (`apps`). Renombrar el paquete no cambia nada; mover la carpeta sí, salvo que se fije el ámbito. Ya no existe `ambiguous-route`: la misma ruta en dos apps son dos pantallas.
- **APIs:** la clave no cambia; si dos servicios publican la misma, limitación `ambiguous-api`.
- **Migración 0 → 1 (`FormatV1`):** asigna la app por la evidencia; si no es inequívoca, rechaza el paquete y pide reanalizar. La versión 0 queda congelada en `packages/schema/walkiepack/v0/` con sus ejemplos.
- **Decisiones guardadas con claves v0:** con una sola contraparte pasan a la clave nueva al subir el análisis (sin `changed` ni `missing` falsos; `decidedKey` conserva la vieja para la procedencia). Con varias, no se reasignan: la revisión las muestra (`legacyBinding`) y una persona decide y restablece la vieja. Migración `DecidedKey`.
- **`skipped`:** solo cambió su descripción en el schema.
- **Pruebas:** 12 de la CLI (`AppScopeTests` y monorepo), 5 de integración (`DiscoveryAppScopeTests`: paquete v0 migrado igual que uno nuevo, v0 ambiguo rechazado, decisiones v0 movidas sin `changed`/`missing` falsos, ambiguas sin reasignar, sin contraparte = `missing`), 4 puras de la migración y los ejemplos congelados, 1 de Vitest (`legacyBinding`).

Tarea 9 hecha (crear módulos y features con su lienzo; ADR-0012):

- **API:** `create` de `module` y `feature` en `POST /api/snapshots/{id}/apply`.
  - **Borrador (`CanvasDraft`, puro):**
    - feature: pantallas de una sola app técnica, navegación observada, llamadas a lo ya decidido o creado en la misma solicitud, y por la interfaz del único módulo que la ofrece;
    - módulo: sus APIs en el catálogo y sus interfaces `provides`;
    - fuera, con código y porqué: lo descartado, lo sin decidir, lo ambiguo (`ambiguous-api`).
  - **Ids y posiciones:** del cliente (`canvas`), validados (cubren el borrador, sin repetir ni encimar) y con `ICanvasWriter.Validate`.
  - **Nombre:** con la app técnica si ya hay uno igual («Pedidos (admin)») o el que elige la persona (`name`).
  - **Bitácora:** pasos catálogo → módulos → features; `created` (fila, `IAppWriter.CreateFeatureAsync` idempotente) y `saved` (lienzo e interfaces juntos, `ICanvasWriter.CreateInitialAsync`, nunca pisa uno existente). Compensación sin perder ediciones (`ICanvasWriter.DeleteUntouchedAsync`, `IAppWriter.DeleteUntouchedFeatureAsync`). Migración `ApplyContainers` (estado `saved`).
  - **Vínculos:** la feature y cada una de sus pantallas (`created` hacia la feature).
- **Web:**
  - «Crear feature…» y «Crear módulo…» en el inspector, con una vista previa: nombre editable, pantallas, a qué llama, conexiones, interfaces, lo que no entra y avisos; y «Crear también en el catálogo las APIs que faltan».
  - `initialCanvas.ts` da los ids y ubica con `autoLayout` (ahora con medidas, `LayoutMetrics`).
  - «Abrir la feature» o «Abrir el módulo»; «De dónde viene» en el lienzo de una feature (franja) y de un módulo (su franja).
- **Pruebas:**
  - 13 de integración (`DiscoveryCanvasTests`): feature con navegación y llamadas sin tocar otros lienzos; dos «Pedidos»; módulo con interfaces y feature que lo usa; tres caídas; compensación con y sin edición; reanalizar sin sobrescribir; lienzos mal armados.
  - 8 de Vitest (`initialCanvas.test.ts`, `createContainer.test.tsx`).
  - El E2E `walkie-live-lienzos.spec.ts`: monorepo, dos «Pedidos», módulo, feature con navegación, catálogo existente, API ambigua, interrupción de red, edición manual y reanálisis. Abre los lienzos en menos de 250 ms, y «Ver todo» corre a 60 cuadros sin tareas largas.

Tarea 10 hecha (reanalizar y crear app desde proyecto local; ADR-0012 y ADR-0014):

- **Comparación en la misma revisión** (`GET /api/snapshots/{id}/review`, sin otro motor de diferencias): el análisis anterior de la fuente (`previous`: id, fechas, completitud, VCS) y, por hallazgo, `change` (`added`, `modified` por fingerprint, `unchanged`), `needsReview` y `coverage`. Estado nuevo `unverified` («Sin cobertura»): decidido, ausente y sin cobertura suficiente para concluir (`MissingRules.WhyNot` da el motivo). Conteos `comparison` y filtros `change` y `needsReview=true`. La web solo muestra.
- **`POST /api/sources/import`** (multipart: `file`, `name`, `importId`; `dryRun`): valida todo antes de escribir, propone el nombre de la fuente (con « (2)» si está tomado) y crea la app vacía con el primer análisis. Bitácora `discovery.source_imports` (`importId` del cliente, `request_hash`, `app_id` generado antes de crear, `pending` → `completed`/`compensated`; un solo `pending` por fuente) con candado por `importId`. Un reintento devuelve la misma app (`existing`); una caída la retoma el mismo `importId` o la siguiente importación de esa fuente; un fallo antes del análisis borra la app solo si nadie la tocó (`IAppWriter.DeleteUntouchedAppAsync`), si no queda `pending` y se avisa. Migración `SourceImports`.
- **`GET /api/discovery`**: dice si Discovery está encendido (404 apagado), así la galería oculta la opción sin pedir una app.
- **Web:** «Crear app desde proyecto local» en la galería (`NewAppFromProjectDialog`, con `PackSteps` compartido con «Importar proyecto local»), «Cargar análisis nuevo» por fuente, comparación con chips que filtran, insignias por hallazgo y «Por qué no se concluye» en el inspector.
- **Auditorías:** A, «Ver todo» y el encuadre al abrir incluyen las etiquetas de las conexiones; B, `AlreadyCreated` solo se atribuye una fila del mismo usuario creada desde la bitácora; C, la compensación revisa el lienzo antes de borrar la feature.
- **Pruebas:** 15 de integración de la importación (`DiscoverySourceImportTests`), 9 de reanálisis (`DiscoveryReanalysisTests`), 1 de atribución (`DiscoveryCanvasTests`), 9 de Vitest (`newAppFromProject.test.tsx`), el E2E `walkie-live-reanalisis.spec.ts` (CLI real, corte de red tras crear, reanálisis con diferencias) y la comprobación de etiquetas en `walkie-live-lienzos.spec.ts`. Revisión comparada con 20.000 hallazgos: 224 ms la primera página; filtros 105 ms.

Tarea 11 hecha (validación integral, rendimiento y preparación para integrar; detalle en [`validacion.md`](validacion.md)):

- **Walkie analizándose a sí mismo** con métricas (910/400 archivos, 1,5 s, 46/46 APIs, 11/11 pantallas, 0 de 43 llamadas por `request()`) y el E2E completo `walkie-live-walkie.spec.ts`.
- **Defectos corregidos:**
  - una importación pendiente con la app tocada bloqueaba la fuente (`abandoned`, migración `SourceImportAbandoned`);
  - `ApplyJournal.Down` no se podía ejecutar;
  - la vista previa de un módulo sin APIs en el catálogo no tenía salida;
  - análisis simultáneos de la misma fuente daban 500 o bifurcaban la cadena;
  - tres colores de texto bajo 4,5:1.
- **Pruebas nuevas:** `DiscoveryNonDestructiveTests`, `DiscoveryLimitsTests`, `DiscoveryLoadTests` (concurrencia siempre; matriz con `WALKIE_BENCH=1`) y `DiscoveryMigrationTests`; un caso de integridad en `DiscoveryCanvasTests` y otro de vista previa en `DiscoveryCatalogTests`. `deshacer-y-cajas` espera la selección antes de `Supr`. E2E en WebKit con `WALKIE_BROWSER=webkit`.
- **ADR-0015** (propuesto): autorización por app, bloqueante para el piloto.

Sigue: revisión final de Walkie Live. Ver la recomendación en `validacion.md` §17.
