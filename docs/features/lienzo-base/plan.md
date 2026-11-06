# Plan: Lienzo base

Basado en `spec.md` (aprobada el 2026-11-06). Issue padre: #2.

Requiere la auth básica de la fase 0 (ADR-0003): todos los endpoints exigen token.

## Archivos a tocar

- `packages/schema/walkie-graph.schema.json` — sin cambios; la API lo usa para validar.
- `apps/api/src/Walkie.Modules.Apps/` — apps y features (entidades, `DbContext`, endpoints).
- `apps/api/src/Walkie.Modules.Canvas/` — lienzo (`jsonb` + `version`), validación con el schema.
- `apps/api/src/Walkie.Api/` — registro de módulos y migraciones.
- `apps/api/tests/Walkie.IntegrationTests/` — Testcontainers + pruebas por endpoint.
- `apps/web/src/store/` — store del grafo y acciones.
- `apps/web/src/nodes/`, `apps/web/src/edges/`, `apps/web/src/canvas/` — lienzo, paleta y tipos de nodo.
- `apps/web/src/api/` — cliente HTTP y hooks de TanStack Query.
- `apps/web/e2e/` — Playwright.

## Tareas

Cada tarea cabe en una sesión y en un PR. Orden: API primero; las tareas 4-6 de web pueden ir en paralelo a la API.

1. [x] (#3) API: persistencia con EF Core + Postgres (módulos, `DbContext`, migración inicial, Testcontainers).
2. [x] (#4) API: endpoints de apps y features (FluentValidation, ProblemDetails, 401).
3. [x] (#5) API: `GET/PUT` del lienzo con validación de schema (400) y concurrencia optimista (409).
4. [ ] (#6) Web: store del grafo (acciones, `dirty`, UUID v7) con pruebas en Vitest.
5. [ ] (#7) Web: navegación y formularios de apps y features.
6. [ ] (#8) Web: paleta, nodos `screen`/`api`/`database` pixel v1, conexiones con tipo, editar título, borrar.
7. [ ] (#9) Web: guardar (botón + Ctrl+S), indicador "sin guardar", diálogo de 409 y error de 400.
8. [ ] (#10) E2E con Playwright del flujo completo + job en CI (gate de la fase 1).

## Pruebas

- Unitarias: store del grafo (cada acción, `dirty`, borrado en cascada, tipo de conexión por defecto).
- Integración: cada endpoint con Postgres real (201/200, 400, 401, 404, 409).
- E2E: crear → editar → guardar → recargar idéntico; conflicto 409 con dos pestañas.

## Estado

Última actualización: 2026-11-06 — API de la fase lista (tareas 1-3). Sigue: tarea 4 (#6), store del grafo en la web.
