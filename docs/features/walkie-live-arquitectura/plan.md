# Plan: Walkie Live — inferencia arquitectónica, relaciones y exploración

Basado en `spec.md` (aprobada el 2026-11-20) y ADR-0016. Dos PR: A (relaciones, solo la CLI) y B (exploración y revisión por conjuntos, apilado sobre D1).

## Archivos a tocar

- **PR A:**
  - `apps/cli/src/Walkie.Analyzer/Frontend/`: `ScriptFacts` (parámetros, llamadas por nombre, JSX usado), `FrontendSymbols` nuevo (funciones que arman rutas y envoltorios HTTP, entre archivos), `FrontendModel` y `RouteScreens` (atribución y navegación).
  - `apps/cli/src/Walkie.Analyzer/Detectors/`: `FrontendDetectors.cs` (http, navegación y features), `AspNetCoreDataDetector.cs` nuevo (endpoint → handler → `DbSet`).
  - `packages/schema/walkie-discovery.schema.json`: solo la descripción de `relationKind`.
  - `docs/adr/0016-…`.
- **PR B:**
  - `packages/schema/walkie-discovery-architecture.schema.json` nuevo.
  - `apps/api/src/Walkie.Modules.Discovery/Features/Architecture*.cs` (proyección y endpoints).
  - `apps/web/src/discovery/architecture/` (vista y revisión por conjuntos).

## Tareas

1. [ ] (#177) PR A · D2: envoltorios HTTP (un nivel y hasta 3, entre archivos, alias, constantes, plantillas, funciones de rutas, método como argumento u opción, Angular, axios) y `fetch` que no es de la API.
2. [ ] (#177) PR A · Atribución: pantalla → hook o servicio → cliente → API, por componentes que la pantalla dibuja, con límites; si no, desde la app.
3. [ ] (#177) PR A · D3: navegación con funciones de rutas, condicionales y desde componentes; limitaciones para lo no resuelto.
4. [ ] (#177) PR A · Backend: endpoint → handler → servicio → `DbSet` (`reads`/`writes` desde la API).
5. [ ] (#177) PR A · Agrupación funcional por familias de rutas y evidencia, con nombre de la pantalla principal.
6. [ ] (#177) PR A · Casos A a E, métricas en `validacion.md` y rendimiento del análisis.
7. [ ] (#177) PR B · Proyección de arquitectura en la API (vista general y grupo), schema y pruebas con 2.000 y 20.000 entidades.
8. [ ] (#177) PR B · «Explorar arquitectura» en la web (grupos, filtros, evidencia, limitaciones, propuestas).
9. [ ] (#177) PR B · Revisión por conjuntos con vista previa y una sola aplicación; abrir el lienzo.
10. [ ] (#177) PR B · Caso F E2E, capturas, rendimiento, documentación e informe.

## Pruebas

- **Unitarias (CLI, sin Docker):** cada patrón de D2 y D3, límites de profundidad, atribución, `reads`/`writes`, agrupación, casos B a E con proyectos ficticios, determinismo y el propio repo (Caso A).
- **Integración (API):** proyección contra paquetes reales de la CLI, autorización (matriz IDOR), aplicación agrupada sin duplicados, 2.000 y 20.000 entidades.
- **Vitest:** vista de arquitectura (grupos, filtros, evidencia) y revisión por conjuntos.
- **E2E:** Caso F con la CLI, PostgreSQL, la API y la web.

## Estado

Última actualización: 2026-11-20, nube — spec aprobada, diagnóstico C1–C9 hecho. Sigue la tarea 1.
