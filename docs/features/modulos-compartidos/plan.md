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

1. [ ] Schema y API: tipo `module`, resúmenes, crear, borrar, usos, validación (referencias, interfaces, ciclos).
2. [ ] Lienzo: caja del módulo, catálogo con pestañas, selector de interfaces al conectar, inspector de la caja y de la conexión, respuestas por la misma interfaz.
3. [ ] Editor del módulo: ruta, franja con «Volver» y «Ver usos», interfaces en el inspector, abrir desde una interfaz, contexto al volver.
4. [ ] Convertir en módulo: plan puro (`extract.ts`), diálogo de cinco pasos, `POST …/modules/extract` con compensación e idempotencia, deshacer.
5. [ ] Consistencia: eliminar o reasignar interfaces usadas, referencias pendientes, eliminar módulos, página del catálogo.
6. [ ] Tours: recorrido interno de una interfaz y «Ver dentro del módulo» al reproducir.
7. [ ] Exportar e importar con módulos.
8. [ ] E2E de aceptación (módulo Usuarios en tres features, extracción con subgrupos y BD externa).

## Pruebas

- Unitarias (Vitest): store (interfaces, conexiones a interfaces, respuestas, duplicar, quitar caja con interfaz), `extract.ts` (subgrupos, BD externa, tours, `replyTo`, ramas), selector, inspector.
- Integración (xUnit): endpoints de módulos (401/400/404/409, OpenAPI), validación y ciclos, conversión (feliz, 409 con compensación, reintento idempotente), reasignar, export/import con módulos.
- E2E: `modulos-compartidos.spec.ts`.

## Estado

Última actualización: 2026-11-13 — spec, plan y ADR-0010; empieza la tarea 1.
