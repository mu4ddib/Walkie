import { ApiStatus } from './api/ApiStatus';
import { Canvas } from './canvas/Canvas';
import './App.css';

export function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>Walkie</h1>
        <ApiStatus />
      </header>
      <main className="app-canvas">
        <Canvas />
      </main>
    </div>
  );
}
