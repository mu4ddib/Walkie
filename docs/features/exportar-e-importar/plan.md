# Plan: Exportar e importar

Basado en `spec.md` (aprobada el 2026-11-12). Issue padre: #137.

## Archivos a tocar

- `packages/schema`: `walkie-ai-context.schema.json` y `walkie-package.schema.json` (+ tipos generados y job `schema` del CI).
- `apps/api/src/Walkie.Modules.Export`: `ExportEndpoints` (`format`), contexto para IA (Markdown + JSON, detección de vacíos), PDF, paquete `.walkie`; importación (probablemente en `Walkie.Modules.Apps` o un módulo `Import`, transaccional con Postgres y RustFS).
- `docs/adr/0008-…` (librería de PDF y cómo llega la imagen del lienzo).
- `apps/web`: menú «Exportar» del editor, imagen del lienzo (`html-to-image` o SVG propio de React Flow), «Importar feature» y exportar la app en la página de la app, hooks en `api/hooks.ts`.

## Tareas

Cada tarea cabe en una sesión y en un PR.

1. [x] (#143) Contexto para IA de una feature: schema del JSON, `format=ai` (`.md` + `.context.json`), vacíos detectados, menú «Exportar» con todas las opciones (las que aún no existen, ocultas) y copiar al portapapeles con tamaño en tokens.
2. [x] (#144) Contexto para IA de la app completa: `GET /api/apps/{appId}/export?format=ai` y la acción en la página de la app.
3. [ ] (#145) Imagen del lienzo (PNG/SVG) en el navegador: todo o lo visible, 1× / 2×, con imágenes de pantallas.
4. [ ] (#146) PDF en la API: ADR de la librería, portada, lienzo, componentes, conexiones, flujos y tours.
5. [ ] (#147) Archivo `.walkie` de una feature: schema del manifest y `format=walkie`.
6. [ ] (#148) Importar una feature desde un `.walkie`: `POST /api/apps/{appId}/import` (`dryRun`, transaccional, errores con ruta, 413), resumen antes de confirmar en la web; prueba de ida y vuelta.
7. [ ] (#149) Exportar e importar la app completa (features, catálogo y mapa; importar crea una app nueva).

## Pruebas

- Unitarias: textos del contexto (vacíos, flujos en orden), resumen de importación en la web.
- Integración: cada `format` (cabeceras, contenido estable), import válido / inválido / versión no soportada / demasiado grande, ida y vuelta idéntica.
- E2E: exportar contexto y copiarlo; descargar imagen y PDF; exportar `.walkie` e importarlo en otra app con el mismo lienzo.

## Estado

Última actualización: 2026-11-12 — tarea 1 hecha: `walkie-ai-context.schema.json`, `GET /api/features/{id}/export?format=ai|ai-json` (el modelo `AiContext` en `MarkdownDocument.AiContext.cs`, del que salen el JSON y el Markdown; vacíos detectados en 10 tipos), menú «Exportar» (`ExportMenu`) y diálogo «Contexto para IA» (`AiContextDialog`: vista previa, tokens aproximados, copiar y descargar). Tarea 2 hecha: `GET /api/apps/{appId}/export?format=ai|ai-json` con `walkie-app-ai-context.schema.json` (el contexto de cada feature por `$ref`, catálogo con `usedBy`, mapa por portales y vacíos, más `unused-catalog-item`), en `MarkdownDocument.AppAiContext.cs`; consultas nuevas `IAppDirectory.AppNameAsync`, `IFeatureDirectory.FeaturesOfAppAsync` e `ICatalogDirectory.AllItemsOfAppAsync`; «Contexto para IA» en la página de la app (el mismo `AiContextDialog`, con `target`). Sigue la tarea 3 (imagen del lienzo).
