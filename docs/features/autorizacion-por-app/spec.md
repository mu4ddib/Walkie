# Spec: autorización por app

- Issue padre: #175
- Estado: aprobada (2026-11-19, en el plan de D1)

## Objetivo

Que cada app solo la vean y cambien las personas que son miembros, con un rol (`owner`, `editor`, `viewer`), en toda la API y la web: hoy cualquier usuario autenticado lee y escribe cualquier app.

## Usuarios

- Un equipo que documenta una app privada (por ejemplo, un proyecto de banca analizado con Walkie Live) y no quiere que otros equipos la vean.
- Quien crea una app (queda como `owner`) y suma a su equipo.
- Quien entra a Walkie y solo debe ver las apps que le compartieron.

## Criterios de aceptación

**Membresías y roles**

- [ ] Dada una app nueva (creada vacía, importada de un `.walkie` o desde un proyecto local), cuando se crea, entonces quien la creó queda como `owner` en la misma operación.
- [ ] Dadas las apps que ya existían, cuando se migra la base, entonces cada una tiene como `owner` a quien la creó (`created_by`), y nada más cambia.
- [ ] Dado un `viewer`, entonces lee todo lo de la app (features, módulos, catálogo, lienzos, imágenes, mapa, export, análisis, evidencia, procedencia) y no puede cambiar nada.
- [ ] Dado un `editor`, entonces además crea y edita features, módulos, catálogo, lienzos, mapa, imágenes, importa a la app, sube análisis y decide en la revisión. No borra elementos del catálogo ni módulos, no maneja enlaces de solo lectura ni miembros.
- [ ] Dado un `owner`, entonces además borra, crea, lista y revoca enlaces de solo lectura, y administra miembros.

**Acceso indebido**

- [ ] Dada una persona que no es miembro, cuando pide cualquier recurso de esa app (por id de app, feature, módulo, elemento, imagen, enlace o análisis), entonces recibe **404**, como si no existiera.
- [ ] Dado un miembro con rol insuficiente, cuando intenta una acción de un rol mayor, entonces recibe **403** con un mensaje claro.
- [ ] Dado `GET /api/apps`, entonces solo lista las apps de las que soy miembro, cada una con mi rol.
- [ ] Dado un endpoint nuevo con un recurso de app en la ruta y sin protección, entonces una prueba automática falla.
- [ ] Los enlaces públicos de solo lectura (ADR-0005) siguen funcionando sin sesión.

**Miembros**

- [ ] Dado un `owner`, cuando agrega a alguien por correo con un rol, entonces esa persona pasa a ver la app; si el correo es de alguien que nunca entró a Walkie, se le dice que primero inicie sesión.
- [ ] Dado un `owner`, cuando cambia un rol o quita a alguien, entonces se aplica de inmediato. Cualquier miembro puede quitarse a sí mismo.
- [ ] Siempre queda al menos un `owner` (409 si se intenta quitar o degradar al último).

**Web**

- [ ] Dado un `viewer`, entonces ve los lienzos en solo lectura (sin paleta, edición, guardar ni compartir) y no ve acciones de crear, editar, borrar, importar ni decidir; exportar sigue disponible.
- [ ] Dado un `owner`, entonces tiene «Miembros» en la página de la app: lista con rol, agregar por correo, cambiar rol, quitar.
- [ ] Dado un 404 o 403 de acceso, entonces la web dice «No tienes acceso a esta app» (o el motivo del 403), sin pantallas rotas.

## Fuera de alcance

- Invitaciones a personas que nunca entraron a Walkie, correos de invitación o búsqueda en Keycloak.
- Equipos o grupos, permisos por feature o por elemento, roles personalizados.
- Un rol de administración del despliegue.
- Habilitar Walkie Live para usuarios reales: además de esto, falta lo listado en `docs/features/walkie-live/validacion.md` §17 y §18.

## Impacto en el modelo

- `walkie-graph` no cambia.
- Nuevo `walkie-app-member.schema.json` (miembro: `userId`, `name`, `email`, `role`, `grantedAt`) y `role` en la respuesta de una app.

## Impacto en la API

- **Todos** los endpoints con un recurso de app en la ruta exigen un rol mínimo (404/403 como arriba).
- `GET /api/apps`: solo las apps del usuario, con `role`.
- `GET /api/apps/{appId}/members` (viewer), `POST /api/apps/{appId}/members` `{email, role}` (owner; 400 si la persona nunca entró; 409 si ya es miembro), `PUT /api/apps/{appId}/members/{userId}` `{role}` (owner; 409 si deja la app sin owner), `DELETE /api/apps/{appId}/members/{userId}` (owner, o uno mismo; 409 si es el último owner).
- Tablas nuevas `apps.memberships` y `apps.users` (esta última se completa con lo que dice el token de quien entra).

## Preguntas abiertas

- Ninguna para este incremento. Las decisiones del usuario están en ADR-0015.
