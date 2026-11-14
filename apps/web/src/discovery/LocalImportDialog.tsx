import { useEffect, useId, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router';
import { WALKIEPACK_MAX_BYTES, type DiscoveryUpload } from '../api/client';
import { useUploadSnapshot } from '../api/hooks';
import { ImportErrors } from '../gallery/ImportDialog';
import { AnalysisSummary } from './AnalysisSummary';
import { reviewPath } from './discoveryText';
import '../share/share.css';
import './discovery.css';

const SCAN = 'walkie scan .';
/** La CLI se distribuye hoy como herramienta .NET desde el repositorio de Walkie (apps/cli/CLAUDE.md). */
const INSTALL = [
  'dotnet pack apps/cli/src/Walkie.Cli -c Release -o ./walkie-cli',
  'dotnet tool install --global Walkie.Cli --add-source ./walkie-cli',
];

/**
 * «Importar proyecto local» (spec walkie-live, tarea 5): explica cómo generar el paquete con la CLI, valida el
 * `.walkiepack` elegido sin guardar nada (`dryRun`) y muestra qué trae; «Guardar análisis» lo guarda y abre su revisión.
 * Guardar no crea ni cambia nada de la app: solo registra lo descubierto para revisarlo. Si el análisis ya estaba (el
 * mismo archivo, o el mismo contenido que el último de esa fuente), abre el que existe sin duplicarlo. Esc lo cierra.
 * Distinto de «Importar feature», que reconstruye lienzos desde un `.walkie`.
 */
export function LocalImportDialog({ appId, onClose }: { appId: string; onClose: () => void }) {
  const check = useUploadSnapshot(appId);
  const save = useUploadSnapshot(appId);
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const titleId = useId();
  const inputId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function choose(chosen: File | null) {
    save.reset();
    check.reset();
    setFileError(null);
    setFile(chosen);
    if (!chosen) return;
    if (!chosen.name.toLowerCase().endsWith('.walkiepack')) {
      setFileError('Elige un archivo .walkiepack (lo genera «walkie scan»).');
      return;
    }
    if (chosen.size > WALKIEPACK_MAX_BYTES) {
      setFileError('El paquete pasa de 50 MB. Analiza una parte del proyecto («walkie scan <carpeta>» o --detectors).');
      return;
    }
    check.mutate({ file: chosen, dryRun: true });
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    choose(e.dataTransfer.files[0] ?? null);
  }

  function open(result: DiscoveryUpload) {
    if (result.snapshot) {
      onClose();
      void navigate(reviewPath(appId, result.snapshot.id));
    }
  }

  const preview = check.data;
  const error = save.error ?? check.error;
  const existing = preview?.duplicate && preview.snapshot ? preview.snapshot : null;

  return (
    <div className="share-backdrop" onClick={onClose}>
      <div
        className="share-dialog import-dialog local-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId}>Importar proyecto local</h2>
        <p className="panel-help">
          Walkie Live lee el código de un proyecto en tu computador y descubre sus APIs, servicios, bases y módulos. Lo
          descubierto se revisa antes de sumar nada a la app.
        </p>

        <ol className="discovery-steps">
          <li>
            En la raíz del proyecto, ejecuta:
            <Copyable text={SCAN} />
            <span>
              Genera <code>architecture.walkiepack</code> en esa carpeta.
            </span>
            <details className="discovery-details">
              <summary>Cómo instalar walkie</summary>
              <p>
                Es una herramienta de .NET (necesita el SDK de .NET 10). Hoy se instala desde el repositorio de Walkie; desde su raíz:
              </p>
              {INSTALL.map((command) => (
                <Copyable key={command} text={command} />
              ))}
              <p>
                Sin instalarla: <code>dotnet run --project apps/cli/src/Walkie.Cli -- scan &lt;carpeta&gt;</code>. Opciones:{' '}
                <code>walkie --help</code>.
              </p>
            </details>
            <p className="discovery-note">
              Solo lee archivos: no compila, no instala dependencias ni ejecuta nada del proyecto. No lee <code>.env</code>, claves ni
              certificados, y la evidencia lleva rutas relativas y líneas, sin código. La primera vez crea{' '}
              <code>.walkie/source.json</code> con el id de la fuente: versiónalo para que Walkie reconozca los análisis siguientes.
            </p>
          </li>
          <li>
            Elige el archivo generado:
            {!save.data && (
              <label
                htmlFor={inputId}
                className={`discovery-drop ${dragging ? 'is-dragging' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
              >
                <span>{file ? file.name : 'Arrastra aquí el .walkiepack o haz clic para elegirlo'}</span>
                <input
                  id={inputId}
                  type="file"
                  accept=".walkiepack,application/zip"
                  aria-label="Archivo .walkiepack"
                  onChange={(e) => choose(e.target.files?.[0] ?? null)}
                />
              </label>
            )}
          </li>
        </ol>

        {fileError && (
          <p role="alert" className="save-error">
            {fileError}
          </p>
        )}
        {check.isPending && <p role="status">Revisando el paquete…</p>}
        {error && (
          <ImportErrors
            error={error}
            intro="No se puede cargar este paquete:"
            tooLarge="El paquete pasa de 50 MB. Analiza una parte del proyecto («walkie scan <carpeta>» o --detectors)."
          />
        )}
        {preview && !error && (
          <>
            <AnalysisSummary analysis={{ ...preview.summary, source: preview.summary.source }} entities={preview.summary.entities} />
            {existing ? (
              <p role="status" className="discovery-note">
                {preview.duplicate === 'pack'
                  ? 'Este paquete ya está cargado en la app.'
                  : 'El último análisis de esta fuente ya tiene el mismo contenido.'}{' '}
                No se guarda otro: abre el que existe.
              </p>
            ) : (
              <p className="discovery-note">
                Guardar el análisis no cambia la app: solo registra lo descubierto. En la revisión decides qué vincular o descartar.
              </p>
            )}
          </>
        )}

        <div className="import-actions">
          {existing ? (
            <button type="button" className="pixel-button is-primary" onClick={() => open(preview!)}>
              Abrir revisión
            </button>
          ) : (
            <button
              type="button"
              className="pixel-button is-primary"
              disabled={!file || !preview || save.isPending || !!fileError}
              onClick={() => file && save.mutate({ file, dryRun: false }, { onSuccess: open })}
            >
              {save.isPending ? 'Guardando…' : 'Guardar análisis'}
            </button>
          )}
          <button type="button" className="pixel-button is-ghost share-close" onClick={onClose}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

/** Un comando con su botón de copiar. */
function Copyable({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="discovery-command">
      <code>{text}</code>
      <button
        type="button"
        className="pixel-button is-ghost"
        aria-label={`Copiar ${text}`}
        onClick={() =>
          void navigator.clipboard?.writeText(text).then(
            () => setCopied(true),
            () => setCopied(false),
          )
        }
      >
        {copied ? 'Copiado' : 'Copiar'}
      </button>
    </span>
  );
}
