# apps/web — React + TypeScript + React Flow

## Estructura

```
apps/web/src/
  canvas/        # FeatureEditor.tsx (carga, guardado, 409/400), Canvas.tsx (React Flow ↔ store), Palette.tsx, useOpenFeature.ts (abrir otra feature con confirmación), canvas.css
  nodes/         # PixelNode.tsx (caja común + resumen del contenido), NodeImage.tsx (miniatura de una pantalla), nodeContent.ts (límites y textos del resumen), nodeMeta.ts (etiqueta/glifo por tipo), nodeTypes.ts (registro)
  catalog/       # catalogContext.ts: catálogo y features de la app vistos desde el lienzo (contexto, refTarget, effectiveType, portalTarget)
  edges/         # KindEdge.tsx (tipo, label y [when] + selector de tipo), edgeMeta.ts, edgeTypes.ts
  panel/         # PropertiesPanel.tsx (panel lateral de nodo o conexión), RefPanel.tsx (ref en solo lectura), PortalPanel.tsx (destino y "Abrir"), MoveToCatalog.tsx ("Mover al catálogo"), ScreenImage.tsx (subir, ver, reemplazar y quitar la imagen), ToursSection.tsx (tours del lienzo: lista, crear, editar pasos), InputsSection.tsx (inputs de pantalla + "Usada por" de una regla), TextField.tsx (campo con borrador local y `validate`), panel.css
  store/         # graphStore.ts (estado + acciones), GraphStoreProvider + useGraphStore (contexto para nodos/conexiones)
  tours/         # modo tour y personaje guía
  api/           # cliente HTTP (client.ts) + hooks de TanStack Query (hooks.ts)
  pages/         # una página por ruta (AppsPage, AppPage, FeaturePage, CatalogPage) + catalogPaths.ts (rutas y tipos del catálogo)
  ui/            # piezas reutilizables (NameForm, QueryState)
  routes.tsx     # rutas de react-router: / · /apps/:appId · /apps/:appId/catalog[/:itemId] · /apps/:appId/features/:featureId
  test/          # helpers de pruebas: fakeApi.ts (API falsa en memoria), render.tsx (renderRoute)
apps/web/e2e/    # Playwright: lienzo-base.spec.ts (gate de la fase 1), panel-propiedades.spec.ts, catalogo.spec.ts, imagenes-portal.spec.ts (genera su PNG en memoria) + helpers.ts (login, dropNode, connect, rename, visibleGraph)
  theme/         # paleta pixel, fuentes, sprites
  schema/        # tipos generados desde packages/schema (no editar a mano)
```

## Reglas

