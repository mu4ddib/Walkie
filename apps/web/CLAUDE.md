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
- Store: `src/store/graphStore.ts`. Un store por lienzo con `createGraphStore()`; los componentes leen con `useGraph(store, selector)` y guardan con `toGraph(state)`. Acciones: `loadGraph`, `addNode`, `moveNode`, `renameNode`, `removeNode` (borra conexiones y layout), `connect` (tipo por defecto según el par; otros pares → `uses`), `setEdgeKind`, `removeEdge`, `markSaved`. Toda acción que cambia algo pone `dirty: true`; las que no cambian nada no lo tocan.
- Tipos del grafo generados desde el JSON Schema (`pnpm gen:schema` → `src/schema/walkie-graph.ts`); si falta un campo, se cambia el schema primero. CI falla si los tipos no están al día (`pnpm check:schema`).
- URL de la API: `VITE_API_URL` (lee el `.env` de la raíz del repo).
- Auth (ADR-0003): `react-oidc-context`; `AuthGate` protege la app y las llamadas a la API llevan `auth.user.access_token`. En pruebas se mockea `useAuth`.
- Estilo pixel art: grilla de 8 px (`snapGrid={[8,8]}`), fuente Press Start 2P para títulos y VT323 para texto, sprites PNG con `image-rendering: pixelated`, paleta en `theme/palette.ts`. Sin sombras difusas ni gradientes.
- Pruebas: Vitest para el store y la lógica, Playwright para flujos (crear nodo, conectar, guardar, tour).

## Trampas conocidas

- **Versiones fijadas a propósito**: TypeScript 5.9, ESLint 9, Vite 7, Vitest 4, `@vitejs/plugin-react` 5. Las majors más nuevas (TS 7, ESLint 10, Vite 8) aún no son compatibles entre sí ni con `typescript-eslint`. No las subas sin correr lint + test + build.
- **pnpm 10.28.0** fijado en `packageManager`. Corre pnpm desde `apps/web` o con `--dir apps/web`: corepack en la raíz (sin `package.json`) baja otra versión y falla con `ERR_PNPM_BAD_PM_VERSION`. En CI se usa `pnpm/action-setup` con `package_json_file: apps/web/package.json`.
- **`tsconfig.app.json` no incluye tipos de Node**: las pruebas en `src/` no pueden usar `node:fs`. La coherencia con el schema la verifica `pnpm check:schema`, no una prueba.
- **`src/schema/` está excluido de ESLint** (código generado).
- **Pruebas del store**: guarda el resultado de una acción antes de leer el estado (`const id = s().addNode(...); s().nodes[id]`). `s().nodes[s().addNode(...)]` lee el estado viejo.
- **`Math.round` puede dar `-0`** y `toEqual` distingue `-0` de `0`: `snap()` lo normaliza.
- **Quitar una clave de un objeto**: usa `omit()` del store; desestructurar con `_variable` sin usar rompe el lint (`no-unused-vars`).
- **Componentes que usan auth**: mockea `react-oidc-context` con `vi.mock` (ver `src/auth/AuthGate.test.tsx`).
- **Probar a mano el login**: Keycloak en :8080 (docker-compose), API en :5080, web en :5173; usuario `dev` / `walkie_dev`. Con Playwright: botón "Iniciar sesión" → `#username`, `#password`, `#kc-login`.

## Cómo crear un tipo de nodo

1. Agregar el tipo en `packages/schema` y regenerar tipos.
2. Componente en `nodes/<Tipo>Node.tsx` + registrarlo en `nodeTypes`.
3. Sprite en `packages/sprites` (múltiplos de 8 px).
4. Panel de propiedades del tipo.
5. Prueba del store + un caso en Playwright.
