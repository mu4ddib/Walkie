import { Link, useMatch, useRoutes } from 'react-router';
import { ApiStatus } from './api/ApiStatus';
import { AuthGate } from './auth/AuthGate';
import { UserMenu } from './auth/UserMenu';
import { routes } from './routes';
import { SHARED_MODULE_PATH, SHARED_PATH } from './share/sharedPath';
import { APPS_PATH } from './workspace/paths';
import './App.css';

export function App() {
  const sharedFeature = useMatch(SHARED_PATH);
  const sharedModule = useMatch(SHARED_MODULE_PATH);
  const shared = sharedFeature ?? sharedModule;
  // El editor y la bienvenida ocupan toda la pantalla y traen su propia barra (spec espacio-de-trabajo).
  const featureEditor = useMatch('/apps/:appId/features/:featureId');
  // El lienzo de un módulo compartido usa el mismo editor (spec modulos-compartidos).
  const moduleEditor = useMatch('/apps/:appId/modules/:moduleId');
  const editor = featureEditor ?? moduleEditor;
  // El mapa de la app también es un lienzo a pantalla completa con su barra (spec mapa-de-la-app).
  const appMap = useMatch('/apps/:appId/map');
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

  if (editor || appMap) {
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
