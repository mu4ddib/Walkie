# Spec: Catálogo de la app y nodos `ref`

- Issue padre: #33
- Estado: aprobada (2026-11-07)
- Fase 2 ("cajas ricas"), feature 2 de 3. La 1 (panel-propiedades) está implementada; la 3 es imágenes + `portal`.

## Objetivo

Definir una sola vez las APIs, servicios y bases de datos de una app (su catálogo) y usarlas en los lienzos de varias features con nodos `ref`, de modo que un cambio en el catálogo se vea en todos los lienzos (ADR-0002).

## Usuarios

Desarrollador que documenta varias features de la misma app y no quiere copiar el mismo endpoint en cada lienzo. Lo lee quien se incorpora y quiere saber en qué flujos se usa un endpoint.

## Criterios de aceptación

**Catálogo de la app**

- [ ] 1. Dada una app, cuando abro su catálogo (`/apps/:appId/catalog`, enlazado desde la página de la app), entonces veo sus elementos agrupados por tipo (`api`, `service`, `database`) con su título y, en las APIs, `MÉTODO /ruta`.
- [ ] 2. Dado el catálogo, cuando creo un elemento con tipo y título, entonces aparece en la lista; el título es obligatorio (máx. 120) y el tipo solo puede ser `api`, `service` o `database`.
- [ ] 3. Dado un elemento, cuando edito su título, descripción y, si es `api`, método y ruta, y guardo, entonces el cambio queda guardado. Si otra persona lo guardó antes, la API responde 409 y la UI ofrece recargarlo (igual que el lienzo).
- [ ] 4. Dado un elemento, cuando abro su detalle, entonces veo en qué features se usa ("Usado en"), con enlace a cada lienzo.
- [ ] 5. Dado un elemento que no se usa en ningún lienzo, cuando lo borro, entonces desaparece. Si se usa, la API responde 409 con la lista de features que lo usan y la UI la muestra; no se borra.

**Nodos `ref` en el lienzo**

- [ ] 6. Dado un lienzo, cuando abro la paleta, entonces además de los tipos de siempre veo una sección "Catálogo" con los elementos de la app; al arrastrar uno (o hacer clic), se crea un nodo `ref` que apunta a él.
- [ ] 7. Dado un nodo `ref`, entonces se ve como el elemento al que apunta (color, glifo, título y `MÉTODO /ruta`) con una marca de "catálogo"; si el elemento cambia en el catálogo, el lienzo lo muestra cambiado al abrirlo.
- [ ] 8. Dado un nodo `ref` seleccionado, entonces el panel muestra los datos del elemento en solo lectura y un enlace "Editar en el catálogo"; el título del nodo no se edita con doble clic.
- [ ] 9. Dado que conecto un nodo `ref`, entonces el tipo por defecto de la conexión se calcula con el tipo del elemento (ej. `screen → ref(api)` es `request`).
- [ ] 10. Dado un lienzo con un nodo `ref` cuyo elemento ya no existe (caso límite: datos viejos), entonces el nodo se ve como "Elemento no encontrado" con su último título conocido y se puede borrar.
- [ ] 10b. Dado un nodo `api`, `service` o `database` del lienzo, cuando uso "Mover al catálogo" en su panel, entonces se crea el elemento en el catálogo con su título, descripción y método y ruta, y el nodo pasa a ser un `ref` a él con el mismo id, posición y conexiones; el lienzo queda "Sin guardar".

**Persistencia e integridad**

- [ ] 11. Dado un lienzo con nodos `ref`, cuando guardo y recargo, entonces aparece idéntico.
- [ ] 12. Dado un grafo con un nodo `ref` sin `catalogId`, con un `catalogId` que no existe o que es de otra app, cuando la API lo recibe, entonces responde 400 en `/nodes/{id}/catalogId`.

## Fuera de alcance

- Cuerpos de request y response y códigos de respuesta de las APIs: feature aparte ("contratos").
- Editar un elemento del catálogo desde el lienzo: el panel del `ref` es de solo lectura.
- Nodos `portal`, imágenes (feature 3).
- Historial o versiones de un elemento del catálogo; deshacer.
- Permisos por app (post-MVP: cualquier usuario autenticado edita todo).
- Buscar dentro del catálogo (con pocos elementos basta la lista agrupada).

## Impacto en el modelo

`packages/schema/walkie-graph.schema.json` ya tiene `type: "ref"` y `catalogId`. Cambios propuestos:

- Nodo `ref`: `catalogId` obligatorio (con `if type == ref then required catalogId`). `title` sigue obligatorio y guarda el **último título conocido** del elemento: el lienzo lo usa solo si el elemento no existe (criterio 10).
- Nuevo schema `packages/schema/walkie-catalog-item.schema.json` para un elemento del catálogo: `id`, `type` (`api` | `service` | `database`), `title` (máx. 120), `description` (máx. 2000), `http { method, path }` (solo `api`), `version` (concurrencia optimista). La web genera sus tipos igual que los del grafo.

## Impacto en la API

Módulo Apps (el catálogo es de la app):

- `GET /api/apps/{appId}/catalog` → lista de elementos.
- `POST /api/apps/{appId}/catalog` `{ type, title, description?, http? }` → 201 con `version: 1` | 400 | 404 si la app no existe.
- `GET /api/catalog/{itemId}` → elemento | 404.
- `PUT /api/catalog/{itemId}` con el elemento y su `version` → 200 con `version` + 1 | 409 con `currentVersion` | 400 | 404.
- `DELETE /api/catalog/{itemId}` → 204 | 409 `{ features: [{ id, appId, name }] }` si algún lienzo lo usa | 404.

- `GET /api/catalog/{itemId}/usages` → features cuyo lienzo tiene un `ref` a ese elemento | 404.

Módulo Canvas:

- `ICatalogUsage` (consulta `jsonb` de los grafos) para "Usado en" y el borrado.
- `PUT /api/features/{featureId}/canvas` valida que cada `catalogId` exista y sea de la app de la feature.

Comunicación entre módulos (sin ciclos): Apps expone `ICatalogDirectory` (Canvas valida `catalogId`) y define `ICatalogUsage`, que implementa Canvas, para que Apps sepa si un elemento está en uso antes de borrarlo.

Base de datos: tabla `apps.catalog_items` (`id`, `app_id`, `type`, `title`, `description`, `http_method`, `http_path`, `version`, `created_*`, `updated_*`) con migración. El tipo de un elemento no cambia después de crearlo (los `ref` dependen de él).

## Decisiones tomadas

1. Request/response y códigos de respuesta van en una feature aparte ("contratos"), después de esta.
2. Sí a "Mover al catálogo" (criterio 10b) para aprovechar los lienzos que ya existen.
3. El catálogo se edita solo en su página; el panel del `ref` es de solo lectura con enlace "Editar en el catálogo". El lienzo y el catálogo se guardan por separado.
