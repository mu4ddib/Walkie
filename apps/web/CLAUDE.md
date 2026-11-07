# apps/web — React + TypeScript + React Flow

## Estructura

```
apps/web/src/
  canvas/        # Canvas.tsx (React Flow ↔ store), Palette.tsx (paleta lateral), canvas.css (estilo pixel)
  nodes/         # PixelNode.tsx (caja común), nodeMeta.ts (etiqueta/glifo por tipo), nodeTypes.ts (registro)
  edges/         # KindEdge.tsx (etiqueta + selector de tipo), edgeMeta.ts, edgeTypes.ts
  store/         # graphStore.ts (estado + acciones), GraphStoreProvider + useGraphStore (contexto para nodos/conexiones)
  tours/         # modo tour y personaje guía
  api/           # cliente HTTP (client.ts) + hooks de TanStack Query (hooks.ts)
  pages/         # una página por ruta (AppsPage, AppPage, FeaturePage)
  ui/            # piezas reutilizables (NameForm, QueryState)
  routes.tsx     # rutas de react-router: / · /apps/:appId · /apps/:appId/features/:featureId
  test/          # helpers de pruebas: fakeApi.ts (API falsa en memoria), render.tsx (renderRoute)
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
- Pruebas de páginas: `installFakeApi({ apps, features })` reemplaza `fetch` con una API en memoria que responde como `apps/api`; `renderRoute('/ruta')` monta las rutas reales con TanStack Query. Mockea `react-oidc-context` y, si no hace falta, `../canvas/Canvas` (React Flow).
- Lienzo: `<Canvas store={store} />`. La selección, el nodo en edición y las medidas son estado de UI local de `Canvas`, no del store. Nodos y conexiones leen y cambian el grafo con `useGraphStore(selector)`.
- Llamadas a la API: siempre por los hooks de `api/hooks.ts` (ponen el token y las `queryKeys`); los errores llegan como `ApiError` con `userMessage` del `ProblemDetails`.

## Trampas conocidas

- **Versiones fijadas a propósito**: TypeScript 5.9, ESLint 9, Vite 7, Vitest 4, `@vitejs/plugin-react` 5, react-router 7 (la 8 es muy nueva). Las majors más nuevas (TS 7, ESLint 10, Vite 8) aún no son compatibles entre sí ni con `typescript-eslint`. No las subas sin correr lint + test + build.
- **pnpm 10.28.0** fijado en `packageManager` de `apps/web/package.json` **y** del `package.json` de la raíz (que existe solo para eso). Si falta el de la raíz, con corepack activo `pnpm --dir apps/web …` baja otra versión y falla con `ERR_PNPM_BAD_PM_VERSION`. Si cambias la versión, cámbiala en los dos. En CI se usa `pnpm/action-setup` con `package_json_file: apps/web/package.json`.
- **`tsconfig.app.json` no incluye tipos de Node**: las pruebas en `src/` no pueden usar `node:fs`. La coherencia con el schema la verifica `pnpm check:schema`, no una prueba.
- **`src/schema/` está excluido de ESLint** (código generado).
- **Pruebas del store**: guarda el resultado de una acción antes de leer el estado (`const id = s().addNode(...); s().nodes[id]`). `s().nodes[s().addNode(...)]` lee el estado viejo.
- **`Math.round` puede dar `-0`** y `toEqual` distingue `-0` de `0`: `snap()` lo normaliza.
- **Quitar una clave de un objeto**: usa `omit()` del store; desestructurar con `_variable` sin usar rompe el lint (`no-unused-vars`).
- **React Flow controlado**: `Canvas` reconstruye los nodos desde el store; hay que devolverles `measured` (guardado de los cambios `dimensions`). Sin eso, React Flow los oculta un instante para medirlos en cada cambio (ej. al seleccionar) y se pierden clics: el doble clic para editar fallaba.
- **`fitView` con lienzo vacío**: ajusta el zoom cuando aparece el primer nodo y los siguientes caen en otro sitio. Solo se usa si el lienzo ya trae nodos al montarse.
- **Doble clic en nodos**: usa `onNodeDoubleClick` del `<ReactFlow>` y pasa `editing` por `data`; con `zoomOnDoubleClick={false}`.
- **Fast refresh (`react-refresh/only-export-components`)**: un `.tsx` solo exporta componentes. Constantes y hooks van en `.ts` aparte (por eso existen `nodeMeta.ts`, `edgeMeta.ts`, `paletteTypes.ts`, `useGraphStore.ts`).
- **Probar el lienzo con Playwright**: el arrastre desde la paleta es HTML5 DnD; dispáralo con `dispatchEvent('dragstart'|'drop', { dataTransfer })` (ver tarea 8). Conectar: `mouse.down` en `.react-flow__handle-right` y `mouse.up` en `.react-flow__handle-left` del destino.
- **Componentes que usan auth**: mockea `react-oidc-context` con `vi.mock` (ver `src/auth/AuthGate.test.tsx`).
- **Probar a mano el login**: Keycloak en :8080 (docker-compose), API en :5080, web en :5173; usuario `dev` / `walkie_dev`. Con Playwright: botón "Iniciar sesión" → `#username`, `#password`, `#kc-login`.

## Cómo crear un tipo de nodo

1. Agregar el tipo en `packages/schema` y regenerar tipos.
2. Etiqueta y glifo en `nodes/nodeMeta.ts`, color en `theme/palette.ts`, registrarlo en `nodes/nodeTypes.ts` (por defecto `PixelNode`; componente propio en `nodes/<Tipo>Node.tsx` si necesita contenido distinto). Para que aparezca en la paleta: `canvas/paletteTypes.ts`.
3. Sprite en `packages/sprites` (múltiplos de 8 px).
4. Panel de propiedades del tipo.
5. Prueba del store + un caso en Playwright.
