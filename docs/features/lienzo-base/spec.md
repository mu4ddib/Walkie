# Spec: Lienzo base

- Issue padre: # (por crear)
- Estado: borrador

## Objetivo

Crear una app y una feature, armar su lienzo con nodos `screen`, `api` y `database`, conectarlos y guardar el lienzo para recargarlo exactamente igual.

## Usuarios

Desarrollador que documenta un flujo existente.

## Criterios de aceptación

- [ ] Puedo crear una App con nombre y una Feature dentro de ella.
- [ ] En el lienzo de la feature agrego nodos `screen`, `api` y `database` desde una paleta lateral.
- [ ] Arrastro nodos con snap a una grilla de 8 px.
- [ ] Conecto dos nodos y elijo el tipo de conexión (`navigation`, `request`, `response`, `reads`, `writes`).
- [ ] Edito el título de un nodo.
- [ ] Guardo el lienzo; al recargar la página aparece idéntico (nodos, conexiones, posiciones).
- [ ] Si guardo con una versión desactualizada, la API responde 409 y la UI me avisa.
- [ ] Los nodos tienen estilo pixel art v1 (fuente, bordes, colores por tipo).

## Fuera de alcance

- Panel de propiedades detallado (inputs, request/response): fase 2.
- Catálogo, `ref` y `portal`: fase 2.
- Tours: fase 3.
- Usuarios múltiples y permisos.

## Impacto en el modelo

Primera versión de `packages/schema/walkie-graph.schema.json`: `nodes`, `edges`, `layout`, `version`.

## Impacto en la API

- `POST /api/apps` · `GET /api/apps/{appId}`
- `POST /api/apps/{appId}/features` · `GET /api/apps/{appId}/features`
- `GET /api/features/{featureId}/canvas` → `{ version, graph }`
- `PUT /api/features/{featureId}/canvas` con `{ version, graph }` → 200 con nueva versión | 409 si está desactualizado | 400 si el grafo no cumple el schema

## Preguntas abiertas

- ¿Autosave cada N segundos o solo guardado manual en el MVP?
