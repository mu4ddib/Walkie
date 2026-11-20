import { ApiError } from '../api/client';
import { useDeletionStatus } from '../api/hooks';

/**
 * Aviso de una eliminación que respondió 202 (ADR-0017): todavía no terminó. Ya no está disponible para nadie, pero
 * Walkie no confirmó que borró todos sus datos. «Consultar estado» pide `GET /api/deletions/{id}` (que la retoma si ya
 * se puede) y dice si terminó o sigue pendiente, con el último error y el código para quien administre Walkie.
 */
export function PendingDeletion({ deletionId, name, kind }: { deletionId: string; name: string; kind: 'app' | 'feature' }) {
  const status = useDeletionStatus(deletionId);
  const what = kind === 'app' ? `la app «${name}»` : `«${name}»`;
  const done = status.data?.status === 'completed';

  return (
    <div className="gallery-note deletion-pending" role="status">
      {done ? (
        <p>La eliminación de {what} terminó: no queda nada de sus datos.</p>
      ) : (
        <>
          <p>
            La eliminación de {what} todavía está pendiente: ya no está disponible para nadie, pero Walkie no terminó de borrar
            todos sus datos. Lo reintenta solo; puedes consultar cómo va.
          </p>
          {status.data && (
            <p>
              Sigue pendiente{status.data.error ? ` (último intento: ${status.data.error})` : ''}. Si no termina, comparte este código con
              quien administre Walkie: <code>{deletionId}</code>
            </p>
          )}
          {status.isError && (
            <p className="save-error">
              {status.error instanceof ApiError ? status.error.userMessage : 'No se pudo consultar el estado. Vuelve a intentarlo.'}
            </p>
          )}
          <button type="button" className="pixel-button is-ghost" onClick={() => void status.refetch()} disabled={status.isFetching}>
            {status.isFetching ? 'Consultando…' : 'Consultar estado'}
          </button>
        </>
      )}
    </div>
  );
}
