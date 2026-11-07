# Spec: Lienzo base

- Issue padre: #2
- Estado: implementada (2026-11-07), verificada por `apps/web/e2e/lienzo-base.spec.ts`

## Objetivo

Un desarrollador crea una App y una Feature, arma su lienzo con nodos `screen`, `api` y `database`, los conecta y lo guarda para recargarlo exactamente igual.

## Usuarios

Desarrollador autenticado que documenta un flujo existente.

## Criterios de aceptación

1. **Crear app.** Dado que inicié sesión, cuando creo una App con nombre, entonces aparece en mi lista de apps.
2. **Crear feature.** Dada una App, cuando creo una Feature con nombre, entonces aparece en la App y abre un lienzo vacío.
3. **Agregar nodos.** Dado un lienzo, cuando arrastro `screen`, `api` o `database` desde la paleta lateral, entonces aparece un nodo de ese tipo con título por defecto ("Pantalla", "API", "Base de datos").
4. **Mover con grilla.** Cuando arrastro un nodo, entonces su posición queda en múltiplos de 8 px.
5. **Conectar.** Cuando uno dos nodos, entonces se crea una conexión con un tipo por defecto según el par (`screen→screen`: `navigation`; `screen→api`: `request`; `api→screen`: `response`; `api→database`: `reads`; cualquier otro par: `uses`) y puedo cambiarlo a `navigation`, `request`, `response`, `reads` o `writes`.
6. **Editar título.** Cuando hago doble clic en el título de un nodo, entonces puedo editarlo (máx. 120 caracteres) y Enter lo confirma.
7. **Borrar.** Cuando selecciono un nodo o una conexión y presiono Supr, entonces se borra; borrar un nodo borra sus conexiones y su `layout`.
8. **Guardar y recargar.** Dado un lienzo con cambios, cuando guardo (botón o Ctrl+S) y recargo la página, entonces aparece idéntico (nodos, conexiones, posiciones). La UI marca "sin guardar" mientras haya cambios pendientes y el navegador avisa si intento salir con cambios sin guardar.
9. **Conflicto.** Dado que otra pestaña guardó antes, cuando guardo con una versión vieja, entonces la API responde 409 y la UI ofrece recargar la versión del servidor (sin fusión automática).
10. **Grafo inválido.** Cuando la API recibe un grafo que no cumple el schema, entonces responde 400 con `ProblemDetails` que indica el error.
11. **Estilo pixel v1.** Los nodos usan Press Start 2P en el título, VT323 en el texto, borde de 4 px sin sombras difusas ni gradientes, color por tipo desde `theme/palette.ts`.

## Fuera de alcance

- Panel de propiedades detallado (inputs, request/response): fase 2.
- Nodos `actor`, `rule`, `service`, catálogo, `ref` y `portal`: fase 2.
- Tours: fase 3.
- Permisos por app/feature y colaboración: post-MVP. En esta fase cualquier usuario autenticado ve y edita todas las apps.
- Deshacer/rehacer.
- Renombrar o borrar apps y features.

## Impacto en el modelo

Sin cambios en `packages/schema/walkie-graph.schema.json` (v0 ya cubre `nodes`, `edges`, `layout`, `version`). La API valida el grafo contra ese mismo archivo.

## Impacto en la API

Todos los endpoints requieren autenticación (401 sin token).

- `POST /api/apps` `{ name }` → 201 · `GET /api/apps` · `GET /api/apps/{appId}`
- `POST /api/apps/{appId}/features` `{ name }` → 201 · `GET /api/apps/{appId}/features`
- `GET /api/features/{featureId}/canvas` → el grafo (`WalkieGraph`, con su `version`). Una feature nueva devuelve un grafo vacío con `version: 0`.
- `PUT /api/features/{featureId}/canvas` con el grafo → 200 con el grafo guardado y `version` + 1 | 409 si `version` no coincide con la guardada (`ProblemDetails` con `currentVersion`) | 400 si no cumple el schema o su integridad | 404 si la feature no existe.
- Integridad (lo que el schema no expresa): la clave de cada nodo y conexión es igual a su `id`; `from`/`to` y las claves de `layout` apuntan a nodos existentes. Los errores van en `errors` por ruta JSON (ej. `/edges/e1/to`).

La versión viaja dentro del grafo (`version` ya es obligatorio en el schema), así que no hace falta un sobre `{ version, graph }`.

Base de datos: tablas `apps`, `features` y `canvases` (`feature_id`, `graph jsonb`, `version int`) con migraciones de EF Core.

## Decisiones tomadas

- Guardado manual (botón y Ctrl+S) en el MVP. El autosave queda para después, cuando exista la presencia de otros usuarios.
