import type { ReactNode } from 'react';
import { useAuth } from 'react-oidc-context';
import { currentPath } from './config';

/** Muestra `children` solo con sesión iniciada; si no, la pantalla de login. */
export function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth();

  if (auth.isLoading || auth.activeNavigator) {
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
