import { useId, useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { Guide } from '../tours/Guide';
import { useStartWorkspace } from './useStartWorkspace';
import './workspace.css';

/**
 * Bienvenida del primer ingreso (spec espacio-de-trabajo, criterio 2): sobre el lienzo, un solo paso
 * para empezar (nombre de app y de primera feature) o un ejemplo completo para explorar.
 */
export function Welcome() {
  const { start, sample } = useStartWorkspace();
  const [appName, setAppName] = useState('');
  const [featureName, setFeatureName] = useState('');
  const appId = useId();
  const featureId = useId();
  const busy = start.isPending || sample.isPending;
  const error = start.error ?? sample.error;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!appName.trim() || !featureName.trim()) return;
    start.mutate({ appName: appName.trim(), featureName: featureName.trim() });
  }

  return (
    <div className="welcome-stage">
      <section className="welcome-card floating" aria-labelledby={`${appId}-title`}>
        <div className="welcome-guide" aria-hidden="true">
          <Guide animation="idle" />
        </div>
        <h2 id={`${appId}-title`}>Documenta tu primer flujo</h2>
        <p className="welcome-lead">
          Una <strong>app</strong> agrupa los flujos de un producto; cada <strong>feature</strong> es un lienzo donde
          dibujas pantallas, reglas, APIs y datos, y armas tours para explicarlos.
        </p>
        <form className="welcome-form" onSubmit={submit}>
          <label htmlFor={appId}>Nombre de la app</label>
          <input
            id={appId}
            value={appName}
            maxLength={120}
            placeholder="Banca móvil"
            onChange={(e) => setAppName(e.target.value)}
            disabled={busy}
            autoFocus
          />
          <label htmlFor={featureId}>Primera feature</label>
          <input
            id={featureId}
            value={featureName}
            maxLength={120}
            placeholder="Iniciar sesión"
            onChange={(e) => setFeatureName(e.target.value)}
            disabled={busy}
          />
          <button
            type="submit"
            className="pixel-button is-primary"
            disabled={busy || !appName.trim() || !featureName.trim()}
          >
            {start.isPending ? 'Creando…' : 'Crear y abrir el lienzo'}
          </button>
        </form>
        <div className="welcome-sample">
          <span>¿Prefieres ver cómo se ve uno terminado?</span>
          <button type="button" className="pixel-button" disabled={busy} onClick={() => sample.mutate()}>
            {sample.isPending ? 'Cargando ejemplo…' : 'Cargar el ejemplo'}
          </button>
        </div>
        {error !== null && (
          <p role="alert" className="welcome-error">
            {error instanceof ApiError ? error.userMessage : 'No se pudo crear. Revisa la conexión con la API.'}
          </p>
        )}
      </section>
    </div>
  );
}
