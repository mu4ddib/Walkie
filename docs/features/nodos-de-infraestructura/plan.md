# Plan: Nodos de infraestructura

Basado en `spec.md` (aprobada el 2026-11-12). Issue padre: #136.

## Archivos a tocar

- `packages/schema/walkie-graph.schema.json` (`resource`, `resourceKind`, `resourceLabel`, `provider`, `resourceName`, `details`, `database.model`, `service.runtime`) y `walkie-catalog-item.schema.json` (`type: resource`); tipos generados.
- `docs/adr/0007-nodo-recurso-con-subtipos.md`.
- `apps/api`: `GraphValidator`, validación del catálogo, `MarkdownDocument` (sección «Recursos», formas en Mermaid) y sus pruebas.
- `apps/web`: `nodes/nodeMeta.ts` (+ subtipos: etiqueta, glifo, ayuda), `theme/palette.ts`, `canvas/paletteTypes.ts` y `Palette.tsx` (tecla 8 y lista de subtipos), `nodes/PixelNode.tsx` (cabecera con subtipo y detalles), `store/graphStore.ts` (`addNode` con subtipo, `updateNode` con los campos nuevos), tipo de conexión por defecto, `panel/PropertiesPanel.tsx` (inspector del recurso, modelo y runtime), catálogo (`MoveToCatalog`, panel «Componentes»).
- `packages/sprites` si hacen falta glifos nuevos (múltiplos de 8 px).

## Tareas

Cada tarea cabe en una sesión y en un PR.

1. [x] (#140) Schema, ADR y API: campos nuevos, validación (`resourceLabel` solo con `custom`, límites de `details`), `resource` en el catálogo, sección «Recursos» en el export a Markdown. Pruebas de la API.
2. [x] (#141) Lienzo: botón «Recurso» (tecla 8) con la lista de subtipos, glifos y colores; caja con subtipo, proveedor y hasta tres detalles; tipo de conexión por defecto según el subtipo; acciones del store. Pruebas del store.
3. [x] (#142) Inspector y catálogo: editar subtipo, proveedor, nombre, detalles y notas; modelo en Base de datos; runtime en Servicio; «Guardar como componente» y «Componentes» con recursos. E2E `nodos-de-infraestructura.spec.ts`, CHANGELOG y `CLAUDE.md`.

## Pruebas

- Unitarias: store (crear, cambiar subtipo conservando conexiones, conexión por defecto), `nodeMeta`.
- Integración: `GraphValidator` y catálogo con recursos válidos e inválidos; export con «Recursos».
- E2E: crear cada subtipo, personalizado, guardar y recargar idéntico, guardar como componente y reutilizarlo, tour con un recurso.

## Estado

Última actualización: 2026-11-12 — feature completa. Tarea 3: `ResourceEditor` y `RuntimeField` (inspector, panel de un `ref` y página del catálogo), modelo en `DatabaseEditor`, recursos en el catálogo («Guardar como componente», «Componentes» y crear con subtipo) y `convertToLocal` con recurso y runtime. Tarea 2: `nodes/resourceMeta.ts` (subtipos, proveedores, `resourceEdgeKind`, `normalizeResource`), `addResource`, `setResource` y `setRuntime` en el store, botón «Recurso» (tecla 8) con `ResourcePicker` (clic, teclado y arrastre), caja con subtipo, proveedor, nombre y hasta tres detalles, y E2E `nodos-de-infraestructura.spec.ts`. Sigue la tarea 3 (inspector y catálogo). Tarea 1: schema (`$defs/resource`, `$defs/runtime`, `database.model`), ADR-0007, validación en lienzo y catálogo (migración `CatalogResourceAndRuntime`) y sección «Recursos» en el export. El front solo tiene la entrada mínima del tipo (`NODE_LABELS`, color, título por defecto) para compilar; crear y dibujar recursos es la tarea 2.
