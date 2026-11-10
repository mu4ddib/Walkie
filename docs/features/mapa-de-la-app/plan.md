# Plan: Mapa de la app

Basado en `spec.md` (aprobada 2026-11-10). Issue padre: #125. Una vista adicional: la galería y los lienzos no cambian.

## Archivos a tocar

- `packages/schema/walkie-app-map.schema.json` (nuevo) y tipos generados.
- `apps/api/src/Walkie.Modules.Canvas`: `AppMap` (arma el mapa desde los lienzos guardados), `AppMapLayout` (entidad + migración, tabla `canvas.app_maps`), endpoints `GET /api/apps/{appId}/map` y `PUT /api/apps/{appId}/map/layout`; pruebas de integración.
- `apps/web/src/map/` (nuevo): `MapPage.tsx`, `FeatureMapNode.tsx`, `CatalogMapNode.tsx`, `MapEdge.tsx`, `mapLayout.ts` (distribución automática), `map.css`; `api/hooks.ts`, `routes.tsx`, `pages/AppPage.tsx` («Ver mapa»), `workspace/LocationBar.tsx`, `canvas/Canvas.tsx` (abrir con una caja seleccionada).
- `apps/web/e2e/mapa-de-la-app.spec.ts` y `docs/`.

## Tareas

1. [ ] Schema del mapa y API: `GET /map` (features con resumen, conexiones por portal con su caja de origen, portales sin destino, uso del catálogo) y `PUT /map/layout` con versión. — issue #126
2. [ ] Página del mapa: cajas de feature, flechas por portal (con puertos y esquivado), componentes compartidos con interruptor, selección con panel, distribución automática, mover y guardar, «Reordenar». — issue #127
3. [ ] Entradas y salidas: «Ver mapa» en la app y en el selector de app del editor; «Abrir lienzo» y «Abrir en el lienzo» (con el portal seleccionado). — issue #128
4. [ ] E2E y documentación. — issue #129

## Pruebas

- Integración (API): mapa con portales entre features, portal sin destino, catálogo compartido, app inexistente (404), 401; layout: guardar, 409 por versión, 400 por datos inválidos; en OpenAPI.
- Vitest: `mapLayout.test.ts` (capas por portales, ciclos, features nuevas sin encimarse), `MapPage.test.tsx`.
- E2E: dos features enlazadas por un portal; flecha con su etiqueta; abrir en el lienzo con el portal seleccionado; componentes compartidos; mover, recargar y conservar; la galería sigue igual.

## Estado

Última actualización: 2026-11-10 — plan aprobado.
