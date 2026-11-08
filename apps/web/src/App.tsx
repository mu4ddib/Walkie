import { Link, useMatch, useRoutes } from 'react-router';
import { ApiStatus } from './api/ApiStatus';
import { AuthGate } from './auth/AuthGate';
import { UserMenu } from './auth/UserMenu';
import { routes } from './routes';
import { SHARED_PATH } from './share/sharedPath';
import { APPS_PATH } from './workspace/paths';
import './App.css';

export function App() {
  const shared = useMatch(SHARED_PATH);
  // El editor y la bienvenida ocupan toda la pantalla y traen su propia barra (spec espacio-de-trabajo).
  const editor = useMatch('/apps/:appId/features/:featureId');
  const home = useMatch('/');

  // Un enlace de solo lectura se abre sin sesión (ADR-0005): sin AuthGate ni menú de usuario.
  if (shared) {
    return (
      <div className="app">
        <header className="app-header">
          <h1>Walkie</h1>
        </header>
        <main className="app-main">
          <AppRoutes />
        </main>
      </div>
    );
  }

  if (editor) {
    return (
      <AuthGate>
        <main className="app-full">
          <AppRoutes />
        </main>
      </AuthGate>
    );
  }

  return (
    <AuthGate>
      <div className="app">
        <header className="app-header">
          <h1>
            <Link to="/">Walkie</Link>
          </h1>
          {!home && (
            <nav className="app-header-nav" aria-label="Secciones">
              <Link to={APPS_PATH}>Apps</Link>
            </nav>
          )}
          <span className="app-header-right">
            <ApiStatus compact />
            <UserMenu />
          </span>
        </header>
        <main className="app-main">
          <AppRoutes />
        </main>
      </div>
    </AuthGate>
  );
}

function AppRoutes() {
  return useRoutes(routes);
}
