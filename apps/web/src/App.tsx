import { Link, useMatch, useRoutes } from 'react-router';
import { ApiStatus } from './api/ApiStatus';
import { AuthGate } from './auth/AuthGate';
import { UserMenu } from './auth/UserMenu';
import { routes } from './routes';
import { SHARED_PATH } from './share/sharedPath';
import './App.css';

export function App() {
  // Un enlace de solo lectura se abre sin sesión (ADR-0005): sin AuthGate ni menú de usuario.
  if (useMatch(SHARED_PATH)) {
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

  return (
    <AuthGate>
      <div className="app">
        <header className="app-header">
          <h1>
            <Link to="/">Walkie</Link>
          </h1>
          <span className="app-header-right">
            <ApiStatus />
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
