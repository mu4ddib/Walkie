# Plan: Export a Markdown

Basado en `spec.md` (aprobada el 2026-11-08). Issue padre: #84.

## Archivos a tocar

- `apps/api/src/Walkie.Modules.Export/` (nuevo, sin tablas): generador del `.md`, armado del `.zip` y endpoint; registro en `Walkie.Api`.
- Contratos existentes de Apps (`IFeatureDirectory`, `ICatalogDirectory`), Canvas (`ICanvasReader`) y Files (`IAssetDirectory`); quizás uno nuevo para los nombres de varias features (destinos de portales).
- `apps/web/src/canvas/FeatureEditor.tsx` y `api/` — botón "Exportar" y descarga.
- `apps/web/e2e/export-markdown.spec.ts`; `docs/roadmap.md`; `docs/architecture.md` y `apps/api/CLAUDE.md` (módulo nuevo).

## Tareas

Cada tarea cabe en una sesión y en un PR. La 2 depende de la 1; la 3 de la 2; la 4 cierra.

1. [x] (#85) Generador del documento: módulo `Walkie.Modules.Export` con un generador puro (grafo + nombres + catálogo + rutas de imágenes → texto): encabezado y tabla de contenidos, diagrama Mermaid, secciones por tipo (inputs, expresiones, `MÉTODO /ruta`, portales, `ref` del catálogo), conexiones y tours; escapado de Markdown y Mermaid; orden estable; slugs. Pruebas sin base de datos (criterios 3 a 8 y 10).
2. [ ] (#86) Endpoint `GET /api/features/{featureId}/export`: arma el `.zip` (`<slug>.md` + `img/`) con la última versión guardada, con los contratos de Apps, Canvas y Files. Pruebas de integración: 401, 404, contenido del zip, imágenes, `Content-Disposition`, OpenAPI (criterios 2 y 9).
3. [ ] (#87) Web: "Exportar" en la barra del editor; descarga con `fetch` + token y un `blob:` con `download`; aviso "Se exporta lo guardado" con cambios pendientes; error si falla. Pruebas en Vitest (criterio 1).
4. [ ] (#88) E2E: documentar una feature (pantalla con imagen e inputs, regla, API, portal, conexiones y un tour), exportar, abrir el `.zip` y verificar el `.md`; spec implementada y roadmap.

## Pruebas

- Unitarias (xUnit, sin base): el generador con un grafo de cada tipo de nodo; escapado de `|`, `*`, `#`, `<`, comillas y saltos de línea en Markdown y Mermaid; orden estable; slugs con acentos y símbolos.
- Integración (API): 401 sin sesión, 404 feature inexistente, zip con `.md` e `img/` (las imágenes son los bytes subidos), feature sin imágenes sin `img/`, `Content-Disposition` con el slug, OpenAPI.
- Unitarias (Vitest): botón "Exportar" con `installFakeApi` (descarga, aviso con cambios sin guardar, error).
- E2E (Playwright): el flujo de la tarea 4, leyendo el `.zip` descargado.

## Estado

Última actualización: 2026-11-08 — tarea 1 hecha (módulo `Walkie.Modules.Export` con el generador `MarkdownDocument`, escapado en `MarkdownText` y `Slugs`). Sigue: tarea 2 (endpoint del `.zip`).
