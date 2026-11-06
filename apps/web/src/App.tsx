import { ApiStatus } from './api/ApiStatus';
import { AuthGate } from './auth/AuthGate';
import { UserMenu } from './auth/UserMenu';
import { Canvas } from './canvas/Canvas';
import './App.css';

export function App() {
  return (
    <AuthGate>
      <div className="app">
        <header className="app-header">
          <h1>Walkie</h1>
          <span className="app-header-right">
            <ApiStatus />
            <UserMenu />
          </span>
        </header>
        <main className="app-canvas">
          <Canvas />
        </main>
      </div>
    </AuthGate>
  );
}
