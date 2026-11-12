# Plan: Conexiones de ida y vuelta

Basado en `spec.md` (aprobada el 2026-11-12). Issue padre: #135.

## Archivos a tocar

- `apps/web/src/edges/ports.ts` (los extremos de una solicitud y sus respuestas en posiciones distintas del lado; dobleces escalonados por par), `edges/route.ts` (`routeAround` con un corredor desplazado por carril), `edges/KindEdge.tsx` (dibujar el carril también con `ports` y `route`; etiqueta compuesta).
- `apps/web/src/canvas/Canvas.tsx` (agrupar el par por `replyTo`, asignar carril y lugar de etiqueta).
- Pruebas: `ports.test.ts`, `route.test.ts`, E2E nuevo `conexiones-ida-y-vuelta.spec.ts`.

## Tareas

Cada tarea cabe en una sesión y en un PR.

1. [ ] (#138) Carriles paralelos: hoy `KindEdge` ignora `laneOffset` cuando hay `ports` o `route`. Calcular, para cada par solicitud/respuestas (`replyTo`), un desplazamiento perpendicular por carril que se aplique a los puertos, a los dobleces (`staggerBends`) y al corredor de `routeAround`. Pruebas unitarias: ningún segmento compartido en las cuatro disposiciones.
2. [ ] (#139) Etiquetas: colocar cada una sobre su trazo con separación `LABEL_GAP`; si el trazo es corto, una etiqueta compuesta con dos mitades seleccionables. E2E con cuatro disposiciones (cajas de etiquetas que no se intersectan, trazos sin segmentos compartidos) y capturas; CHANGELOG y `CLAUDE.md`.

## Pruebas

- Unitarias: `ports.ts` y `route.ts` con pares de ida y vuelta (horizontal, vertical, diagonal, rodeando una caja, grupo plegado como extremo, varias respuestas).
- Integración: no aplica (sin cambios en la API).
- E2E: `conexiones-ida-y-vuelta.spec.ts`; sin regresiones en `puertos-de-conexion.spec.ts` ni `flujos-legibles.spec.ts`.

## Estado

Última actualización: 2026-11-12 — spec aprobada, issues creados; sigue la tarea 1.
