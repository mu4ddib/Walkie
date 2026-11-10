# Plan: Puertos de conexión

Basado en `spec.md` (aprobada 2026-11-10). Issue padre: #116. Sin cambios de schema ni de API.

## Archivos a tocar

- `apps/web/src/edges/ports.ts` (lado de cada extremo y reparto por lado, puro), `edges/KindEdge.tsx`.
- `apps/web/src/nodes/PixelNode.tsx`, `nodes/GroupNode.tsx` (puntos en los cuatro lados), `canvas/Canvas.tsx` (`connectionMode`, cálculo de puertos), `canvas/canvas.css`.
- `apps/web/e2e/` y `docs/`.

## Tareas

1. [x] Cálculo de puertos: lado por extremo y reparto ordenado por lado (con ramas de decisión y grupos plegados). — issue #120
2. [x] Puntos de conexión en los cuatro lados y dibujo de las conexiones desde sus puertos. — issue #121
3. [x] E2E (varias conexiones por lado, cambiar de lado al mover) y documentación. — issue #122

## Pruebas

- Vitest: `ports.test.ts` (lado según posición, reparto y orden, pares con varias conexiones, ramas).
- E2E: un nodo con varias conexiones por un lado tiene puntos distintos; al mover la caja la conexión cambia de lado; los E2E de conexiones existentes siguen pasando.

## Estado

Última actualización: 2026-11-10 — feature completa. Criterio de lado: con hueco horizontal ≥ 48 px, izquierda/derecha (el lienzo se lee de izquierda a derecha); si no, arriba/abajo. Las conexiones que comparten lado de salida doblan cada una en su línea, escalonadas para no cruzarse. Limitaciones: no esquiva cajas que quedan en medio del trazo; en cajas muy bajas los puntos de un lado quedan cerca (los separan los dobleces).
