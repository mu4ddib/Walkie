# Plan: Imágenes en pantallas y nodos `portal`

Basado en `spec.md` (aprobada el 2026-11-07). Issue padre: #47.

## Archivos a tocar

- `docs/adr/0004-archivos-en-s3.md` (nuevo) — imágenes en MinIO/S3 detrás de `IFileStorage`, servidas por la API.
- `apps/api/src/Walkie.Modules.Files/` (nuevo) — `Asset`, tabla `files.assets` + migración, `IFileStorage` (S3), endpoints, `IAssetDirectory`.
- `apps/api/src/Walkie.Api/` — registrar el módulo y su configuración (`Storage:*` por variables de entorno).
- `apps/api/tests/` — pruebas con MinIO en Testcontainers.
- `infra/docker-compose.yml`, `.github/workflows/ci.yml` — MinIO con versión fija, en CI para el E2E.
- `packages/schema/` — `format: uuid` en `assetId`/`targetFeatureId`; `walkie-asset.schema.json` (nuevo).
- `apps/api/src/Walkie.Modules.Canvas/` — integridad de `assetId` y `targetFeatureId`.
- `apps/web/src/` — subida y miniatura en pantallas; nodo `portal`, selector de destino, "Abrir" con confirmación.
- `apps/web/e2e/` — flujo de imágenes y portales.

## Tareas

Cada tarea cabe en una sesión y en un PR. La 1 va primero; la 2 depende de la 1; la 3 depende de la 2; la 4 depende de la 2 (no de la 3); la 5 cierra.

1. [ ] (#48) ADR-0004 y módulo Files: MinIO con versión fija en docker-compose y CI, bucket creado al arrancar; `POST /api/apps/{appId}/assets` (multipart, PNG/JPEG/WebP por contenido, ≤ 5 MB) y `GET /api/assets/{assetId}`; tabla `files.assets`; pruebas de integración con MinIO (criterio 3 en la API).
2. [ ] (#49) Schema e integridad: `format: uuid`, `walkie-asset.schema.json`, tipos regenerados; Canvas valida `assetId` (existe, es de la app y solo en `screen`) y `targetFeatureId` (existe y es de la app). Pruebas de integración (criterios 6 y 11).
3. [ ] (#50) Web, imágenes: subir desde el panel de una pantalla con el aviso de datos reales, validación de tipo y tamaño, miniatura en el nodo (imagen pedida con token y mostrada como `blob:`), verla en grande, reemplazar y quitar (criterios 1 a 5).
4. [ ] (#51) Web, portales: `portal` en la paleta; selector de feature destino (misma app, sin la actual); el nodo muestra "→ Feature" o "Sin destino"; "Abrir" (panel y doble clic) con confirmación si hay cambios sin guardar; `screen → portal` es `navigation` (criterios 7 a 10 y 12).
5. [ ] (#52) E2E: subir una imagen a una pantalla, enlazar dos features con un portal, guardar y recargar idéntico, abrir el portal con y sin cambios pendientes (criterios 1, 5, 8 y 12).

## Pruebas

- Integración (API): subida válida, tipo falso por extensión, más de 5 MB, app inexistente, descarga y 404; `assetId` y `targetFeatureId` inválidos o de otra app (400).
- Unitarias (Vitest): acciones del store para imagen y destino, panel de imagen y de portal con `installFakeApi`, confirmación al abrir.
- E2E (Playwright): el flujo de la tarea 5 en CI, con MinIO levantado.

## Estado

Última actualización: 2026-11-07 — spec aprobada, plan e issues creados. Sigue: tarea 1.
