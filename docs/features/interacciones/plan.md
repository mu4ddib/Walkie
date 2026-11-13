# Plan: Interacciones entre sistemas

Basado en `spec.md` (aprobada el 2026-11-13). ADR-0011.

## Tareas

1. [x] Schema (conexión y paso) y validación de la API.
2. [x] Catálogo central de operaciones (`apps/web/src/interactions/operations.ts`): perfiles, familias de componentes, sugerencias, verbo, retornos, secciones, migración y contradicciones.
3. [x] Store: operación, intercambio, retornos para cualquier operación con retorno, invertir con retornos, correlaciones sin huérfanos.
4. [x] Inspector contextual y sugerencias al conectar; etiqueta y selector del lienzo por operación.
5. [x] Previsualizar por escenario; recorridos con pasos simultáneos y timeout.
6. [x] Export (Markdown, contexto para IA, PDF).
7. [x] Pruebas (store, catálogo, migración, inspector, API, E2E) y docs.
8. [x] Limitaciones de la primera versión: catálogo único en `packages/schema`, migración de conexiones anteriores, cadena completa al previsualizar, timeout y reintentos simulados, caché de rodeos y avisos de sintaxis SQL/gRPC.

## Estado

Última actualización: 2026-11-13 — implementado en un PR.
