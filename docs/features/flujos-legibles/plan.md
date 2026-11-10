# Plan: Flujos legibles

Basado en `spec.md` (2026-11-10). Sin issue: pedido directo del autor.

## Archivos a tocar

- `packages/schema/walkie-graph.schema.json` y tipos generados.
- `apps/web/src/store` (acciones), `edges/` (etiqueta, sentido, carriles, pulso), `nodes/` (decisión, nota), `canvas/` (lienzo, menú, atajos, autoguardado), `panel/` (inspector de conexión, decisión, nota), `workspace/session.ts`.
- `apps/api`: `GraphValidator`, `MarkdownDocument` y pruebas.
- `apps/web/e2e/flujos-legibles.spec.ts` y `docs/`.

## Tareas

Entregadas juntas en un PR a pedido del autor.

1. [x] Schema, store y validación de la API (decisión, respuesta, solicitud, notas, duplicar).
2. [x] Conexiones legibles: etiqueta y sentido coherentes, carriles, pulso y previsualización.
3. [x] Inspector de conexiones por tipo de interacción; decisión y nota en el inspector.
4. [x] Notas adhesivas, duplicar (Ctrl+D y menú contextual).
5. [x] Autoguardado, estados de guardado y salida con cambios pendientes.
6. [x] Pulido (ayudas a tooltips y "?"), E2E y documentación.

## Pruebas

- Vitest: store (decisión, respuestas, duplicar, notas, `markSaved`), `edgeMeta` (sentido, etiquetas, previsualización), inspector, editor (autoguardado, error, respuesta tardía).
- Integración (API): `FlowDetailTests` (ida y vuelta, 400 por integridad) y export.
- E2E: `flujos-legibles.spec.ts` (¿Tiene cuenta?, intercambio con éxito y error, notas/duplicar/autoguardado/fallo); los existentes se adaptaron donde cambió un texto.

## Estado

Última actualización: 2026-11-10 — feature completa. Limitaciones conocidas: sin deshacer; el autoguardado se detiene ante un 409 hasta recargar; un nodo API documenta un solo endpoint; las etiquetas de carriles pueden tapar parte del trazo si las cajas están muy juntas; con más de tres conexiones entre el mismo par y cajas bajas, las etiquetas se abren más que los trazos.
