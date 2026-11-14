# Plan: Fluidez del lienzo

Basado en `spec.md`.

## Tareas

1. [x] Banco de rendimiento reproducible (`apps/web/perf`): lienzos pequeño, habitual y exigente; escenarios de cámara, desplazamiento, zoom, arrastre, deshacer, selección, escritura, conexiones, recorridos, guardado y navegación; perfil de CPU legible.
2. [x] Cámara única (`canvas/camera.ts`, `useCamera.ts`) en el lienzo, el modo tour, los recorridos y el mapa.
3. [x] Identidad estable de nodos y conexiones; jerarquía, obstáculos, etiquetas y textos con índices y cachés; contenido diferido.
4. [x] Lista larga de pasos con `ResizeObserver`; hueco reservado para imágenes; resúmenes de módulos sin refetch al guardar.
5. [x] Pruebas (cámara, caché, jerarquía, índice espacial, E2E de fluidez) y docs.

## Estado

Última actualización: 2026-11-14 — implementado en un PR. Mediciones en el PR y en `CHANGELOG.md`.
