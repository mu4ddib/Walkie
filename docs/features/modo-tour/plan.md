# Plan: Modo tour con el personaje guía

Basado en `spec.md` (aprobada el 2026-11-07). Issue padre: #59.

## Archivos a tocar

- `packages/schema/walkie-graph.schema.json` — límites de `tour.name` y `step.note`, `additionalProperties: false`.
- `apps/api/src/Walkie.Modules.Canvas/Features/GraphValidator.cs` — clave del tour = `id`, `nodeId` de cada paso existe.
- `apps/web/src/store/graphStore.ts` — acciones de tours y cascada al borrar un nodo.
- `apps/web/src/panel/` — sección "Tours" del panel sin selección.
- `apps/web/src/tours/` (ya previsto en `apps/web/CLAUDE.md`) — guía animado (sprites de `packages/sprites/guia/`), modo tour.
- `apps/web/src/canvas/` — "Ver tour", lienzo de solo lectura, centrar y resaltar el nodo del paso.
- `apps/web/e2e/` — flujo del tour.
- `docs/roadmap.md` — cierre de la fase 3.

## Tareas

Cada tarea cabe en una sesión y en un PR. La 1 va primero; la 2 depende de la 1; la 3 depende de la 2; la 4 es independiente (solo sprites y web); la 5 depende de la 2 y la 4; la 6 cierra.

1. [ ] (#60) Schema e integridad: límites y `additionalProperties: false` en tours y pasos, tipos regenerados; `GraphValidator` valida clave del tour y `nodeId` de cada paso. Pruebas de integración (criterio 12).
2. [ ] (#61) Store: `addTour`, `renameTour`, `removeTour`, `addStep`, `updateStepNote`, `moveStep`, `removeStep`; `removeNode` quita los pasos de ese nodo. Pruebas en Vitest (criterios 3 y 4 en el store).
3. [ ] (#62) Panel "Tours": con nada seleccionado, lista de tours, "Nuevo tour", editor del tour (nombre, pasos con nodo y nota, subir/bajar, quitar, borrar tour) y "Ver tour" (criterios 1 a 3).
4. [ ] (#63) Guía animado: `tours/Guide.tsx` lee `packages/sprites/guia/manifest.json`, reproduce una animación (en bucle o una vez), se refleja al mirar al oeste, escala ×2 pixelado y respeta `prefers-reduced-motion`. Pruebas del componente (criterio 10 en parte).
5. [ ] (#64) Modo tour: lienzo de solo lectura sin paleta ni panel, barra con "Paso i de N", Anterior/Siguiente/Salir y teclado; centrar y resaltar el nodo, atenuar el resto; el guía camina, señala y habla con el globo de la nota (piensa en reglas); "Terminar" con celebración; "Ir a <feature>" en portales; al salir vuelve la vista anterior (criterios 5 a 10).
6. [ ] (#65) E2E: armar un tour de tres pasos (con una regla y un portal), guardar y recargar idéntico, recorrerlo con teclado y botones, terminar; marcar la fase 3 en el roadmap (criterios 5, 8, 9 y 11).

## Pruebas

- Integración (API): tour con clave distinta del id, paso a un nodo inexistente, nombre vacío o largo, nota larga (400); tour válido (200).
- Unitarias (Vitest): acciones de tours y cascada; panel de tours; guía (cuadros, reflejo, movimiento reducido); modo tour con el lienzo simulado.
- E2E (Playwright): el flujo de la tarea 6 en CI. El gate ("una persona nueva entiende el tour sin ayuda") se valida además con una prueba con alguien del equipo.

## Estado

Última actualización: 2026-11-07 — spec aprobada, sprites en el repo (sin `jump`), plan e issues creados. Sigue: tarea 1.
