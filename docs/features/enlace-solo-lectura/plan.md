# Plan: Enlace de solo lectura

Basado en `spec.md` (aprobada el 2026-11-08). Issue padre: #73.

## Archivos a tocar

- `packages/schema/walkie-share.schema.json`, `walkie-shared-feature.schema.json` (nuevos) y `targets` de `apps/web/scripts/gen-schema-types.mjs`.
- `docs/adr/0005-enlaces-publicos.md` — endpoints sin sesión, token con hash, caducidad.
- `apps/api/src/Walkie.Modules.Sharing/` (nuevo, schema `sharing`) y su registro en `Walkie.Api`.
- `apps/api/src/Walkie.Modules.Canvas/Contracts/` — `ICanvasReader`.
- `apps/api/src/Walkie.Modules.Files/Contracts/IAssetDirectory.cs` — leer los bytes de una imagen.
- `apps/web/src/share/` (nuevo) — diálogo "Compartir" y vista pública; `routes.tsx` y `AuthGate` para `/s/:token`.
- `apps/web/src/canvas/` — lienzo de solo lectura reutilizable (sin paleta, panel ni guardado; portales sin abrir).
- `apps/web/e2e/enlace-solo-lectura.spec.ts`; `docs/roadmap.md`.

## Tareas

Cada tarea cabe en una sesión y en un PR. La 2 depende de la 1; la 3 de la 1; la 4 de la 2; la 5 cierra.

1. [ ] (#74) Schema `walkie-share`, ADR-0005 y módulo Sharing: tabla `sharing.shares` con migración; `POST/GET /api/features/{featureId}/shares` y `DELETE /api/shares/{shareId}`; token de 256 bits, solo su hash SHA-256 en la base. Pruebas de integración (criterios 1 a 4 y 12 en la API).
2. [ ] (#75) Endpoints públicos: schema `walkie-shared-feature`; `ICanvasReader` (Canvas) y lectura de bytes en `IAssetDirectory` (Files); `GET /api/public/shares/{token}` (actualiza el último acceso) y `GET /api/public/shares/{token}/assets/{assetId}` (solo imágenes usadas por las pantallas del grafo); 404 igual para revocado, caducado o inexistente. Pruebas de integración (criterios 9 a 11).
3. [ ] (#76) Web, autor: "Compartir" en el editor; diálogo con aviso, duración, "Crear enlace", URL una sola vez con "Copiar", lista de enlaces activos y "Revocar". Pruebas en Vitest (criterios 1 a 4).
4. [ ] (#77) Web, lector: ruta `/s/:token` fuera de `AuthGate`; barra de solo lectura con la caducidad; lienzo sin edición; imágenes por el endpoint público; portales que no se abren; tours con "Ver tour"; "Este enlace ya no está disponible". Pruebas en Vitest (criterios 5 a 10).
5. [ ] (#78) E2E: crear un enlace, abrirlo en un contexto sin sesión, ver el lienzo con imagen y recorrer un tour, ver un cambio guardado al recargar, revocar y ver el aviso; spec implementada y roadmap.

## Pruebas

- Integración (API): crear (7/30/90; otra duración → 400; feature inexistente → 404), listar sin token, revocar, 401 sin sesión en los de autor; públicos sin sesión: 200 con la feature, 404 revocado/caducado/inexistente, imagen de otra pantalla o de otra app → 404; la base no contiene el token.
- Unitarias (Vitest): diálogo con `installFakeApi`; vista pública (solo lectura, portales, aviso de no disponible).
- E2E (Playwright): el flujo de la tarea 5, con un contexto del navegador sin sesión.

## Estado

Última actualización: 2026-11-08 — spec aprobada, plan e issues creados (#73 a #78). Sigue: tarea 1.
