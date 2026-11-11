# Plan: Tours compactos

Basado en `spec.md` (pedido detallado del autor, 2026-11-11). Issue: #132.

## Archivos a tocar

- `packages/schema/walkie-graph.schema.json` (`step.id`) y tipos generados; `GraphValidator` y `ToursTests`.
- `apps/web/src/store/graphStore.ts`: identidad de pasos, `insertStep`, `duplicateStep`, `moveStepTo`, `duplicateTour`.
- `apps/web/src/panel/ToursSection.tsx` (pestañas y navegación) y `panel/tours/` (`TourList`, `TourDetail`, `StepList`, `StepItem`, `ActionMenu`, `toursUi`); `panel/TextField.tsx` (`autoGrow`, `labelHidden`).
- `apps/web/src/canvas/Canvas.tsx` (estado de interfaz, localizar, reproducción con el panel a la vista), `tours/TourPlayer.tsx` y `FlowPlayer.tsx` (área libre), CSS.
- E2E `tours-compactos.spec.ts` y los que usaban el editor anterior.

## Tareas

1. [x] Identidad de pasos y acciones del store; validación en la API.
2. [x] Lista compacta con búsqueda y «⋯»; detalle con cabecera fija y agregar fijo abajo.
3. [x] Pasos en acordeón, reordenar (arrastre y teclado), menú por paso, localizar.
4. [x] Reproducción con el panel a la vista y vuelta al estado de edición.
5. [x] Pruebas, E2E (30 pasos, pantalla baja, teclado) y documentación.

## Estado

Última actualización: 2026-11-11 — feature completa. Limitaciones: no se mueven pasos entre tours; en el enlace de solo lectura la lista de tours sigue siendo la anterior (sin resaltar el paso activo); con cientos de pasos la lista no se virtualiza.
