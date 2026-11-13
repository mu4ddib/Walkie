# Plan: Módulos compartidos

Basado en `spec.md` (aprobada el 2026-11-13). Issue padre: #155. Decisión de arquitectura: ADR-0010.

## Archivos a tocar

- `packages/schema`: `walkie-graph.schema.json` (nodo `module`, `interfaces`, `fromInterface`/`toInterface`), `walkie-module-summary.schema.json` (nuevo), `walkie-package.schema.json` (`modules`).
- `apps/api/src/Walkie.Modules.Apps`: `Feature.Kind` + migración, listados sin módulos, `IFeatureDirectory.ModulesOfAppAsync` / `KindOfAsync`, `IAppWriter.CreateFeatureAsync` con id y tipo.
- `apps/api/src/Walkie.Modules.Canvas`: `ModuleHandlers` + `ModuleEndpoints` (resúmenes, crear, borrar, usos, reasignar, convertir), `GraphValidator` (integridad), `CanvasHandlers.ReferenceErrorsAsync` (módulo de la app, interfaces solo en módulos, ciclos).
- `apps/api/src/Walkie.Modules.Export`: `WalkiePackage`, `ExportHandlers`, `ImportHandlers` con módulos.
- `apps/web/src`: `modules/` (resúmenes, extracción, selector de interfaces, diálogo de conversión, franja del módulo), `nodes/ModuleNode.tsx`, `store/graphStore.ts` + `history.ts` (`interfaces`), `canvas/Canvas.tsx` y `Palette.tsx` (pestañas Componentes/Módulos), `panel/ModulePanel.tsx`, `panel/InterfacesSection.tsx`, `panel/EdgePanel.tsx`, `pages/ModulePage.tsx`, `pages/CatalogPage.tsx`, `tours/FlowPlayer.tsx`, `api/`.

## Tareas

Se implementan en una sola rama y un solo PR (pedido explícito: primera versión completa), con un commit por bloque.

1. [x] Schema y API: tipo `module`, resúmenes, crear, borrar, usos, validación (referencias, interfaces, ciclos).
2. [x] Lienzo: caja del módulo, catálogo con pestañas, selector de interfaces al conectar, inspector de la caja y de la conexión, respuestas por la misma interfaz.
3. [x] Editor del módulo: ruta, franja con «Volver» y «Ver usos», interfaces en el inspector, abrir desde una interfaz, contexto al volver.
4. [x] Convertir en módulo: plan puro (`extract.ts`), diálogo de cinco pasos, `POST …/modules/extract` con compensación e idempotencia, deshacer.
5. [x] Consistencia: eliminar o reasignar interfaces usadas, referencias pendientes, eliminar módulos, página del catálogo.
6. [x] Tours: recorrido interno de una interfaz y «Ver dentro del módulo» al reproducir.
7. [x] Exportar e importar con módulos.
8. [x] E2E de aceptación (módulo Usuarios en tres features, extracción con subgrupos y BD externa).

## Pruebas

- Unitarias (Vitest): store (interfaces, conexiones a interfaces, respuestas, duplicar, quitar caja con interfaz), `extract.ts` (subgrupos, BD externa, tours, `replyTo`, ramas), selector, inspector.
- Integración (xUnit): endpoints de módulos (401/400/404/409, OpenAPI), validación y ciclos, conversión (feliz, 409 con compensación, reintento idempotente), reasignar, export/import con módulos.
- E2E: `modulos-compartidos.spec.ts`.

## Estado

Última actualización: 2026-11-13 — tareas 1 a 8 hechas en un solo PR (pedido explícito).

- **API:** `Feature.Kind` + migración `FeatureKind`; `IFeatureDirectory` filtra módulos en sus listas y suma `ModulesOfAppAsync`; `IAppWriter.CreateModuleAsync` (id del cliente). Canvas: `ModuleHandlers`/`ModuleEndpoints` (resúmenes, crear, borrar con `force`, usos, reasignar, convertir con compensación e idempotencia), `ModuleReferences` (módulo de la app, pendientes aceptados, ciclos) y la integridad nueva en `GraphValidator`. Export: módulos en el `.walkie` (`modules/<id>/canvas.json`) y en la importación (reutilizar o crear, `moduleId` remapeado). `ModulesTests` (10 pruebas).
- **Web:** store (`interfaces` en el estado y el historial, `addModuleRef`, `setModuleDisplay`, `relinkModule`, `resizeNode`, `addInterface`/`updateInterface`/`removeInterface`, `replaceGraph`, interfaces en `connect`/`addResponse`/`updateEdge`); `ModuleNode`, `InterfacePicker`, pestañas del catálogo, `ModulePanel`, `ModuleEndsSection`, `InterfacesSection`, `ModulePage` con franja, `useOpenModule`, `extract.ts` + `ExtractModuleDialog`, `ModulesSection` en el catálogo, «Ver dentro del módulo» en `FlowPlayer`. `fakeApi` responde los módulos.
- **Pruebas:** Vitest (`store/modules.test.ts`, `modules/extract.test.ts`, `modules/modules.test.tsx`) y E2E `modulos-compartidos.spec.ts` (Usuarios en tres features con interfaces distintas, navegación con contexto, renombre, quitar y reasignar, duplicar, conversión de un grupo con subgrupos y BD externa con deshacer, recorrido interno).

**Pendientes resueltos (2026-11-13, segundo PR):**

- **Interfaces quitadas sin reescribir features:** el lienzo del módulo guarda `interfaceRedirects` (interfaz quitada → la que la reemplaza, o el módulo completo) y las features resuelven sus conexiones al leer el resumen (`redirects`). Quitar una interfaz es un cambio del módulo: se deshace con Ctrl+Z y llega a las features al guardarlo; ningún editor abierto recibe 409. Se quitó `POST /api/modules/{id}/interfaces/{id}/reassign`.
- **Punto de conexión por interfaz:** cada interfaz usada tiene su punto en la fila de la caja (`iface:<id>`); soltar ahí la elige sin selector y el trazo llega a esa fila (`computePorts` con `fixedTarget`).
- **Volver por cada nivel:** la URL lleva el rastro (`trail`) de la entrada del módulo de origen.
- **Contexto para IA, Markdown y PDF:** sección «Módulos» (interfaces con contrato y recorrido interno, contenido y conexiones internas), interfaz en cada conexión (`toInterface`/`fromInterface`) y vacíos `missing-module` y `pending-interface` (`IModuleDirectory` de Canvas).
- **Enlace de solo lectura:** trae los resúmenes de sus módulos y `GET /api/public/shares/{token}/modules/{id}` da el lienzo de uno que usa (`/s/:token/modules/:moduleId`, con «Volver»).
- **Formulario «Nuevo módulo»** del catálogo con el mismo layout que «Nuevo elemento».

**Limitación que queda:** el resumen de módulos se calcula leyendo los lienzos de la app (pensado para decenas de features).
