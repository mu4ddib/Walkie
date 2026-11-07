import { WebStorageStateStore, type User, type UserManagerSettings } from 'oidc-client-ts';

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

/** Estado que viaja por el login para volver a la página que se estaba viendo. */
export interface SigninState {
  returnTo: string;
}

/** Ruta actual, para pasarla como `state` a `signinRedirect`. */
export function currentPath(): SigninState {
  return { returnTo: window.location.pathname + window.location.search + window.location.hash };
}

/** Solo rutas internas (`/algo`); evita usar el login como redirección abierta (`//otro.sitio`). */
export function safeReturnTo(state: unknown): string {
  const returnTo = (state as Partial<SigninState> | undefined)?.returnTo;
  return typeof returnTo === 'string' && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/';
}

/**
 * Tras volver del login: quita `?code=...&state=...` y vuelve a la página de origen.
 * El `popstate` hace que react-router lea la nueva URL (replaceState no lo avisa).
 */
export function onSigninCallback(user: User | void) {
  window.history.replaceState({}, document.title, safeReturnTo(user ? user.state : undefined));
  window.dispatchEvent(new PopStateEvent('popstate'));
}
