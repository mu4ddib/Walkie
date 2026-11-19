import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { v7 as uuidv7 } from 'uuid';
import { ApiError } from '../api/client';
import { useImportSourceAsApp } from '../api/hooks';
import { ImportErrors } from '../gallery/ImportDialog';
import { AnalysisSummary } from './AnalysisSummary';
import { reviewPath } from './discoveryText';
import { PackSteps } from './PackSteps';
import { walkiepackError } from './walkiepack';
import '../share/share.css';
import './discovery.css';

/**
 * «Crear app desde proyecto local» (spec walkie-live, tarea 10): una app nueva con el primer análisis de un proyecto.
 * Con el mismo paso de la CLI y del archivo que «Importar proyecto local», valida el `.walkiepack` sin crear nada
 * (`dryRun`), muestra qué trae y propone un nombre editable; «Crear app» crea la app vacía y guarda su análisis, y abre
 * la revisión, donde la persona decide qué sumar. No crea features, catálogo ni lienzos. El `importId` se genera al
 * elegir el archivo y el nombre: un reintento (por ejemplo tras un error de red) manda el mismo y la API no crea otra app.
 * Distinto de «Importar app», que reconstruye una app documentada desde un `.walkie`.
 */
export function NewAppFromProjectDialog({ onClose }: { onClose: () => void }) {
  const check = useImportSourceAsApp();
  const save = useImportSourceAsApp();
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  // Nombre elegido (null: el que propone la vista previa).
  const [name, setName] = useState<string | null>(null);
  const importId = useRef<string | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const titleId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !save.isPending && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, save.isPending]);

  // Con la guía de la CLI a la vista, el error quedaba fuera del diálogo: se lleva a la vista al aparecer.
  useEffect(() => {
    if (save.error) errorRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [save.error]);

  function choose(chosen: File | null) {
    save.reset();
    check.reset();
    setFileError(null);
    setName(null);
    importId.current = null;
    setFile(chosen);
    if (!chosen) return;
    const problem = walkiepackError(chosen);
    if (problem) {
      setFileError(problem);
      return;
    }
    check.mutate({ file: chosen, dryRun: true });
  }

  function rename(value: string) {
    setName(value);
    importId.current = null; // otro nombre es otra creación
    save.reset();
  }

  const preview = check.data;
  const finalName = (name ?? preview?.app.name ?? '').trim();

  function create() {
    if (!file || !preview || finalName.length === 0) return;
    // El mismo importId en cada reintento de esta misma creación (mismo archivo y nombre).
    importId.current ??= uuidv7();
    save.mutate(
      { file, name: finalName, importId: importId.current, dryRun: false },
      {
        onSuccess: (result) => {
          if (result.app.id && result.snapshot) {
            onClose();
            void navigate(reviewPath(result.app.id, result.snapshot.id));
          }
        },
      },
    );
  }

  const nameConflict = save.error instanceof ApiError && save.error.status === 409;
  const checkError = check.error;

  return (
    <div className="share-backdrop" onClick={() => !save.isPending && onClose()}>
      <div
        className="share-dialog import-dialog local-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId}>Crear app desde proyecto local</h2>
        <p className="panel-help">
          Crea una app nueva a partir del análisis de un proyecto en tu computador (Walkie Live). La app empieza vacía: en la revisión decides qué
          APIs, servicios, módulos y features sumar. No es un archivo <code>.walkie</code>: para eso está «Importar app».
        </p>

        <PackSteps file={file} onChoose={choose} hidePicker={save.isPending} />

        {fileError && (
          <p role="alert" className="save-error">
            {fileError}
          </p>
        )}
        {check.isPending && <p role="status">Revisando el paquete…</p>}
        {checkError && (
          <ImportErrors
            error={checkError}
            intro="No se puede usar este paquete:"
            tooLarge="El paquete pasa de 50 MB. Analiza una parte del proyecto («walkie scan <carpeta>» o --detectors)."
          />
        )}
        {preview && !checkError && (
          <>
            <AnalysisSummary analysis={{ ...preview.summary, source: preview.summary.source }} entities={preview.summary.entities} />
            {preview.warnings.length > 0 && (
              <ul className="discovery-warnings" aria-label="Avisos">
                {preview.warnings.map((w) => (
                  <li key={w.code} data-code={w.code}>
                    <span aria-hidden="true">⚠</span> {w.message}
                  </li>
                ))}
              </ul>
            )}
            <label className="new-app-name">
              Nombre de la app
              <input value={name ?? preview.app.name} maxLength={120} onChange={(e) => rename(e.target.value)} disabled={save.isPending} />
            </label>
            {preview.app.nameTaken && name === null && (
              <p className="discovery-note" role="note">
                Ya hay una app con ese nombre: elige otro.
              </p>
            )}
            <p className="discovery-note">
              Se creará la app «{finalName || '…'}» con este análisis como el primero de la fuente <strong>{preview.summary.source.name}</strong>. No
              se crean features, catálogo ni lienzos.
            </p>
          </>
        )}

        {save.error && (
          <p ref={errorRef} role="alert" className="save-error">
            {save.error instanceof ApiError
              ? save.error.userMessage
              : 'No se pudo conectar con Walkie. Vuelve a intentarlo: no se creará otra app.'}
          </p>
        )}

        <div className="import-actions">
          <button
            type="button"
            className="pixel-button is-primary"
            disabled={!file || !preview || !!checkError || !!fileError || save.isPending || finalName.length === 0 || nameConflict}
            onClick={create}
          >
            {save.isPending ? 'Creando…' : save.error && !nameConflict ? 'Reintentar' : 'Crear app'}
          </button>
          <button type="button" className="pixel-button is-ghost share-close" disabled={save.isPending} onClick={onClose}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
