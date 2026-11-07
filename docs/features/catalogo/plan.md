# Plan: Catálogo de la app y nodos `ref`

Basado en `spec.md` (aprobada el 2026-11-07). Issue padre: #33.

## Archivos a tocar

- `packages/schema/walkie-graph.schema.json` — `catalogId` obligatorio en nodos `ref`.
- `packages/schema/walkie-catalog-item.schema.json` (nuevo) — elemento del catálogo.
- `apps/web/scripts/gen-schema-types.mjs`, `apps/web/src/schema/` — tipos de los dos schemas.
- `apps/api/src/Walkie.Modules.Apps/` — `CatalogItem`, tabla `apps.catalog_items` + migración, endpoints, `ICatalogDirectory`, `ICatalogUsage` (contrato).
- `apps/api/src/Walkie.Modules.Canvas/` — validación de `catalogId`, `GET /api/catalog/{itemId}/usages`, implementación de `ICatalogUsage`.
- `apps/web/src/api/` — cliente y hooks del catálogo.
- `apps/web/src/pages/` + `routes.tsx` — página del catálogo.
- `apps/web/src/canvas/`, `nodes/`, `panel/`, `store/` — sección "Catálogo" de la paleta, nodo `ref`, panel de solo lectura, "Mover al catálogo".
- `apps/web/e2e/` — flujo del catálogo.
- `docs/architecture.md` — comunicación Apps ↔ Canvas por contratos.

## Tareas

Cada tarea cabe en una sesión y en un PR. La 1 va primero; la 2 depende de la 1; la 3 depende de la 2 (usa "Usado en" y el 409 al borrar); la 4 depende de la 1 y la 2; la 5 depende de la 4; la 6 cierra.

1. [x] (#34) Schema y CRUD del catálogo en la API: `walkie-catalog-item.schema.json`, `catalogId` obligatorio en `ref`, tipos regenerados; tabla `apps.catalog_items` con migración; `GET/POST /api/apps/{appId}/catalog`, `GET/PUT /api/catalog/{itemId}` (409 por versión). Pruebas de integración (criterios 2 y 3 en la API).
2. [x] (#35) Integridad y borrado en la API: Canvas valida `catalogId` (existe y es de la app de la feature, 400 en `/nodes/{id}/catalogId`); `GET /api/catalog/{itemId}/usages`; `DELETE /api/catalog/{itemId}` con 409 y la lista de features si se usa (`ICatalogUsage` implementado por Canvas). Pruebas de integración (criterios 4, 5 y 12 en la API).
3. [x] (#36) Web, página del catálogo: ruta `/apps/:appId/catalog` enlazada desde la app; lista agrupada por tipo; crear; editar con 409; detalle con "Usado en"; borrar con el 409 explicado (criterios 1 a 5).
4. [x] (#37) Web, nodos `ref`: el editor carga el catálogo; sección "Catálogo" en la paleta; `addRef` en el store; el nodo se ve como su elemento con marca de catálogo, o "Elemento no encontrado"; tipo de conexión por defecto con el tipo del elemento; panel de solo lectura con "Editar en el catálogo"; sin renombrar con doble clic (criterios 6 a 10 y 11).
5. [x] (#38) Web, "Mover al catálogo": botón en el panel de `api`/`service`/`database`; crea el elemento y `convertToRef` reemplaza el nodo conservando id, posición y conexiones (criterio 10b).
6. [x] (#39) E2E: crear elementos en el catálogo, usarlos con `ref` en dos features, editar uno y verlo cambiado en ambos lienzos, "Mover al catálogo", guardar y recargar idéntico, borrar bloqueado por uso (criterios 5, 7, 10b y 11).

## Pruebas

- Integración (API): CRUD del catálogo (201, 400, 404, 409), `catalogId` inválido o de otra app (400), "Usado en", borrado con y sin uso.
- Unitarias (Vitest): acciones `addRef` y `convertToRef`, tipo de conexión con `ref`; página del catálogo con `installFakeApi`; nodo `ref` y panel de solo lectura.
- E2E (Playwright): el flujo de la tarea 6 en CI.

## Estado

Última actualización: 2026-11-07 — feature completa (tareas 1 a 6). La E2E `apps/web/e2e/catalogo.spec.ts` cubre los criterios 5, 7, 10b y 11 en CI. Sigue: feature 3 de la fase 2 (imágenes + `portal`).
