import { useEffect, useId, useState } from 'react';
import { useCreateShare, useRevokeShare, useShares } from '../api/hooks';
import { ApiError, SHARE_DAYS, shareUrl, type ShareDays } from '../api/client';
import { QueryState } from '../ui/QueryState';
import { formatDay, formatDayAndTime } from './shareFormat';
import './share.css';

/**
 * "Compartir" (spec enlace-solo-lectura, criterios 1 a 4): crear un enlace de solo lectura, ver su URL
 * una sola vez y copiarla, y ver o revocar los enlaces activos de la feature. ADR-0005.
 */
export function ShareDialog({ featureId, onClose }: { featureId: string; onClose: () => void }) {
  const shares = useShares(featureId);
  const create = useCreateShare(featureId);
  const revoke = useRevokeShare(featureId);
  const [days, setDays] = useState<ShareDays>(30);
  const [copied, setCopied] = useState(false);
  const daysId = useId();
  const urlId = useId();
  const created = create.data?.token ? shareUrl(create.data.token) : null;
  const error = create.error ?? revoke.error;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function copy() {
    if (!created) return;
    await navigator.clipboard.writeText(created);
    setCopied(true);
  }

  return (
    <div className="share-backdrop" onClick={onClose}>
      <div
        className="share-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${daysId}-title`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={`${daysId}-title`}>Compartir</h2>
        <p role="note" className="share-warning">
          Quien tenga el enlace verá este lienzo, sus imágenes y sus tours sin iniciar sesión.
        </p>

        <div className="share-create">
          <label htmlFor={daysId}>Duración</label>
          <select id={daysId} value={days} onChange={(e) => setDays(Number(e.target.value) as ShareDays)}>
            {SHARE_DAYS.map((d) => (
              <option key={d} value={d}>
                {d} días
              </option>
            ))}
          </select>
          <button
            type="button"
            className="pixel-button"
            disabled={create.isPending}
            onClick={() => {
              setCopied(false);
              create.mutate(days);
            }}
          >
            {create.isPending ? 'Creando…' : 'Crear enlace'}
          </button>
        </div>

        {created && (
          <div className="share-created">
            <label htmlFor={urlId}>Enlace nuevo</label>
            <input id={urlId} type="text" readOnly value={created} onFocus={(e) => e.target.select()} />
            <button type="button" className="pixel-button" onClick={() => void copy()}>
              {copied ? 'Copiado' : 'Copiar'}
            </button>
            <p className="panel-help">Cópialo ahora: por seguridad no se vuelve a mostrar.</p>
          </div>
        )}

        {error && (
          <p role="alert" className="save-error">
            {error instanceof ApiError ? error.userMessage : 'No se pudo completar la acción.'}
          </p>
        )}

        <h3>Enlaces activos</h3>
        <QueryState isPending={shares.isPending} error={shares.error} notFound="La feature no existe." />
        {shares.data?.length === 0 && <p className="panel-help">No hay enlaces activos.</p>}
        {Boolean(shares.data?.length) && (
          <ul className="share-list" aria-label="Enlaces activos">
            {shares.data!.map((share) => (
              <li key={share.id}>
                <span>
                  Creado el {formatDay(share.createdAt)} por {share.createdByName} · disponible hasta el{' '}
                  {formatDay(share.expiresAt)} ·{' '}
                  {share.lastAccessedAt ? `último acceso: ${formatDayAndTime(share.lastAccessedAt)}` : 'Nunca abierto'}
                </span>
                <button
                  type="button"
                  className="pixel-button"
                  disabled={revoke.isPending}
                  aria-label={`Revocar el enlace creado el ${formatDay(share.createdAt)} que vence el ${formatDay(share.expiresAt)}`}
                  onClick={() => revoke.mutate(share.id)}
                >
                  Revocar
                </button>
              </li>
            ))}
          </ul>
        )}

        <button type="button" className="pixel-button share-close" onClick={onClose}>
          Cerrar
        </button>
      </div>
    </div>
  );
}
