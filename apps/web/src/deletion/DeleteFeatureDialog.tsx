import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router';
import { v7 as uuidv7 } from 'uuid';
import { ApiError, type DeletionResult } from '../api/client';
import { useDeleteFeature, useFeatureDeletionImpact } from '../api/hooks';
import { featurePath, modulePath } from '../workspace/paths';
import { featureFacts } from './deletionText';
import '../share/share.css';
import './deletion.css';

/**
 * «Eliminar feature» (spec eliminar-apps-y-features, ADR-0017): qué se pierde, qué lo impide (portales de otras
 * features: se resuelven antes) y una confirmación explícita. Es definitivo. El id de la eliminación es uno por diálogo:
 * un reintento tras un corte de red no elimina dos veces. Escape cancela mientras no esté en curso.
 */
export function DeleteFeatureDialog({
  appId,
  featureId,
  onClose,
  onDeleted,
}: {
  appId: string;
  featureId: string;
  onClose: () => void;
  onDeleted: (name: string, result: DeletionResult) => void;
}) {
  const impact = useFeatureDeletionImpact(featureId);
  const remove = useDeleteFeature(appId);
  const [deletionId] = useState(() => uuidv7());
  const id = useId();
  const busy = remove.isPending;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const data = impact.data;
  const blockers = data?.blockers ?? [];

  async function confirm() {
    if (!data) return;
    try {
      const result = await remove.mutateAsync({ featureId, deletionId, canvasVersion: data.canvasVersion ?? 0 });
      onDeleted(data.name, result);
    } catch (error) {
      // Un 409 (algo cambió o apareció un portal): se vuelve a pedir el impacto para mostrar lo actual.
      if (error instanceof ApiError && error.status === 409) void impact.refetch();
    }
  }

  return (
    <div className="share-backdrop" onClick={() => !busy && onClose()}>
      <div
        className="share-dialog deletion-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-final`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={`${id}-title`}>Eliminar {data ? `«${data.name}»` : 'feature'}</h2>
        {impact.isPending && <p role="status">Revisando qué se pierde…</p>}
        {impact.isError && (
          <p role="alert" className="save-error">
            {impact.error instanceof ApiError ? impact.error.userMessage : 'No se pudo revisar qué se pierde.'}
          </p>
        )}
        {data && (
          <>
            <ul className="deletion-facts" aria-label="Qué se pierde">
              {featureFacts(data).map((fact) => (
                <li key={fact}>{fact}</li>
              ))}
            </ul>
            {blockers.length > 0 && (
              <div className="deletion-blockers" role="alert">
                {blockers.map((b) => (
                  <div key={b.code}>
                    <p>{b.message}</p>
                    {b.references.length > 0 && (
                      <ul aria-label="Lo que hay que resolver antes">
                        {b.references.map((r) => (
                          <li key={r.id}>
                            <Link to={r.kind === 'module' ? modulePath(appId, r.id) : featurePath(appId, r.id)}>{r.name}</Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        <p id={`${id}-final`} className="deletion-final">
          Es definitivo: no se puede deshacer.
        </p>
        {remove.isError && (
          <p role="alert" className="save-error">
            {remove.error instanceof ApiError ? remove.error.userMessage : 'No se pudo eliminar. Vuelve a intentarlo: no se eliminará dos veces.'}
          </p>
        )}
        {busy && <p role="status">Eliminando…</p>}
        <div className="import-actions">
          <button type="button" className="pixel-button is-ghost" onClick={onClose} disabled={busy} autoFocus>
            Cancelar
          </button>
          <button
            type="button"
            className="pixel-button is-danger"
            disabled={!data || blockers.length > 0 || busy || impact.isFetching}
            onClick={() => void confirm()}
          >
            {busy ? 'Eliminando…' : 'Eliminar definitivamente'}
          </button>
        </div>
      </div>
    </div>
  );
}
