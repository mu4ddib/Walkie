# Plan: Deshacer, rehacer y cajas de grupo que se ajustan

Basado en `spec.md` (2026-11-10). Sin issue: pedido directo del autor.

## Archivos a tocar

- `apps/web/src/store/history.ts` (instantáneas, agrupación y pila), `graphStore.ts` (`undo`, `redo`, `beginBatch`, `endBatch`, `growGroup`, `canUndo`/`canRedo`, suscripción que anota cada cambio).
- `apps/web/src/canvas/Canvas.tsx` (atajos, lote de arrastre, crecimiento al soltar, crear, duplicar y desde el inspector), `ZoomControls.tsx`, `canvasShortcuts.ts`, `canvas.css`.
- `apps/web/src/panel/GroupPanel.tsx` y `PropertiesPanel.tsx` (`onNest`).
- `apps/web/e2e/deshacer-y-cajas.spec.ts` (+ `seedCanvas` en `helpers.ts`) y `docs/`.

Sin cambios de schema ni de API: el historial es del editor y el crecimiento cambia `layout`, que ya existía.

## Tareas

1. [x] Historial en el store con agrupación por lote, por tarea y por campo; `dirty` según lo guardado.
2. [x] Atajos y botones; arrastre como un paso.
3. [x] `growGroup` y su uso al soltar, crear, duplicar, agrupar y desde el inspector.
4. [x] Pruebas, E2E y documentación.

## Pruebas

- Vitest: `history.test.ts` (acciones, lo guardado, misma tarea, lote, escribir en un campo, recorridos, límite, `growGroup` anidado y en la grilla).
- E2E: `deshacer-y-cajas.spec.ts` (crear, conectar, renombrar, mover, borrar, rehacer, volver a lo guardado; soltar y mover algo que sobresale en grupos anidados, deshacer el crecimiento, meter un grupo lejano desde el inspector, recargar).

## Estado

Última actualización: 2026-11-10 — feature completa. Limitaciones conocidas: el historial no sobrevive a recargar; los grupos no se achican solos; meter un grupo lejano desde el inspector agranda el de afuera hasta abarcarlo (no lo acerca).
