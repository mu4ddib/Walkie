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

**Limitaciones pendientes:** reasignar o borrar una interfaz reescribe las features guardadas (un editor abierto en una de ellas recibe 409 y recarga); quitar una interfaz se reasigna en el servidor al confirmar, pero la interfaz desaparece del módulo solo al guardarlo; la conexión llega a la caja (no hay un punto de conexión por interfaz); volver de un módulo anidado regresa un solo nivel; el contexto para IA, el Markdown y el PDF muestran la caja del módulo sin su detalle; un enlace de solo lectura muestra la caja pero no abre el módulo; el resumen de módulos se calcula leyendo los lienzos de la app (pensado para decenas de features).
