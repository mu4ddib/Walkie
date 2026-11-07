# Plan: Panel de propiedades y tipos de nodo restantes

Basado en `spec.md` (aprobada el 2026-11-07). Issue padre: #19.

## Archivos a tocar

- `packages/schema/walkie-graph.schema.json` — límites (`description`, `expression`, `input.name`, `edge.label/when`) y `input.options`.
- `apps/web/src/schema/walkie-graph.ts` — regenerado (`pnpm gen:schema`).
- `apps/api/src/Walkie.Modules.Canvas/Features/GraphValidator.cs` — integridad de `ruleIds`, nombres de input únicos, `options` solo en `enum`.
- `apps/web/src/store/graphStore.ts` — acciones nuevas y cascada de reglas.
- `apps/web/src/nodes/`, `apps/web/src/edges/`, `apps/web/src/canvas/` — tipos nuevos, contenido de los nodos, etiqueta y condición en conexiones.
- `apps/web/src/panel/` (nuevo) — panel de propiedades de nodo, conexión e inputs.
- `apps/web/e2e/` — flujo de propiedades.

## Tareas

Cada tarea cabe en una sesión y en un PR. La 1 va primero; la 2 depende de la 1; la 3 y la 4 dependen de la 2; la 5 depende de la 4; la 6 cierra.

1. [x] (#20) Schema y validación en la API: límites y `input.options` en el schema, tipos regenerados; `GraphValidator` valida `ruleIds` (existe y es `rule`), nombres de input únicos y `options` solo en `enum`. Pruebas de integración (criterio 13).
2. [x] (#21) Web, store: `updateNode` (título, descripción, expresión, `http`), `addInput`/`updateInput`/`removeInput` (nombres únicos, `options` solo en `enum`), `updateEdge` (`label`, `when`); `removeNode` de una regla limpia los `ruleIds`; tipos por defecto de los pares nuevos. Pruebas en Vitest (criterios 2, 10, 11).
3. [x] (#22) Web, lienzo: `actor`, `rule` y `service` en la paleta; contenido dentro de los nodos (inputs con `*`, expresión, `MÉTODO /ruta`, "+N más"); etiqueta y condición sobre las conexiones (criterios 1, 5, 6 en el nodo, 8c).
4. [ ] (#23) Web, panel de propiedades: panel lateral para un nodo (título, descripción, expresión, método y ruta) o una conexión (tipo, etiqueta, condición); ayuda con cero o varios seleccionados (criterios 3 a 7).
5. [ ] (#24) Web, inputs en el panel: agregar, editar (nombre, tipo, obligatorio, opciones `enum`), quitar y asociar reglas del lienzo; el panel de una regla lista los inputs que la usan (criterios 8, 8b, 9, 10).
6. [ ] (#25) E2E: documentar una pantalla con inputs y reglas, una API con método y ruta y una conexión con condición; guardar, recargar idéntico y borrar una regla asociada (criterios 11 y 12).

## Pruebas

- Unitarias (Vitest): cada acción nueva del store, cascada de reglas, nombres únicos, `options` solo en `enum`; componentes del panel con el store real.
- Integración (API): 400 por `ruleIds` rotos o a nodos que no son `rule`, nombres duplicados, `options` fuera de `enum`, límites del schema; 200 con un grafo completo.
- E2E (Playwright): el flujo de la tarea 6 en CI.

## Estado

Última actualización: 2026-11-07 — tareas 1 a 3 hechas (schema y validación en la API; acciones del store; tipos nuevos en la paleta y contenido en nodos y conexiones). Sigue: tarea 4.
