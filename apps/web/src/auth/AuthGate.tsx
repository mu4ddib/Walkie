import type { ReactNode } from 'react';
import { hasAuthParams, useAuth } from 'react-oidc-context';
import { useLocation } from 'react-router';
import { currentPath } from './config';

/**
 * Muestra `children` solo con sesión iniciada; si no, la pantalla de login.
 *
 * Al volver del proveedor espera a que el router deje la URL con `code`/`state`: `onSigninCallback` la cambia con
 * `popstate`, que react-router aplica en una transición, y el usuario llega antes como actualización urgente. Si la
 * app se dibujaba en ese instante, `/` (`HomePage`) alcanzaba a abrir la primera app en vez de la página de origen.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();
  // `hasAuthParams` solo lee `search` y `hash`.
  const returning = hasAuthParams({ search: location.search, hash: location.hash } as Location);

  if (auth.isLoading || auth.activeNavigator || (returning && !auth.error)) {
    return <p className="auth-screen">Cargando…</p>;
  }

  if (!auth.isAuthenticated) {
    return (
      <div className="auth-screen">
        <h1>Walkie</h1>
        {auth.error && <p role="alert">No se pudo iniciar sesión: {auth.error.message}</p>}
        <button type="button" className="pixel-button" onClick={() => void auth.signinRedirect({ state: currentPath() })}>
          Iniciar sesión
        </button>
      </div>
    );
  }

  return children;
}
