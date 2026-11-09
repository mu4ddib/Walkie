# Plan: Espacio de trabajo (rediseño de UI/UX)

Basado en `spec.md` (2026-11-08). Issue padre: #94.

## Archivos a tocar

- `apps/web/src/theme/` (tokens, fuentes), `index.html`, `App.css`, `canvas/`, `panel/`, `nodes/`, `edges/`, `pages/`, `workspace/` (nuevo: barra superior, selectores, sesión, bienvenida, atajos).
- `packages/schema/walkie-graph.schema.json` y `walkie-catalog-item.schema.json` (tareas 4 y 5).
- `apps/api/src/Walkie.Modules.Apps` (feature: descripción, fecha, renombrar), `Walkie.Modules.Canvas` (vistas previas, validación de grupos y detalle técnico).
- `apps/web/e2e/` y `docs/`.

## Tareas

Cada tarea cabe en un PR. El orden sigue las prioridades del autor.

1. [x] (#95) Sistema visual y lienzo primero: tokens arena/piedra, fuentes legibles, botones y campos con estados; `/` abre la última app/feature/vista o la bienvenida (con ejemplo); barra superior con selectores de app y feature, estado de guardado y acciones; barra de herramientas flotante con teclas 1–7; panel derecho plegable; guía de lienzo vacío, pista contextual y atajos ("?"). Criterios 1 a 6.
2. [x] (#96) Apps y features: descripción y `updatedAt` en features (migración), renombrar, vistas previas del lienzo (endpoint en Canvas), galería con tarjetas, miniaturas, búsqueda y estados vacíos. Criterios 7 a 9.
3. [x] (#97) Catálogo en el editor: panel "Componentes" (buscar, filtrar, arrastrar, crear), guardar como componente, copia independiente, definición compartida vs. uso, alcance antes de guardar. Criterios 10 a 12.
4. [x] (#98) Inspector técnico: schema de `http`, `database`, notas y detalle de conexiones; catálogo con contrato `jsonb`; inspector por tipo con secciones; resumen en el nodo. Criterios 13 a 17.
5. [x] (#99) Grupos de infraestructura: schema, store, nodo grupo, mover con hijos, plegar. Criterios 18 a 20.
6. [ ] (#100) Conexiones con movimiento y tours: animación direccional, interruptor, estilos por tipo, etiquetas sin superposición, tours que resaltan conexiones. Criterios 21 a 23.
7. [ ] (#101) E2E del recorrido completo y capturas en tres anchos. Criterio 24.

## Pruebas

- Vitest: sesión (guardar/restaurar), bienvenida y ejemplo, selectores, barra de herramientas y atajos, panel plegable; tarjetas y miniaturas; panel de componentes; inspector por tipo; grupos en el store; animación con movimiento reducido.
- Integración (API): renombrar feature, `updatedAt`, vistas previas; contrato del catálogo; validación de grupos y detalle técnico (400).
- E2E: los existentes siguen pasando (se adaptan los selectores que cambien) y el recorrido de la tarea 7.

## Recursos gráficos pendientes (provisionales mientras tanto)

- Íconos por tipo de nodo (actor, pantalla, regla, API, servicio, BD, portal, componente, grupo): 16×16 y 24×24 px, PNG con transparencia, línea de 2 px en la paleta piedra; estados normal y activo. Hoy: glifos de texto.
- Ilustración de bienvenida: Walkie en el desierto con un mapa, 256×160 px (×2), PNG; reposo. Hoy: el sprite `idle` del guía.

## Estado

Última actualización: 2026-11-09 — tareas 1 a 5 hechas. Tarea 5: `groups` en el grafo (id, título, tipo, plegado), `node.groupId` y la caja del grupo en `layout`; la API valida la integridad (grupo existente, caja con ancho y alto, clave = id). En el lienzo: "Grupo" (tecla G) rodea lo seleccionado; mover el grupo por su nombre mueve sus cajas; soltar una caja dentro la incluye; se redimensiona; plegado es una caja compacta a la que llegan las conexiones; inspector con nombre, tipo, plegado, nodos y "Desagrupar". Sigue: tarea 6 (conexiones con movimiento y tours).
