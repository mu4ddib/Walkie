import { WebStorageStateStore, type UserManagerSettings } from 'oidc-client-ts';

/** Cliente OIDC público con PKCE (ADR-0003). Valores por defecto = Keycloak local. */
export const oidcConfig: UserManagerSettings = {
  authority: import.meta.env.VITE_OIDC_AUTHORITY ?? 'http://localhost:8080/realms/walkie',
  client_id: import.meta.env.VITE_OIDC_CLIENT_ID ?? 'walkie-web',
  redirect_uri: window.location.origin + '/',
  post_logout_redirect_uri: window.location.origin + '/',
  scope: 'openid profile email',
  // sessionStorage: el token no sobrevive al cerrar la pestaña.
  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
};

/** Quita `?code=...&state=...` de la URL tras volver del login. */
export function onSigninCallback() {
  window.history.replaceState({}, document.title, window.location.pathname);
}
