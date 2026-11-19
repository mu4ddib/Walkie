import { useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAddMember, useAppRole, useMembers, useRemoveMember, useUpdateMember, useUserId } from '../api/hooks';
import { ApiError, type AppRole } from '../api/client';
import { APP_NO_ACCESS, QueryState } from '../ui/QueryState';
import { APPS_PATH } from '../workspace/paths';
import { formatDay } from '../share/shareFormat';
import { ROLE_HELP, ROLE_LABELS, ROLES } from './roles';
import '../share/share.css';
import './members.css';

/**
 * «Miembros» de una app (spec autorizacion-por-app, ADR-0015): cualquier miembro ve la lista y puede salir; el owner
 * suma por correo a alguien que ya entró a Walkie, cambia roles y quita. La API impide dejar la app sin owner (409).
 */
export function MembersDialog({ appId, onClose }: { appId: string; onClose: () => void }) {
  const members = useMembers(appId);
  const { isOwner } = useAppRole(appId);
  const me = useUserId();
  const add = useAddMember(appId);
  const update = useUpdateMember(appId);
  const remove = useRemoveMember(appId);
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AppRole>('viewer');
  const id = useId();
  const error = add.error ?? update.error ?? remove.error;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function reset() {
    add.reset();
    update.reset();
    remove.reset();
  }

  async function removeMember(userId: string, name: string) {
    reset();
    const self = userId === me;
    if (!window.confirm(self ? '¿Salir de esta app? Dejarás de verla.' : `¿Quitar a ${name} de esta app?`)) return;
    try {
      await remove.mutateAsync(userId);
      if (self) void navigate(APPS_PATH);
    } catch {
      // El error lo muestra el aviso.
    }
  }

  return (
    <div className="share-backdrop" onClick={onClose}>
      <div
        className="share-dialog members-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={`${id}-title`}>Miembros</h2>
        <p className="panel-help">{ROLE_HELP}</p>

        {isOwner && (
          <form
            className="members-add"
            onSubmit={(e) => {
              e.preventDefault();
              reset();
              add.mutate({ email: email.trim(), role }, { onSuccess: () => setEmail('') });
            }}
          >
            <label htmlFor={`${id}-email`}>Correo</label>
            <input
              id={`${id}-email`}
              type="email"
              required
              autoComplete="off"
              placeholder="persona@empresa.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <label htmlFor={`${id}-role`}>Rol</label>
            <select id={`${id}-role`} value={role} onChange={(e) => setRole(e.target.value as AppRole)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            <button type="submit" className="pixel-button" disabled={add.isPending || email.trim() === ''}>
              {add.isPending ? 'Agregando…' : 'Agregar'}
            </button>
            <p className="panel-help members-add-help">
              Solo personas que ya iniciaron sesión en Walkie al menos una vez.
            </p>
          </form>
        )}

        {error && (
          <p role="alert" className="save-error">
            {error instanceof ApiError ? error.userMessage : 'No se pudo completar la acción.'}
          </p>
        )}

        <QueryState isPending={members.isPending} error={members.error} notFound={APP_NO_ACCESS} />
        {members.data && (
          <ul className="share-list members-list" aria-label="Miembros de la app">
            {members.data.map((m) => {
              const self = m.userId === me;
              return (
                <li key={m.userId}>
                  <span className="members-who">
                    <strong>{m.name}</strong>
                    {self && ' (tú)'}
                    {m.email && m.email !== m.name && <span className="members-email"> · {m.email}</span>}
                    <span className="members-since"> · desde el {formatDay(m.grantedAt)}</span>
                  </span>
                  {isOwner ? (
                    <select
                      aria-label={`Rol de ${m.name}`}
                      value={m.role}
                      disabled={update.isPending}
                      onChange={(e) => {
                        reset();
                        update.mutate({ userId: m.userId, role: e.target.value as AppRole });
                      }}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="members-role">{ROLE_LABELS[m.role]}</span>
                  )}
                  {(isOwner || self) && (
                    <button
                      type="button"
                      className="pixel-button"
                      disabled={remove.isPending}
                      aria-label={self ? 'Salir de la app' : `Quitar a ${m.name}`}
                      onClick={() => void removeMember(m.userId, m.name)}
                    >
                      {self ? 'Salir' : 'Quitar'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <button type="button" className="pixel-button share-close" onClick={onClose}>
          Cerrar
        </button>
      </div>
    </div>
  );
}
