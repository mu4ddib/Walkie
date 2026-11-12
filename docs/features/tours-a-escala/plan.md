# Plan: Tours a escala

Basado en `spec.md` (pendientes de tours-compactos pedidos por el autor, 2026-11-12). Issue: #133.

## Archivos a tocar

- `apps/web/src/store/graphStore.ts`: `moveStepToTour`.
- `apps/web/src/panel/ToursSection.tsx` y `panel/tours/` (`readOnly` en lista, detalle y pasos; «Mover a otro tour…»; ventana de la lista en `StepList` + `stepWindow.ts`).
- `apps/web/src/tours/SharedTours.tsx` y `canvas/Canvas.tsx` (panel compartido con la sección compacta y visible al reproducir; `insets`).
- CSS (`panel.css`, `canvas.css`, `share.css`) para la vista compartida y las pantallas bajas.
- Pruebas: Vitest del store y de la ventana; E2E `tours-a-escala.spec.ts` y `enlace-solo-lectura.spec.ts`.

## Tareas

1. [x] `moveStepToTour` en el store, con pruebas.
2. [x] «Mover a otro tour…» en el menú del paso.
3. [x] Modo de solo lectura de la sección y panel del enlace compartido con el paso activo.
4. [x] Lista de pasos con ventana desde 80 pasos.
5. [x] Cabecera y pie compactos en pantallas bajas.
6. [x] E2E, CHANGELOG y CLAUDE.md.

## Estado

Última actualización: 2026-11-12 — feature completa. Fuera de alcance: mover varios pasos a la vez y virtualizar la lista de tours.
