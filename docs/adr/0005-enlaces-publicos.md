# ADR-0005: Enlaces de solo lectura con token, sin sesión, con caducidad y revocables

- Estado: aceptado
- Fecha: 2026-11-08

## Contexto

La fase 4 pide compartir una feature con quien no tiene usuario en Walkie: otro equipo, producto o una persona que se incorpora. ADR-0003 exige usuario autenticado en todo endpoint (solo `/api/health` es público) y ADR-0004 sirve las imágenes solo con sesión, porque pueden mostrar flujos internos de un banco. Un enlace para compartir necesita una excepción acotada a las dos reglas.

## Opciones consideradas

1. **Token aleatorio en la URL, sin sesión, guardado como hash, con caducidad y revocable**: lo abre cualquiera que tenga el enlace. Contras: quien reenvíe el enlace da acceso hasta que caduque o se revoque.
2. **Enlace que exige iniciar sesión**: sin endpoints públicos. Contras: hoy cualquier usuario con sesión ya ve todas las apps, así que no suma nada, y no sirve para quien no tiene usuario en Keycloak.
3. **Token guardado cifrado** (en vez de su hash) para poder copiar la URL otra vez desde la lista. Contras: requiere una clave por variable de entorno y su rotación; con la base y la clave filtradas, los enlaces sirven.

## Decisión

Opción 1. Módulo `Walkie.Modules.Sharing` (schema `sharing`, tabla `sharing.shares`):

- El token tiene 256 bits aleatorios (`RandomNumberGenerator`) en base64url (43 caracteres). Solo viaja en la respuesta de creación; la base guarda su SHA-256 (`token_hash`, único). La web arma la URL `/s/{token}`.
- Cada enlace comparte una sola feature y caduca a los 7, 30 o 90 días. Revocarlo marca `revoked_at`; la URL deja de funcionar en el acto.
- Los endpoints con sesión (`/api/features/{featureId}/shares`, `/api/shares/{shareId}`) siguen ADR-0003.
- Los públicos van bajo `/api/public/shares/{token}` con `AllowAnonymous()` y solo devuelven esa feature: su grafo, los elementos del catálogo que usa, los nombres de la app y de la feature, y las imágenes que sus pantallas usan. Un enlace revocado, caducado o inexistente responde 404 sin distinguir el caso.

## Consecuencias

- Positivas: se comparte con cualquiera sin crear usuarios. Si la base se filtra, los enlaces no sirven. El alcance es mínimo (una feature) y con fecha de fin.
- Negativas / costos: la URL se ve una sola vez (si se pierde, se revoca y se crea otro). Quien tenga el enlace ve las imágenes de esas pantallas: el diálogo lo avisa. No hay límite de peticiones por IP todavía (con 256 bits el token no se adivina; se evalúa en el deploy). Solo se registra el último acceso, no el historial.
- Qué habría que hacer para revertirla: quitar los endpoints `/api/public/*` y la ruta `/s/:token` de la web; los enlaces dejan de funcionar y la tabla puede borrarse.
