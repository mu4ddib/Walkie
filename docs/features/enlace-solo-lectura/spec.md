# Spec: Enlace de solo lectura

- Issue padre: #73
- Estado: aprobada (2026-11-08)
- Fase 4 ("compartir"), feature 1. Las otras entregas de la fase: export Markdown, deploy en la nube, piloto.

## Objetivo

Que quien documenta una feature cree un enlace que deje ver su lienzo y recorrer sus tours a alguien sin cuenta en Walkie, sin poder editar nada, por un tiempo limitado y revocable.

## Usuarios

- Autor: el desarrollador o líder que documentó la feature y quiere mostrarla a otro equipo, a producto o a alguien que todavía no tiene usuario en Keycloak.
- Lector: quien recibe el enlace. Abre la URL, ve el lienzo y recorre los tours. No inicia sesión.

## Criterios de aceptación

**Crear y gestionar enlaces (autor)**

- [ ] 1. Dado el lienzo de una feature, cuando uso "Compartir", entonces se abre un diálogo con el aviso "Quien tenga el enlace verá este lienzo, sus imágenes y sus tours sin iniciar sesión", la duración (7, 30 o 90 días; 30 por defecto) y "Crear enlace".
- [ ] 2. Dado que creo un enlace, entonces el diálogo muestra la URL completa una sola vez, con "Copiar". Después solo se ve en la lista, sin la URL.
- [ ] 3. Dado el diálogo, entonces lista los enlaces activos de la feature con fecha de creación, quién lo creó, cuándo caduca y su último acceso ("Nunca abierto" si no tiene), y cada uno con "Revocar".
- [ ] 4. Dado un enlace, cuando lo revoco, entonces sale de la lista y la URL deja de funcionar en el acto.

**Abrir un enlace (lector)**

- [ ] 5. Dado un enlace activo, cuando abro su URL sin sesión, entonces veo el nombre de la app y de la feature, la barra "Solo lectura · disponible hasta el <fecha>" y el lienzo como lo ve el autor: nodos con su contenido, imágenes de las pantallas, elementos del catálogo usados (`ref`) y conexiones.
- [ ] 6. Dado el lienzo compartido, entonces no se puede editar: sin paleta ni panel de propiedades, sin mover, conectar, renombrar ni borrar, y sin "Guardar". Sí se puede desplazar y hacer zoom.
- [ ] 7. Dado el lienzo compartido con tours, entonces se ve la lista de tours con "Ver tour", y el modo tour funciona como en el editor (spec modo-tour, criterios 5 a 8 y 10).
- [ ] 8. Dado un nodo `portal` en el lienzo compartido, entonces muestra su título y no se abre (ni con doble clic, ni con "Ir a <feature>" en el tour): la otra feature no está compartida.
- [ ] 9. Dado que el autor guarda cambios en el lienzo, cuando el lector recarga, entonces ve la última versión guardada.
- [ ] 10. Dado un enlace revocado, caducado o que no existe, cuando lo abro, entonces veo "Este enlace ya no está disponible" (sin decir cuál de los tres casos es).

**Seguridad (API)**

- [ ] 11. Dado un enlace activo, entonces sus endpoints públicos solo devuelven esa feature: su grafo, los elementos del catálogo que usa, el nombre de la app y de la feature, y solo las imágenes que sus pantallas usan. Cualquier otra imagen responde 404.
- [ ] 12. Dado que se crea un enlace, entonces la base guarda solo el hash del token (SHA-256), nunca el token.

## Fuera de alcance

- Compartir una app completa o varias features con un enlace; navegar portales dentro del enlace.
- Enlaces que exigen iniciar sesión, por persona o con contraseña.
- Foto fija del lienzo al crear el enlace (el enlace siempre muestra la última versión guardada).
- Ver el panel de propiedades completo de un nodo en el enlace (el nodo muestra su resumen).
- Editar la duración de un enlace ya creado (se revoca y se crea otro).
- Límite de peticiones por IP en los endpoints públicos (se evalúa en el deploy; con un token de 256 bits no se puede adivinar).
- Historial de accesos más allá del último; auditoría completa (post-MVP).
- Export Markdown (otra feature de la fase 4).

## Impacto en el modelo

Ninguno en `walkie-graph.schema.json`. Schemas nuevos en `packages/schema`:

- `walkie-share.schema.json`: un enlace (`id`, `featureId`, `createdBy`, `createdAt`, `expiresAt`, `lastAccessedAt` opcional y `url` solo en la respuesta de creación).
- `walkie-shared-feature.schema.json`: lo que ve el lector (`appName`, `featureName`, `expiresAt`, `graph` con `$ref` a `walkie-graph`, `catalog` con `$ref` a `walkie-catalog-item`).

## Impacto en la API

Módulo nuevo `Walkie.Modules.Sharing` (schema `sharing`, tabla `sharing.shares`: `id`, `feature_id`, `token_hash`, `created_by`, `created_at`, `expires_at`, `revoked_at`, `last_accessed_at`). Depende de Apps (`IFeatureDirectory`, `ICatalogDirectory`), Canvas (nuevo contrato `ICanvasReader` para leer el grafo) y Files (`IAssetDirectory` suma leer los bytes).

Con sesión:

- `POST /api/features/{featureId}/shares` `{ expiresInDays: 7 | 30 | 90 }` → 201 con el enlace y su `url` | 400 | 404.
- `GET /api/features/{featureId}/shares` → los enlaces activos (sin token) | 404.
- `DELETE /api/shares/{shareId}` → 204 | 404.

Públicos (`AllowAnonymous`, la única excepción a ADR-0003 aparte de health; se registra en un ADR nuevo):

- `GET /api/public/shares/{token}` → 200 con la feature compartida y actualiza `last_accessed_at` | 404 (revocado, caducado o inexistente, sin distinguir).
- `GET /api/public/shares/{token}/assets/{assetId}` → los bytes si la imagen es de la app y una pantalla del grafo actual la usa | 404.

Web: ruta `/s/:token` fuera de `AuthGate`, sin token OIDC; reutiliza el lienzo y `TourPlayer` en modo de solo lectura.

## Decisiones tomadas

1. Un enlace comparte una feature (su lienzo y sus tours), no la app. Decidido el 2026-11-08.
2. Lo abre cualquiera con el enlace, sin iniciar sesión; el token es aleatorio de 256 bits (base64url) y se puede revocar.
3. Caduca a los 7, 30 o 90 días (30 por defecto).
4. Muestra siempre la última versión guardada del lienzo.
5. La base guarda solo el hash SHA-256 del token: la URL se ve una sola vez al crearla (como un token de GitHub); si se pierde, se revoca y se crea otro. Si la base se filtra, los enlaces no sirven.
