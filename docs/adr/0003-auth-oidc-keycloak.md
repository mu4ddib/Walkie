# ADR-0003: Autenticación con OIDC; Keycloak en desarrollo

- Estado: aceptado
- Fecha: 2026-11-06

## Contexto

La fase 0 pide auth básica. El público objetivo es banca, que exige SSO corporativo (OIDC/SAML) y no acepta que cada herramienta guarde contraseñas. Hoy hay un solo desarrollador y aún no existe base de datos de usuarios.

## Opciones consideradas

1. **JWT propio** — usuarios y hash de contraseña en Postgres; la API emite el token. Simple y sin infraestructura extra, pero Walkie guarda contraseñas y hay que mantener registro, recuperación y bloqueo.
2. **ASP.NET Core Identity (`MapIdentityApi`)** — registro y login listos. Tokens propios de Identity (no JWT estándar), esquema de tablas impuesto y el mismo problema de guardar contraseñas.
3. **OIDC con Keycloak** — la API solo valida access tokens JWT de un proveedor; la web usa Authorization Code + PKCE. Suma un contenedor en desarrollo, pero pasar a SSO corporativo (Entra ID, Okta, el Keycloak del banco) es cambiar configuración.

## Decisión

Opción 3. La API valida tokens JWT (`Microsoft.AspNetCore.Authentication.JwtBearer`) contra `Auth:Authority`, exige `aud = walkie-api` y una política por defecto que requiere usuario autenticado (los endpoints públicos usan `AllowAnonymous()`). La web usa `oidc-client-ts` + `react-oidc-context` con el cliente público `walkie-web` y PKCE. En desarrollo, Keycloak corre en `infra/docker-compose.yml` con el realm `infra/keycloak/walkie-realm.json`.

## Consecuencias

- Positivas: Walkie no guarda contraseñas; SSO de banca sin cambiar código; estándar auditable.
- Negativas / costos: un contenedor más en desarrollo; en la nube del MVP hay que operar un Keycloak (o usar un proveedor administrado); las pruebas de integración firman tokens con una clave local en lugar de usar Keycloak.
- Identidad en el dominio: el usuario se identifica por el claim `sub`. Si una tabla necesita autor o dueño, guarda `sub`, nunca el email.
- Revertir: cambiar de proveedor OIDC es solo configuración. Volver a usuarios propios implicaría emitir tokens en la API, pero el resto de la API no cambia porque solo ve un `ClaimsPrincipal`.
