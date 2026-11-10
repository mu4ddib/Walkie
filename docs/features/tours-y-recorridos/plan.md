# Plan: Tours y recorridos separados

Basado en `spec.md` (aprobada 2026-11-10). Issue padre: #115.

## Archivos a tocar

- `packages/schema/walkie-graph.schema.json` (`tour.kind`) y tipos generados.
- `apps/web/src/store/graphStore.ts` (`addTour` con tipo, `addFlowTour`), `tours/flows.ts` (`tourKind`).
- `apps/web/src/panel/ToursSection.tsx` (pestañas, editores separados), `tours/SharedTours.tsx`, `canvas/Canvas.tsx`, `panel/panel.css`, `canvas/canvas.css` (inspector sin desborde).
- `apps/api`: `GraphValidator`, `MarkdownDocument` y pruebas.
- `apps/web/e2e/` y `docs/`.

## Tareas

1. [ ] Schema `tour.kind`, store y validación/export en la API. — issue #117
2. [ ] Inspector: pestañas «Tours» y «Recorridos» con editores separados (y en el enlace de solo lectura). — issue #118
3. [ ] Inspector sin desborde horizontal a cualquier ancho + E2E en 1440, 1024 y 768 px. — issue #119

## Pruebas

- Vitest: store (tipo al crear, inferencia de lienzos anteriores), `ToursSection` (pestañas, editores).
- Integración (API): tour `guide` con paso de conexión → 400; export con secciones separadas.
- E2E: crear un tour y un recorrido vacío en sus pestañas, volver a la misma pestaña tras seleccionar, inspector sin desborde.

## Estado

Última actualización: 2026-11-10 — plan aprobado.
