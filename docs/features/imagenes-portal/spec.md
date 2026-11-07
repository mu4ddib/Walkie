# Spec: Imágenes en pantallas y nodos `portal`

- Issue padre: #47
- Estado: implementada (2026-11-07), verificada por `apps/web/e2e/imagenes-portal.spec.ts`
- Fase 2 ("cajas ricas"), feature 3 de 3. Las otras dos (panel-propiedades, catalogo) están implementadas.

## Objetivo

Que cada pantalla del lienzo muestre su diseño o captura, y que un lienzo enlace con otras features de la app mediante nodos `portal`, para recorrer la app sin un lienzo gigante (ADR-0002).

## Usuarios

Desarrollador que documenta un flujo y quiere que quien lo lea vea cómo es cada pantalla y pueda saltar a la feature siguiente (ej. de "Iniciar sesión" a "Transferir").

## Criterios de aceptación

**Imágenes en pantallas**

- [x] 1. Dado un nodo `screen` seleccionado, cuando subo una imagen desde el panel (PNG, JPEG o WebP, hasta 5 MB), entonces el nodo muestra su miniatura y el lienzo queda "Sin guardar".
- [x] 2. Dado el panel de subida, entonces muestra el aviso "No subas capturas con datos reales de clientes" (CLAUDE.md: nada de datos reales).
- [x] 3. Dado un archivo de otro tipo o de más de 5 MB, cuando lo elijo, entonces la UI lo rechaza con el motivo y la API también (400).
- [x] 4. Dada una pantalla con imagen, cuando hago clic en la miniatura del panel, entonces la veo en grande; puedo reemplazarla o quitarla.
- [x] 5. Dado un lienzo con imágenes, cuando guardo y recargo, entonces las pantallas muestran las mismas imágenes.
- [x] 6. Dado un grafo con un `assetId` que no existe o que es de otra app, cuando la API lo recibe, entonces responde 400 en `/nodes/{id}/assetId`.

**Nodos `portal`**

- [x] 7. Dado un lienzo, cuando agrego un `portal` desde la paleta, entonces el panel me pide la feature destino (solo features de la misma app, sin la actual); el nodo muestra "→ Nombre de la feature".
- [x] 8. Dado un `portal` con destino, cuando uso "Abrir" (botón del panel o doble clic en el nodo), entonces voy al lienzo destino; si hay cambios sin guardar, la UI pide confirmación antes de salir.
- [x] 9. Dado un `portal` sin destino, entonces el nodo muestra "Sin destino" y "Abrir" está deshabilitado.
- [x] 10. Dado que conecto una pantalla a un `portal`, entonces la conexión es `navigation` por defecto.
- [x] 11. Dado un grafo con un `targetFeatureId` que no existe o que es de otra app, cuando la API lo recibe, entonces responde 400 en `/nodes/{id}/targetFeatureId`.
- [x] 12. Dado un lienzo con portales, cuando guardo y recargo, entonces aparece idéntico.

## Fuera de alcance

- Varias imágenes por pantalla, recortes, anotaciones sobre la imagen o zoom dentro del nodo.
- Imágenes en nodos que no son `screen`.
- Borrar del almacenamiento las imágenes que ningún lienzo usa (limpieza posterior).
- Vista "mapa de la app" con todas las features y sus portales (ADR-0002 la menciona como necesidad futura).
- "Llegan desde": ver qué portales apuntan a una feature.
- Borrar o renombrar features (sigue fuera del MVP).

## Impacto en el modelo

`packages/schema/walkie-graph.schema.json` ya tiene `assetId` (screen) y `targetFeatureId` (portal). Cambios propuestos:

- `assetId`: `format: uuid`, solo en `screen` (validado por integridad).
- `targetFeatureId`: `format: uuid`. Un `portal` sin destino es válido (criterio 9); `title` guarda el último nombre conocido de la feature destino.
- Tipo de conexión por defecto: `screen → portal` es `navigation`.
- Nuevo `packages/schema/walkie-asset.schema.json` para la respuesta de subida: `id`, `appId`, `contentType`, `size`, `width`, `height`.

## Impacto en la API

Módulo nuevo `Walkie.Modules.Files` (schema `files`, ya previsto en `docs/architecture.md`):

- `POST /api/apps/{appId}/assets` (multipart, campo `file`) → 201 con el asset | 400 (tipo o tamaño; se verifica el contenido, no solo la extensión) | 404 si la app no existe.
- `GET /api/assets/{assetId}` → los bytes con su `Content-Type` y caché larga (el asset no cambia) | 404.
- Tabla `files.assets` (`id`, `app_id`, `content_type`, `size`, `width`, `height`, `storage_key`, `created_by`, `created_at`) con migración.
- Files expone `IAssetDirectory` para que Canvas valide `assetId` (criterio 6). Canvas valida `targetFeatureId` con `IFeatureDirectory` de Apps (criterio 11).

Web: `<img>` no manda el token, así que la web pide la imagen con `fetch` + token y la muestra como `blob:` URL (con caché de TanStack Query).

## Decisiones tomadas

1. Los bytes van a un almacenamiento S3, como dice `docs/architecture.md`, detrás de una interfaz `IFileStorage`. Se registra en el ADR-0004; el bucket se crea al arrancar.
4. MinIO dejó de publicar imágenes en Docker Hub (y quay.io no se alcanza desde la nube de desarrollo): en desarrollo y CI se usa RustFS (compatible con S3, Apache-2.0) con versión fija. Decidido el 2026-11-07 al empezar la tarea 1.
2. Formatos PNG, JPEG y WebP, hasta 5 MB. SVG queda fuera (puede traer scripts).
3. Abrir un portal con cambios sin guardar pide confirmación ("Tienes cambios sin guardar. ¿Salir igual?"); no se guarda solo.
