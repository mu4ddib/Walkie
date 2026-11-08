import { useId, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { ApiError, type App, type Feature } from '../api/client';
import { useApps, useCreateApp, useCreateFeature, useFeatures } from '../api/hooks';
import { APPS_PATH, appPath, featurePath } from './paths';
import { Popover } from './Popover';
import './workspace.css';

interface LocationBarProps {
  appId: string;
  appName?: string;
  featureId?: string;
  featureName?: string;
  /** Navega (el editor confirma antes si hay cambios sin guardar). */
  onNavigate: (path: string) => void;
}

/**
 * Dónde estoy y cómo cambiar (spec espacio-de-trabajo, criterio 3): app ▾ / feature ▾, cada uno con
 * búsqueda, la lista y "Nueva …" sin salir del espacio de trabajo. Es la miga de pan (`nav` "Ruta").
 */
export function LocationBar({ appId, appName, featureId, featureName, onNavigate }: LocationBarProps) {
  return (
    <nav className="location-bar" aria-label="Ruta">
      <Popover label="Cambiar de app" buttonLabel={<span className="location-app">{appName ?? 'App'}</span>}>
        {(close) => <AppMenu currentId={appId} onPick={(path) => { close(); onNavigate(path); }} />}
      </Popover>
      {featureId && (
        <>
          <span className="location-sep" aria-hidden="true">
            /
          </span>
          <Popover
            label="Cambiar de feature"
            buttonLabel={<span className="location-feature">{featureName ?? 'Feature'}</span>}
          >
            {(close) => (
              <FeatureMenu appId={appId} currentId={featureId} onPick={(path) => { close(); onNavigate(path); }} />
            )}
          </Popover>
        </>
      )}
    </nav>
  );
}

function AppMenu({ currentId, onPick }: { currentId: string; onPick: (path: string) => void }) {
  const apps = useApps();
  const create = useCreateApp();
  return (
    <SwitcherMenu<App>
      items={apps.data}
      loading={apps.isPending}
      currentId={currentId}
      searchLabel="Buscar apps"
      emptyLabel="Aún no hay otras apps."
      pathOf={(app) => appPath(app.id)}
      onPick={onPick}
      createLabel="Nueva app"
      createPlaceholder="Nombre de la app"
      onCreate={async (name) => onPick(appPath((await create.mutateAsync(name)).id))}
      createError={create.error}
      footer={
        <Link className="switcher-footer" to={APPS_PATH} onClick={(e) => { e.preventDefault(); onPick(APPS_PATH); }}>
          Ver todas las apps
        </Link>
      }
    />
  );
}

function FeatureMenu({ appId, currentId, onPick }: { appId: string; currentId: string; onPick: (path: string) => void }) {
  const features = useFeatures(appId);
  const create = useCreateFeature(appId);
  return (
    <SwitcherMenu<Feature>
      items={features.data}
      loading={features.isPending}
      currentId={currentId}
      searchLabel="Buscar features"
      emptyLabel="Esta app aún no tiene otras features."
      pathOf={(f) => featurePath(appId, f.id)}
      onPick={onPick}
      createLabel="Nueva feature"
      createPlaceholder="Nombre de la feature"
      onCreate={async (name) => onPick(featurePath(appId, (await create.mutateAsync(name)).id))}
      createError={create.error}
      footer={
        <Link className="switcher-footer" to={appPath(appId)} onClick={(e) => { e.preventDefault(); onPick(appPath(appId)); }}>
          Ver todas las features
        </Link>
      }
    />
  );
}

function SwitcherMenu<T extends { id: string; name: string }>({
  items,
  loading,
  currentId,
  searchLabel,
  emptyLabel,
  pathOf,
  onPick,
  createLabel,
  createPlaceholder,
  onCreate,
  createError,
  footer,
}: {
  items: T[] | undefined;
  loading: boolean;
  currentId: string;
  searchLabel: string;
  emptyLabel: string;
  pathOf: (item: T) => string;
  onPick: (path: string) => void;
  createLabel: string;
  createPlaceholder: string;
  onCreate: (name: string) => Promise<void>;
  createError: unknown;
  footer: React.ReactNode;
}) {
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const searchId = useId();
  const createId = useId();
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items ?? []).filter((i) => !q || i.name.toLowerCase().includes(q));
  }, [items, query]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onCreate(name.trim());
    } catch {
      // El error llega por `createError`.
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="switcher">
      {(items?.length ?? 0) > 6 && (
        <>
          <label className="sr-only" htmlFor={searchId}>
            {searchLabel}
          </label>
          <input id={searchId} type="search" placeholder="Buscar…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
        </>
      )}
      {loading && <p className="switcher-note">Cargando…</p>}
      <ul className="switcher-list">
        {shown.map((item) => (
          <li key={item.id}>
            <a
              href={pathOf(item)}
              aria-current={item.id === currentId ? 'page' : undefined}
              onClick={(e) => {
                e.preventDefault();
                onPick(pathOf(item));
              }}
            >
              {item.name}
            </a>
          </li>
        ))}
      </ul>
      {!loading && shown.length === 0 && <p className="switcher-note">{query ? 'Nada coincide.' : emptyLabel}</p>}
      <form className="switcher-create" onSubmit={(e) => void submit(e)}>
        <label className="sr-only" htmlFor={createId}>
          {createLabel}
        </label>
        <input
          id={createId}
          value={name}
          maxLength={120}
          placeholder={createPlaceholder}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
        />
        <button type="submit" className="pixel-button" disabled={busy || !name.trim()}>
          {busy ? 'Creando…' : `+ ${createLabel}`}
        </button>
      </form>
      {createError instanceof ApiError && (
        <p role="alert" className="switcher-error">
          {createError.userMessage}
        </p>
      )}
      {footer}
    </div>
  );
}
