# apps/web — React + TypeScript + React Flow

## Estructura

```
apps/web/src/
  canvas/        # React Flow: lienzo, controles, minimapa
  nodes/         # un componente por tipo de nodo (ScreenNode, ApiNode, RuleNode...)
  edges/         # tipos de conexión (navigation, request, response, uses)
  store/         # Zustand: estado normalizado del grafo + acciones
  tours/         # modo tour y personaje guía
  api/           # cliente HTTP + TanStack Query
  theme/         # paleta pixel, fuentes, sprites
  schema/        # tipos generados desde packages/schema (no editar a mano)
```

## Reglas

- Estado del grafo normalizado: `nodes: Record<id, Node>`, `edges: Record<id, Edge>`, `layout: Record<id, {x,y}>`.
- Solo las acciones del store modifican el grafo. Esto permite migrar a Yjs sin tocar componentes.
- Tipos del grafo generados desde el JSON Schema (`pnpm gen:schema` → `src/schema/walkie-graph.ts`); si falta un campo, se cambia el schema primero. CI falla si los tipos no están al día (`pnpm check:schema`).
- URL de la API: `VITE_API_URL` (lee el `.env` de la raíz del repo).
- Estilo pixel art: grilla de 8 px (`snapGrid={[8,8]}`), fuente Press Start 2P para títulos y VT323 para texto, sprites PNG con `image-rendering: pixelated`, paleta en `theme/palette.ts`. Sin sombras difusas ni gradientes.
- Pruebas: Vitest para el store y la lógica, Playwright para flujos (crear nodo, conectar, guardar, tour).

## Cómo crear un tipo de nodo

1. Agregar el tipo en `packages/schema` y regenerar tipos.
2. Componente en `nodes/<Tipo>Node.tsx` + registrarlo en `nodeTypes`.
3. Sprite en `packages/sprites` (múltiplos de 8 px).
4. Panel de propiedades del tipo.
5. Prueba del store + un caso en Playwright.
