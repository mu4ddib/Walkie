import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router';
import { ApiError, type ImportSummary } from '../api/client';
import { useImportPackage } from '../api/hooks';
import { featurePath } from '../workspace/paths';
import '../share/share.css';

/**
 * «Importar feature» (spec exportar-e-importar, tarea 6): se elige un archivo `.walkie`, la API lo valida sin crear nada
 * (`dryRun`) y se muestra qué va a crear —features con su nombre final, catálogo nuevo y reutilizado, imágenes y avisos—
 * o los errores con su ruta dentro del archivo. «Importar» lo crea todo o nada. Esc o «Cerrar» lo cierran.
 */
export function ImportDialog({ appId, onClose }: { appId: string; onClose: () => void }) {
  const check = useImportPackage(appId);
  const run = useImportPackage(appId);
  const [file, setFile] = useState<File | null>(null);
  const titleId = useId();
  const inputId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function choose(chosen: File | null) {
    setFile(chosen);
    run.reset();
    if (chosen) check.mutate({ file: chosen, dryRun: true });
    else check.reset();
  }

  const preview = check.data;
  const done = run.data;
  const error = run.error ?? check.error;

  return (
    <div className="share-backdrop" onClick={onClose}>
      <div
        className="share-dialog import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId}>Importar feature</h2>
        <p className="panel-help">
          Elige un archivo <code>.walkie</code> (se descarga desde «Exportar» en el lienzo). Antes de crear nada se
          muestra qué trae.
        </p>
        {!done && (
          <div className="import-file">
            <label htmlFor={inputId}>Archivo .walkie</label>
            <input
              id={inputId}
              type="file"
              accept=".walkie,application/zip"
              onChange={(e) => choose(e.target.files?.[0] ?? null)}
            />
          </div>
        )}
        {check.isPending && <p role="status">Revisando el archivo…</p>}
        {error && <ImportErrors error={error} />}
        {preview && !done && !run.error && <Summary summary={preview} />}
        {done && (
          <div role="status" className="import-done">
            <p>
              {done.features.length === 1
                ? 'Se importó la feature:'
                : `Se importaron ${done.features.length} features:`}
            </p>
            <ul>
              {done.features.map((f) => (
                <li key={f.id}>{f.id ? <Link to={featurePath(appId, f.id)}>{f.name}</Link> : f.name}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="import-actions">
          {!done && (
            <button
              type="button"
              className="pixel-button is-primary"
              disabled={!file || !preview || run.isPending}
              onClick={() => file && run.mutate({ file, dryRun: false })}
            >
              {run.isPending ? 'Importando…' : 'Importar'}
            </button>
          )}
          <button type="button" className="pixel-button is-ghost share-close" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

function Summary({ summary }: { summary: ImportSummary }) {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return (
    <div className="import-summary" aria-label="Qué se va a importar">
      <ul>
        {summary.features.map((f) => (
          <li key={f.sourceName + f.name}>
            <strong>{f.name}</strong>
            {f.name !== f.sourceName && <span className="import-note"> (ya hay una «{f.sourceName}» en esta app)</span>}
          </li>
        ))}
      </ul>
      <p>
        {summary.newCatalogItems === 0 && summary.existingCatalogItems === 0
          ? 'Sin componentes del catálogo'
          : `${plural(summary.newCatalogItems, 'elemento nuevo', 'elementos nuevos')} en el catálogo`}
        {summary.existingCatalogItems > 0 &&
          ` · ${plural(summary.existingCatalogItems, 'ya está', 'ya están')} y se ${summary.existingCatalogItems === 1 ? 'reutiliza' : 'reutilizan'}`}
        {' · '}
        {plural(summary.images, 'imagen', 'imágenes')}
      </p>
      {summary.warnings.length > 0 && (
        <div role="note" className="share-warning">
          <p>Al importar:</p>
          <ul>
            {summary.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Los errores de validación con su ruta dentro del archivo; si no hay, el mensaje del problema. */
function ImportErrors({ error }: { error: Error }) {
  const problem = error instanceof ApiError ? error.problem : undefined;
  const entries = Object.entries(problem?.errors ?? {});
  if (entries.length === 0) {
    const message =
      error instanceof ApiError && error.status === 413
        ? 'El archivo pasa de 50 MB.'
        : error instanceof ApiError
          ? (problem?.detail ?? error.userMessage)
          : 'No se pudo revisar el archivo. Revisa la conexión y vuelve a intentarlo.';
    return (
      <p role="alert" className="save-error">
        {message}
      </p>
    );
  }
  return (
    <div role="alert" className="save-error import-errors">
      <p>No se puede importar este archivo:</p>
      <ul>
        {entries.map(([path, messages]) => (
          <li key={path}>
            {path !== 'file' && <code>{path}</code>} {messages.join(' ')}
          </li>
        ))}
      </ul>
    </div>
  );
}
