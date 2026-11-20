import { useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router';
import { v7 as uuidv7 } from 'uuid';
import { ApiError } from '../api/client';
import { useAppDeletionImpact, useDeleteApp } from '../api/hooks';
import { APPS_PATH } from '../workspace/paths';
import { appFacts } from './deletionText';
import '../share/share.css';
import './deletion.css';

/** Lo que la galería de apps muestra al volver de una eliminación. */
export interface DeletedAppNotice {
  deletedApp: string;
  pending: boolean;
  /** Para consultar una eliminación pendiente (202). */
  deletionId?: string;
}

/**
 * «Eliminar app» (spec eliminar-apps-y-features, ADR-0017): lo que contiene, que se elimina para siempre, la sugerencia
 * de exportarla antes (sin el historial de Walkie Live) y la confirmación escribiendo su nombre exacto. Al terminar
 * vuelve a la galería de apps con un aviso. Si la limpieza quedó pendiente (202), la app ya no es accesible y Walkie la
 * reintenta; el aviso lo dice y deja consultar su estado (`PendingDeletion`).
 */
export function DeleteAppDialog({ appId, onClose }: { appId: string; onClose: () => void }) {
  const impact = useAppDeletionImpact(appId);
  const remove = useDeleteApp(appId);
  const navigate = useNavigate();
  const [deletionId] = useState(() => uuidv7());
  const [typed, setTyped] = useState('');
  const id = useId();
  const busy = remove.isPending;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const data = impact.data;
  const blockers = data?.blockers ?? [];
  const matches = data !== undefined && typed.trim() === data.name;

  async function confirm() {
    if (!data || !matches) return;
    try {
      const result = await remove.mutateAsync({ deletionId, confirmName: typed.trim() });
      const notice: DeletedAppNotice = {
        deletedApp: data.name,
        pending: result.status !== 'completed',
        ...(result.status !== 'completed' && 'id' in result ? { deletionId: result.id } : {}),
      };
      void navigate(APPS_PATH, { replace: true, state: notice });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) void impact.refetch();
    }
  }

  return (
    <div className="share-backdrop" onClick={() => !busy && onClose()}>
      <form
        className="share-dialog deletion-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-final`}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          void confirm();
        }}
      >
        <h2 id={`${id}-title`}>Eliminar la app {data ? `«${data.name}»` : ''}</h2>
        {impact.isPending && <p role="status">Revisando qué contiene…</p>}
        {impact.isError && (
          <p role="alert" className="save-error">
            {impact.error instanceof ApiError ? impact.error.userMessage : 'No se pudo revisar qué contiene.'}
          </p>
        )}
        {data && (
          <>
            <p>Se elimina toda la documentación de la app:</p>
            <ul className="deletion-facts" aria-label="Qué se elimina">
              {appFacts(data).map((fact) => (
                <li key={fact}>{fact}</li>
              ))}
            </ul>
            <p className="panel-help">
              Si quieres conservar una copia, cancela y usa antes «Exportar app (.walkie)»: guarda las features, los módulos, el
              catálogo, los lienzos y las imágenes, pero no el historial de Walkie Live (análisis, evidencia y decisiones), los
              miembros ni los enlaces públicos.
            </p>
            {blockers.length > 0 && (
              <div className="deletion-blockers" role="alert">
                {blockers.map((b) => (
                  <p key={b.code}>{b.message}</p>
                ))}
              </div>
            )}
            <label className="deletion-confirm">
              Escribe el nombre de la app para confirmar
              <input value={typed} onChange={(e) => setTyped(e.target.value)} disabled={busy} autoComplete="off" spellCheck={false} />
            </label>
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
        {busy && <p role="status">Eliminando la app…</p>}
        <div className="import-actions">
          <button type="button" className="pixel-button is-ghost" onClick={onClose} disabled={busy} autoFocus>
            Cancelar
          </button>
          <button type="submit" className="pixel-button is-danger" disabled={!matches || blockers.length > 0 || busy}>
            {busy ? 'Eliminando…' : 'Eliminar la app'}
          </button>
        </div>
      </form>
    </div>
  );
}
