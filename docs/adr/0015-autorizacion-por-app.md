# ADR-0015: Autorización por app con membresías y roles

- Estado: aceptado (2026-11-19). Se implementa en `docs/features/autorizacion-por-app`; hasta que esté en `main`, sigue siendo bloqueante para cualquier piloto de Walkie Live con proyectos privados
- Fecha: 2026-11-19

## Contexto

Hoy cualquier usuario autenticado lee y escribe cualquier app: `GET /api/apps` lista todas, y ningún endpoint compara el `sub` del token con la app (ADR-0003 solo autentica). Con Walkie Live esto expone rutas de archivos, nombres internos, la estructura de proyectos privados y su evidencia. ADR-0012 dejó Discovery detrás de `Discovery:Enabled` (apagado fuera de Development) hasta resolverlo. Que el flag esté apagado no resuelve nada: es una mitigación. La validación de la tarea 11 lo confirma: ninguna prueba frena un acceso entre apps, porque no hay regla que probar.

## Opciones consideradas

1. **Membresías por app con roles fijos** (`owner`, `editor`, `viewer`) en una tabla de Apps y una política de ASP.NET Core que resuelve la app de cada recurso. Pros: simple, auditable, cubre todos los módulos con un solo punto de decisión; las pruebas IDOR son directas. Contras: hay que resolver la app de cada id (feature, lienzo, elemento del catálogo, análisis, vínculo, imagen) en cada endpoint.
2. **Grupos o roles de Keycloak por app** (claims en el token). Pros: la administración vive en el IdP. Contras: tokens que crecen con cada app; un permiso nuevo exige un token nuevo; acopla el modelo a Keycloak; no sirve para enlaces ni para apps creadas en la sesión.
3. **ACL por recurso.** Pros: granular. Contras: excesivo para el modelo de Walkie, donde todo cuelga de una app; caro de probar y de explicar.

## Decisión

Se propone la opción 1. Una tabla `apps.memberships (app_id, user_id, role, granted_by, granted_at)` y una política `AppAccess(role mínimo)`. Un `IAppAccess` (en Apps, consumido por los demás módulos como `ICatalogUsage`) resuelve la app de cada recurso y decide. Discovery solo se habilita para usuarios reales cuando esta política cubre todos sus endpoints y pasan las pruebas IDOR.

**Decisiones al aceptarlo (2026-11-19):**

- **Quiénes son las personas:** Walkie guarda `apps.users` (`sub`, nombre y correo del token) cuando alguien entra. Un owner suma a otra persona **por su correo**, si ya entró al menos una vez; si no, se le pide que inicie sesión primero. No se usa la API de administración de Keycloak.
- **Roles:** como abajo. `editor` no borra ni maneja enlaces ni miembros.
- **Web:** un `viewer` ve todo en solo lectura (lienzos sin edición, sin crear, borrar, importar ni decidir); el owner tiene «Miembros» en la página de la app.

## Detalle

- **Roles mínimos:** `viewer` lee; `editor` además escribe (lienzos, catálogo, features, módulos, imágenes, decisiones de Discovery); `owner` además administra miembros, comparte enlaces y borra.
- **Lectura y escritura:** cada `GET` exige `viewer` de la app del recurso; cada escritura, `editor`. `GET /api/apps` lista solo las apps del usuario.
- **Snapshots y evidencia:** `review`, `evidence`, `bindings` (procedencia) y `sources` exigen `viewer` de la app del análisis. Una evidencia se resuelve por su análisis, nunca por la clave sola.
- **Bindings y apply:** `POST /api/snapshots/{id}/apply` exige `editor` de la app del análisis. Un `link` además valida que el destino sea de esa app (ya lo hace).
- **Crear e importar apps:** cualquier usuario autenticado crea una app (`POST /api/apps`, `/api/apps/import`, `/api/sources/import`) y queda como `owner` en la misma operación. En `source_imports`, la membresía se crea junto con la app. Importar a una app existente exige `editor`.
- **Fuentes compartidas:** una fuente (`source.id`) pertenece a una app. La misma fuente en dos apps son dos registros independientes, con decisiones y análisis propios. El aviso `source-in-other-apps` no revela nombres de apps a quien no es miembro.
- **Usuarios sin permiso:** se responde 404 (no 403) cuando el recurso es de una app de la que no es miembro, para no confirmar que existe. Un miembro con un rol insuficiente recibe 403.
- **Operaciones de mantenimiento** (resolver una `source_import` pendiente o una aplicación atascada): solo `owner` de la app. Hasta que exista esta política, quedan como procedimiento operativo (ver `docs/features/walkie-live/validacion.md`) y no se exponen a usuarios finales.
- **Migración de apps existentes:** cada app recibe un `owner` = `apps.created_by`. Las apps sin creador conocido (datos de prueba) quedan sin miembros, visibles solo para un rol de administración del despliegue. Los enlaces públicos (ADR-0005) no cambian.
- **Pruebas obligatorias:** por cada endpoint con id en la ruta, otro usuario sin membresía recibe 404 y uno `viewer` recibe 403 al escribir. Hay pruebas específicas de IDOR para análisis, evidencia, `apply`, procedencia, importación, imágenes y lienzos; un listado no filtra nada de otras apps.

## Consecuencias

- **Positivas:** un solo punto de decisión, pruebas IDOR mecánicas, y Discovery puede habilitarse en un piloto.
- **Negativas / costos:** resolver la app de cada recurso (consulta extra o caché por solicitud); una pantalla de miembros; migración de datos; revisar todos los endpoints y pruebas existentes (todas usan un solo usuario hoy).
- **Qué habría que hacer para revertirla:** quitar la política y la tabla; los datos de Walkie no dependen de ella.