- Estado del grafo normalizado: `nodes: Record<id, Node>`, `edges: Record<id, Edge>`, `layout: Record<id, {x,y}>`.
- Solo las acciones del store modifican el grafo. Esto permite migrar a Yjs sin tocar componentes.
- Store: `src/store/graphStore.ts`. Un store por lienzo con `createGraphStore()`; los componentes leen con `useGraph(store, selector)` y guardan con `toGraph(state)`. Acciones: `loadGraph`, `addNode`, `addRef` (nodo `ref` con `catalogId` y el título como último conocido), `convertToRef` (api/service/database → `ref` con el mismo id, posición y conexiones), `moveNode`, `renameNode`, `updateNode` (título, descripción, expresión, `http`, `assetId` de una pantalla, `targetFeatureId` de un portal), `addInput`/`updateInput`/`removeInput` (nombres únicos —`inputNameError` dice por qué no—, `options` solo en `enum`, `ruleIds` solo a reglas existentes), `removeNode` (borra conexiones, layout y, si es una regla, sus `ruleIds`), `connect` (tipo por defecto según el par; otros pares → `uses`), `setEdgeKind`, `updateEdge` (tipo, `label`, `when`), `removeEdge`, tours (`addTour`, `renameTour`, `removeTour`, `addStep`, `setStepNode`, `updateStepNote`, `moveStep`, `removeStep`; `removeNode` quita los pasos de ese nodo), `markSaved`. `toGraph` solo incluye `tours` si hay alguno. Un texto vacío quita el campo opcional (así el grafo recarga idéntico) y los textos se recortan al límite del schema. Toda acción que cambia algo pone `dirty: true`; las que no cambian nada no lo tocan.
- Tipos generados desde los JSON Schema (`pnpm gen:schema` → `src/schema/walkie-graph.ts`, `walkie-catalog-item.ts` y `walkie-asset.ts`; un schema nuevo se agrega a `targets` en `scripts/gen-schema-types.mjs`); si falta un campo, se cambia el schema primero. CI falla si los tipos no están al día (`pnpm check:schema`).
- URL de la API: `VITE_API_URL` (lee el `.env` de la raíz del repo).
- Auth (ADR-0003): `react-oidc-context`; `AuthGate` protege la app y las llamadas a la API llevan `auth.user.access_token`. En pruebas se mockea `useAuth`.
- Estilo pixel art: grilla de 8 px (`snapGrid={[8,8]}`), fuente Press Start 2P para títulos y VT323 para texto, sprites PNG con `image-rendering: pixelated`, paleta en `theme/palette.ts`. Sin sombras difusas ni gradientes.
- Pruebas: Vitest para el store y la lógica (`src/**/*.test.ts(x)`), Playwright para flujos (`e2e/*.spec.ts`).
- E2E: `docker compose -f infra/docker-compose.yml up -d postgres rustfs keycloak` y luego `pnpm --dir apps/web e2e --trace off`. Playwright levanta la API y la web (o reutiliza las que estén corriendo, salvo con `CI=1`). Cada prueba crea su propia app con nombre único. En CI corre el job `e2e`, con el reporte como artefacto si falla.
- Pruebas de páginas: `installFakeApi({ apps, features, canvases, catalog })` reemplaza `fetch` con una API en memoria que responde como `apps/api`; `renderRoute('/ruta')` monta las rutas reales con TanStack Query. Mockea `react-oidc-context` y, si no hace falta, `../canvas/Canvas` (React Flow).
- Editor: `FeaturePage` carga el grafo con `useCanvas` (sin refetch automático: después manda el store) y monta `<FeatureEditor initialGraph>`, que crea el store ya cargado. Guardar: botón o Ctrl+S → `useSaveCanvas` → `markSaved(version, estadoEnviado)` (si hubo cambios durante el guardado, siguen pendientes). 409 → aviso con "Recargar versión del servidor"; 400 → mensaje con la primera ruta de error. Con cambios sin guardar, `beforeunload` avisa al salir.
- Login: `signinRedirect({ state: currentPath() })` y `onSigninCallback` vuelven a la página de origen (solo rutas internas, `safeReturnTo`).
- Catálogo en el lienzo: `FeaturePage` carga el catálogo de la app y lo pasa a `<Canvas catalog>`, que lo da por `CatalogContext`. Un `ref` se dibuja y conecta como su elemento (`refTarget`, `effectiveType`); su título no se edita en el lienzo (sin doble clic, panel de solo lectura con "Editar en el catálogo"). El store no conoce el catálogo: `Canvas` calcula el tipo de conexión y lo pasa a `connect`.
- Lienzo: `<Canvas store={store} />`. La selección, el nodo en edición y las medidas son estado de UI local de `Canvas`, no del store. Con un solo nodo o una sola conexión seleccionados, `Canvas` pasa su id a `<PropertiesPanel>` (tercera columna); si no, el panel muestra ayuda y la sección "Tours" (el tour abierto lo guarda `Canvas`, así no se pierde al seleccionar un nodo; "Ver tour" llama a `onPlayTour`). Nodos y conexiones leen y cambian el grafo con `useGraphStore(selector)`.
- Portales: `FeaturePage` pasa también las features de la app y la actual (`toCanvasCatalog(appId, items, features, featureId)`). El nodo muestra el nombre actual del destino (`title` guarda el último conocido); "Abrir" y el doble clic usan `useOpenFeature`, que confirma con `window.confirm` si hay cambios sin guardar (la navegación interna no dispara `beforeunload`).
- Imágenes (ADR-0004): `<img src>` no manda el token, así que `useAssetUrl` pide los bytes con `fetch` y devuelve una URL `blob:` (una vez por sesión: un asset no cambia). `useUploadAsset` sube con `FormData`; el panel valida tipo y tamaño antes (`ASSET_TYPES`, `ASSET_MAX_SIZE`).
- Llamadas a la API: siempre por los hooks de `api/hooks.ts` (ponen el token y las `queryKeys`); los errores llegan como `ApiError` con `userMessage` del `ProblemDetails`.

