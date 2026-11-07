# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).

## [Unreleased]

### Added
- Spec y plan de `imagenes-portal` (fase 2, feature 3 de 3), con issues por tarea.
- E2E del catálogo (catalogo, tarea 6): un elemento usado con `ref` en dos features, editado una vez y visto cambiado en ambas; "Mover al catálogo"; guardar y recargar idéntico; borrado bloqueado por uso. Cierra la feature.
- "Mover al catálogo" (catalogo, tarea 5): en el panel de un nodo `api`, `service` o `database`, crea el elemento con su título, descripción, método y ruta, y convierte el nodo en `ref` con el mismo id, posición y conexiones.
- Nodos `ref` en el lienzo (catalogo, tarea 4): sección "Catálogo" en la paleta (arrastrar o clic); el nodo se ve como su elemento con marca "catálogo" y datos actuales, o "Elemento no encontrado"; conecta con el tipo de su elemento; panel de solo lectura con "Editar en el catálogo".
- Página del catálogo (catalogo, tarea 3): `/apps/:appId/catalog`, enlazada desde la app; elementos agrupados por tipo con `MÉTODO /ruta`; crear; editar título, descripción, método y ruta con aviso y recarga si otra persona guardó antes; "Usado en" con enlaces a los lienzos; borrar, o la lista de lienzos que lo impiden.
- Referencias al catálogo en la API (catalogo, tarea 2): el lienzo valida que cada `ref` apunte a un elemento de su app (400 en `/nodes/{id}/catalogId`); `GET /api/catalog/{itemId}/usages` ("Usado en") y `DELETE /api/catalog/{itemId}` (204, o 409 con las features que lo usan).
- Catálogo en la API (catalogo, tarea 1): `packages/schema/walkie-catalog-item.schema.json`, `catalogId` obligatorio en nodos `ref`; tabla `apps.catalog_items` y `GET/POST /api/apps/{appId}/catalog`, `GET/PUT /api/catalog/{itemId}` con concurrencia optimista (409).
- Spec y plan de `catalogo` (fase 2, feature 2 de 3), con issues por tarea.
- E2E de panel-propiedades (tarea 6): pantalla con inputs y regla asociada, API con método y ruta y conexión con condición; guardar, recargar idéntico (lienzo y panel) y borrar la regla sin dejar referencias rotas. Cierra la feature.
- Inputs en el panel (panel-propiedades, tarea 5): una pantalla agrega, edita (nombre, tipo, obligatorio, opciones de un `enum` una por línea) y quita inputs; los asocia a reglas del lienzo; avisa si un nombre se repite. El panel de una regla muestra qué inputs la usan.
- Panel de propiedades (panel-propiedades, tarea 4): columna derecha del lienzo; con un nodo seleccionado edita título, descripción, expresión (regla) y método y ruta (API); con una conexión, tipo, etiqueta y condición; con cero o varios, muestra ayuda. Los cambios se ven al instante en el lienzo.
- Lienzo con contenido (panel-propiedades, tarea 3): `actor`, `rule` y `service` en la paleta; los nodos muestran descripción, `MÉTODO /ruta`, hasta 5 inputs (obligatorios con `*`) y 3 líneas de la expresión, con "+N más"; las conexiones muestran su etiqueta y su condición (`[200]`).
- Store de propiedades (panel-propiedades, tarea 2): `updateNode` (título, descripción, expresión, método y ruta), `addInput`/`updateInput`/`removeInput` con nombres únicos y `options` solo en `enum`, `updateEdge` (tipo, etiqueta, condición); borrar una regla limpia los inputs que la usaban; tipos por defecto para `actor→screen`, `api→service`, `service→database` y `screen→rule`.
- Schema y validación de propiedades (panel-propiedades, tarea 1): límites en `description`, `expression` (2000), `input.name` y `edge.label/when` (60); `input.options` para inputs `enum`. La API responde 400 si un input apunta a una regla que no existe o a un nodo que no es `rule`, repite nombre en el nodo o tiene `options` sin ser `enum`.
- Spec y plan de `panel-propiedades` (fase 2, feature 1 de 3), con issues por tarea.
- E2E con Playwright del flujo completo (lienzo-base, tarea 8): crear, dibujar, grilla de 8 px, tipos de conexión, editar, borrar, guardar, recargar idéntico y conflicto 409 con dos pestañas, contra API, Keycloak y Postgres reales; job `e2e` en CI. Cierra la fase 1.
- Guardar y recargar el lienzo (lienzo-base, tarea 7): botón Guardar y Ctrl+S, indicador "Sin guardar"/"Guardado", aviso al salir con cambios, 409 con opción de recargar la versión del servidor y 400 con el motivo.
- Lienzo editable (lienzo-base, tarea 6): paleta lateral (arrastrar o clic) con `screen`, `api` y `database`; nodos pixel v1 con color por tipo; conexiones en escalones con etiqueta y selector de tipo; editar el título con doble clic (Enter confirma, Escape cancela); borrar con Supr.
- Navegación de apps y features (lienzo-base, tarea 5): rutas con react-router (lista de apps → app → lienzo de la feature), formularios para crear apps y features con TanStack Query, mensajes de carga, vacío, 404 y validación.
- Store del grafo en la web (lienzo-base, tarea 4): `createGraphStore()` con Zustand, estado normalizado por ID, IDs UUID v7, snap a 8 px, tipo de conexión por defecto según el par, borrado en cascada y flag `dirty`.
- Guardar y cargar el lienzo (lienzo-base, tarea 3): `GET/PUT /api/features/{featureId}/canvas` con validación contra `packages/schema` e integridad del grafo (400), concurrencia optimista (409 con `currentVersion`) y 404 si la feature no existe.
- Endpoints de apps y features (lienzo-base, tarea 2): `POST/GET /api/apps`, `GET /api/apps/{appId}`, `POST/GET /api/apps/{appId}/features`, con FluentValidation (400 `ValidationProblemDetails`), 404 y 401.
- Documentación de trampas conocidas por app y guía de sesiones en la nube en `docs/workflow.md`.
- Persistencia (lienzo-base, tarea 1): módulos `Walkie.Modules.Apps` y `Walkie.Modules.Canvas` con EF Core + Npgsql, schema por módulo, migración inicial (`apps`, `features`, `canvases` con `graph jsonb` y `version`), migraciones al arrancar en Development y pruebas con Postgres real (Testcontainers).
- Auth básica con OIDC (ADR-0003): Keycloak en docker-compose con realm de desarrollo, la API valida JWT y exige sesión por defecto (`/api/me`), la web inicia sesión con PKCE.
- Spec y plan de `lienzo-base` (fase 1), con issues por tarea.
- Fase 0: esqueleto de `apps/api` (.NET 10: host con `/api/health`, ProblemDetails, CORS, OpenAPI; `Walkie.Shared`; pruebas de integración) y de `apps/web` (Vite + React + React Flow con grilla de 8 px, TanStack Query, tipos generados desde el schema, Vitest, ESLint). CI valida que los tipos del schema estén al día.
- Estructura inicial del repo: documentación, ADR-0001 (stack), ADR-0002 (lienzos por feature), schema del grafo v0, devcontainer, docker-compose, CI y plantillas de GitHub.

### Fixed
- Al borrar un nodo o una conexión seleccionados, su id quedaba en la selección y el panel mostraba la ayuda al seleccionar otro elemento.
- Tras iniciar sesión se volvía siempre al inicio; ahora se vuelve a la página que se estaba abriendo.
- `pnpm --dir apps/web …` desde la raíz fallaba con corepack activo; un `package.json` mínimo en la raíz fija la versión de pnpm.
- Petición sin cuerpo o con JSON inválido respondía 500; ahora 400.
