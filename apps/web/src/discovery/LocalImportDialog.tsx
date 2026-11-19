import { useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router';
import type { DiscoveryUpload } from '../api/client';
import { useUploadSnapshot } from '../api/hooks';
import { ImportErrors } from '../gallery/ImportDialog';
import { AnalysisSummary } from './AnalysisSummary';
import { PackSteps } from './PackSteps';
import { walkiepackError } from './walkiepack';
import { reviewPath } from './discoveryText';
import { formatDayAndTime } from '../share/shareFormat';
import '../share/share.css';
import './discovery.css';

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
  const titleId = useId();

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
    const problem = walkiepackError(chosen);
    if (problem) {
      setFileError(problem);
      return;
    }
    check.mutate({ file: chosen, dryRun: true });
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

        <PackSteps file={file} onChoose={choose} hidePicker={!!save.data} />

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
            {preview.summary.previous && !existing && (
              <p className="discovery-note" role="note">
                Esta fuente ya tiene análisis en la app: el nuevo se comparará con el del {formatDayAndTime(preview.summary.previous.generatedAt)}. Lo
                decidido se conserva y nada se borra.
              </p>
            )}
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