## Trampas conocidas

- **Versiones fijadas a propósito**: TypeScript 5.9, ESLint 9, Vite 7, Vitest 4, `@vitejs/plugin-react` 5, react-router 7 (la 8 es muy nueva). Las majors más nuevas (TS 7, ESLint 10, Vite 8) aún no son compatibles entre sí ni con `typescript-eslint`. No las subas sin correr lint + test + build.
- **pnpm 10.28.0** fijado en `packageManager` de `apps/web/package.json` **y** del `package.json` de la raíz (que existe solo para eso). Si falta el de la raíz, con corepack activo `pnpm --dir apps/web …` baja otra versión y falla con `ERR_PNPM_BAD_PM_VERSION`. Si cambias la versión, cámbiala en los dos. En CI se usa `pnpm/action-setup` con `package_json_file: apps/web/package.json`.
- **`tsconfig.app.json` no incluye tipos de Node**: las pruebas en `src/` no pueden usar `node:fs`. La coherencia con el schema la verifica `pnpm check:schema`, no una prueba.
- **`src/schema/` está excluido de ESLint** (código generado).
- **`format` en los schemas** (ej. `uuid`): el job `schema` del CI compila con `ajv-formats`; sin él, ajv en modo estricto falla con `unknown format`.
- **Formato**: no hay config de Prettier; el código sigue `prettier --print-width 120 --single-quote`. Con los valores por defecto (80 columnas, comillas dobles) reformatea el archivo entero.
- **Pruebas del store**: guarda el resultado de una acción antes de leer el estado (`const id = s().addNode(...); s().nodes[id]`). `s().nodes[s().addNode(...)]` lee el estado viejo.
- **`Math.round` puede dar `-0`** y `toEqual` distingue `-0` de `0`: `snap()` lo normaliza.
- **Quitar una clave de un objeto**: usa `omit()` del store; desestructurar con `_variable` sin usar rompe el lint (`no-unused-vars`).
- **React Flow controlado**: `Canvas` reconstruye los nodos desde el store; hay que devolverles `measured` (guardado de los cambios `dimensions`). Sin eso, React Flow los oculta un instante para medirlos en cada cambio (ej. al seleccionar) y se pierden clics: el doble clic para editar fallaba.
- **`fitView` con lienzo vacío**: ajusta el zoom cuando aparece el primer nodo y los siguientes caen en otro sitio. Solo se usa si el lienzo ya trae nodos al montarse.
- **React Flow no deselecciona lo borrado**: un cambio `remove` no trae `select: false`. `Canvas` quita el id de la selección y el panel filtra por lo que existe (las conexiones borradas en cascada nunca reciben `remove`).
- **Doble clic en nodos**: usa `onNodeDoubleClick` del `<ReactFlow>` y pasa `editing` por `data`; con `zoomOnDoubleClick={false}`.
- **Fast refresh (`react-refresh/only-export-components`)**: un `.tsx` solo exporta componentes. Constantes y hooks van en `.ts` aparte (por eso existen `nodeMeta.ts`, `edgeMeta.ts`, `paletteTypes.ts`, `useGraphStore.ts`).
- **Probar el lienzo con Playwright**: usa los helpers de `e2e/helpers.ts` (`dropNode` dispara el HTML5 DnD con `dataTransfer`; `connect` arrastra de `.react-flow__handle-right` a `.react-flow__handle-left`).
- **`@playwright/test` fijado en 1.63.0**: es la versión de los navegadores preinstalados en la nube (`/opt/pw-browsers`); no corras `playwright install` ahí. Si la subes, el CI la instala solo, pero en la nube habrá que usar `executablePath`.
- **Login en E2E**: después del clic en "Iniciar sesión" espera `form.or(botón Salir)`; revisar el formulario de Keycloak sin esperar falla porque la navegación aún no ocurrió.
- **Vitest solo corre `src/**/*.test.ts(x)`** (`vite.config.ts`): sin eso recogería `e2e/*.spec.ts`.
- **Layout del editor**: `.feature-editor` es flex en columna y `.feature-canvas` tiene `flex: 1`. Con grid y filas fijas, si el aviso de conflicto no está, el lienzo cae en una fila `auto` y se encoge.
- **Sesión por pestaña**: el token vive en `sessionStorage`, así que una pestaña nueva muestra "Iniciar sesión" (entra sin contraseña si Keycloak tiene sesión). En Playwright, cada `newPage()` necesita ese clic.
- **`history.replaceState` no avisa a react-router**: tras cambiarlo, dispara `popstate` (ver `onSigninCallback`).
- **Pruebas del editor**: mockea `./Canvas` con un lienzo mínimo que lee y cambia el store (React Flow no corre bien en jsdom); `installFakeApi` ya responde `GET/PUT` del lienzo con 409 por versión, y `api.next.putStatus = 400` fuerza un 400.
- **Probar una conexión sin `<ReactFlow>`**: `EdgeLabelRenderer` hace un portal a un contenedor que solo existe dentro de `<ReactFlow>`; en Vitest se mockea para renderizar en línea (ver `src/canvas/canvas.test.tsx`).
- **Campos del panel**: el store recorta espacios, así que un input atado directo al store no deja escribir un espacio final. Usa `TextField` (borrador local que se sincroniza si el store cambia por otra vía; con `validate` muestra el error y no llama a `onChange`, ej. nombres de input repetidos).
- **Etiquetas únicas en la página**: la miga de pan es `<nav aria-label="Ruta">`; un campo "Ruta" choca con `getByLabel` en Playwright (por eso el panel dice "Ruta HTTP"). También hay dos `role="status"` (API ok y guardado): usa `.save-status`. En el panel, "Tipo" y "Nombre" se repiten por input: usa `.nth(i)`.
- **Ancho del lienzo en E2E**: con paleta (200 px) y panel (280 px), a 1280 px el lienzo mide ~760 px; los `dropNode` deben caer dentro (x < 700).
- **Mutaciones y formularios con `key={version}`**: si el formulario se monta de nuevo al guardar (nueva versión), una mutación creada dentro pierde `isSuccess`/`error`. Créala en el padre y pásala (ver `ItemDetail` en `CatalogPage.tsx`); al recargar tras un 409, `update.reset()`.
- **Respuestas 204**: `request()` de `api/client.ts` devuelve `undefined` sin leer el cuerpo. `send()` solo pone `Content-Type: application/json` si el cuerpo es texto (con `FormData` lo pone el navegador).
- **Imágenes en Vitest**: jsdom no tiene `URL.createObjectURL` (stúbalo en la prueba) y el `Response` de Node no lee un `File` de jsdom (por eso `installFakeApi` devuelve bytes fijos en `GET /api/assets/{id}`). `api.next.uploadStatus = 400` fuerza un rechazo.
- **`Link` fuera de un router**: la paleta con catálogo y el panel de un `ref` usan `<Link>`; en Vitest envuélvelos en `<MemoryRouter>`.
- **Componentes del panel que llaman a la API** (`MoveToCatalog`): solo se montan con catálogo en el contexto (`appId`), así las pruebas del panel sin `QueryClientProvider` siguen funcionando.
- **Diálogos nativos en Playwright**: `window.confirm` se acepta o cancela con `page.once('dialog', d => d.dismiss())` antes de la acción; en Vitest, `vi.spyOn(window, 'confirm').mockReturnValue(...)`.
- **Componentes que usan auth**: mockea `react-oidc-context` con `vi.mock` (ver `src/auth/AuthGate.test.tsx`).
- **Probar a mano el login**: Keycloak en :8080 (docker-compose), API en :5080, web en :5173; usuario `dev` / `walkie_dev`. Con Playwright: botón "Iniciar sesión" → `#username`, `#password`, `#kc-login`.

## Cómo crear un tipo de nodo

1. Agregar el tipo en `packages/schema` y regenerar tipos.
2. Etiqueta y glifo en `nodes/nodeMeta.ts`, color en `theme/palette.ts`, registrarlo en `nodes/nodeTypes.ts` (por defecto `PixelNode`; componente propio en `nodes/<Tipo>Node.tsx` si necesita contenido distinto). Para que aparezca en la paleta: `canvas/paletteTypes.ts`.
3. Sprite en `packages/sprites` (múltiplos de 8 px).
4. Campos propios del tipo en `panel/PropertiesPanel.tsx` (`NodePanel`).
5. Prueba del store + un caso en Playwright.
