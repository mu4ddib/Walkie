# Plan: Recorridos y grupos anidados

Basado en `spec.md` (2026-11-10). Sin issue: pedido directo del autor. ADR-0006.

## Archivos a tocar

- `packages/schema/walkie-graph.schema.json` (`group.parentId`, `stickyNote.groupId`, `groupNesting`, pasos con `edgeId`/`removedEdge`) y tipos generados.
- `apps/web/src/store/hierarchy.ts` (jerarquía pura e inferencia), `graphStore.ts` (acciones).
- `apps/web/src/tours/flows.ts`, `flowPlayback.ts`, `flowText.ts`, `FlowPlayer.tsx`.
- `apps/web/src/canvas/Canvas.tsx` y `canvas.css`, `nodes/GroupNode.tsx`, `edges/KindEdge.tsx`, `panel/ToursSection.tsx`, `GroupPanel.tsx`, `EdgePanel.tsx`.
- `apps/api`: `GraphValidator`, `MarkdownDocument` y pruebas.
- `apps/web/e2e/recorridos-y-grupos.spec.ts` y `docs/`.

## Tareas

Entregadas juntas en un PR a pedido del autor.

1. [x] Schema, jerarquía explícita, inferencia para lienzos anteriores y validación en la API.
2. [x] Plegar, mover y meter/sacar a cualquier profundidad, con indicación de pertenencia y sin ciclos.
3. [x] Conexiones contra el contenedor visible más externo.
4. [x] Recorridos: selección múltiple, crear, orden sugerido, editor (continuaciones, desde el lienzo, avisos).
5. [x] Reproducción con fases, controles, velocidad, encuadre y expansión temporal de grupos.
6. [x] Pasos con conexiones eliminadas, export, E2E y documentación.

## Pruebas

- Vitest: `hierarchy.test.ts` (tres niveles, plegados combinados, mover, ciclos, recargar, inferencia y ambigüedad), `flows.test.ts` (orden sugerido con request/response, ramas, repetición, saltos, conexiones eliminadas), `flowPlayback.test.ts`, `ToursSection.test.tsx`.
- Integración (API): `GroupsTests` (anidados, ciclos, nota en grupo), `ToursTests` (pasos por conexión, repetidos, eliminados, 400) y `MarkdownExportTests`.
- E2E: `recorridos-y-grupos.spec.ts` (grupos anidados de punta a punta, lienzo anterior, recorrido de 8 pasos con request/response y decisión, segundo recorrido con la otra rama, reproducción con grupo plegado, conexión eliminada, tour clásico, recargar). `WALKIE_CAPTURES=<carpeta>` guarda capturas.

## Estado

Última actualización: 2026-11-10 — feature completa. Limitaciones conocidas: sin deshacer; meter algo en un grupo no agranda su caja; la sugerencia de orden se omite si la búsqueda supera 20 000 combinaciones; durante la reproducción solo se despliegan los grupos del paso activo (los demás participantes se ven en su grupo plegado).
