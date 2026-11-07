import { Link, useRoutes } from 'react-router';
import { ApiStatus } from './api/ApiStatus';
import { AuthGate } from './auth/AuthGate';
import { UserMenu } from './auth/UserMenu';
import { routes } from './routes';
import './App.css';

export function App() {
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
