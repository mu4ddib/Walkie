import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useStore } from 'zustand';
import { ApiError } from '../api/client';
import { useExportFeature, useFetchCanvas, useSaveCanvas } from '../api/hooks';
import type { WalkieCanvasGraphV0 } from '../schema/walkie-graph';
import type { CanvasCatalog } from '../catalog/catalogContext';
import { createGraphStore, toGraph } from '../store/graphStore';
import { ShareDialog } from '../share/ShareDialog';
import { saveFile } from '../ui/download';
import { ApiStatus } from '../api/ApiStatus';
import { UserMenu } from '../auth/UserMenu';
import { LocationBar } from '../workspace/LocationBar';
import { APPS_PATH } from '../workspace/paths';
import { Canvas } from './Canvas';
import { OPEN_HELP_EVENT } from './canvasShortcuts';
import { UNSAVED_CONFIRM } from './useOpenFeature';

type Status = { kind: 'idle' } | { kind: 'saved' } | { kind: 'error'; message: string } | { kind: 'conflict'; serverVersion?: number };

/**
 * Lienzo editable de una feature con guardado manual (botón y Ctrl+S), indicador de cambios
 * pendientes y manejo de 409 (recargar la versión del servidor) y 400 (grafo inválido).
 */
export function FeatureEditor({
  featureId,
  initialGraph,
  catalog,
  location,
}: {
  featureId: string;
  initialGraph: WalkieCanvasGraphV0;
  /** Catálogo de la app para los nodos `ref` y la paleta. */
  catalog?: CanvasCatalog;
  /** Dónde está el editor, para la barra superior (app y feature con sus nombres). */
  location?: { appId: string; appName?: string; featureName?: string };
}) {
  const [store] = useState(() => {
    const s = createGraphStore();
    s.getState().loadGraph(initialGraph);
    return s;
  });
  // Al recargar la versión del servidor se vuelve a montar el lienzo (para que haga fitView).
  const [canvasKey, setCanvasKey] = useState(0);
  const dirty = useStore(store, (s) => s.dirty);
  const save = useSaveCanvas(featureId);
  const fetchCanvas = useFetchCanvas(featureId);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [sharing, setSharing] = useState(false);
  const exporter = useExportFeature(featureId);
  // Se exporta lo guardado (spec export-markdown, criterio 1): con cambios pendientes, se avisa.
  const [exportedDirty, setExportedDirty] = useState(false);

  async function exportNow() {
    setExportedDirty(store.getState().dirty);
    try {
      const file = await exporter.mutateAsync();
      saveFile(file.blob, file.fileName);
    } catch {
      // El error lo muestra `exporter.isError`.
    }
  }

  const saveNow = useCallback(async () => {
    const state = store.getState();
    if (!state.dirty || save.isPending) return;
    try {
      const saved = await save.mutateAsync(toGraph(state));
      store.getState().markSaved(saved.version, state);
      setStatus({ kind: 'saved' });
    } catch (error) {
      setStatus(toStatus(error));
    }
  }, [save, store]);

  async function reloadFromServer() {
    try {
      store.getState().loadGraph(await fetchCanvas());
      setCanvasKey((k) => k + 1);
      setStatus({ kind: 'idle' });
    } catch {
      setStatus({ kind: 'error', message: 'No se pudo cargar la versión del servidor.' });
    }
  }

  // Ctrl+S / Cmd+S guarda (y evita el "guardar página" del navegador).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveNow();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [saveNow]);

  // Avisa al cerrar o recargar la pestaña con cambios sin guardar.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const navigate = useNavigate();
  // Cambiar de app o feature desde la barra: con cambios sin guardar se confirma (spec imagenes-portal, decisión 3).
  const go = useCallback(
    (path: string) => {
      if (store.getState().dirty && !window.confirm(UNSAVED_CONFIRM)) return;
      void navigate(path);
    },
    [navigate, store],
  );

  return (
    <div className="feature-editor">
      <header className="workspace-bar">
        <a
          className="brand"
          href={APPS_PATH}
          onClick={(e) => {
            e.preventDefault();
            go(APPS_PATH);
          }}
        >
          Walkie
        </a>
        {location && (
          <LocationBar
            appId={location.appId}
            appName={location.appName}
            featureId={featureId}
            featureName={location.featureName}
            onNavigate={go}
          />
        )}
        <div className="save-bar">
          <span className="save-status" role="status" data-dirty={dirty || undefined} data-saved={status.kind === 'saved' || undefined}>
            {dirty ? 'Sin guardar' : status.kind === 'saved' ? 'Guardado' : 'Al día'}
          </span>
          <button
            type="button"
            className={dirty ? 'pixel-button is-primary' : 'pixel-button'}
            onClick={() => void saveNow()}
            disabled={!dirty || save.isPending}
            data-tip="Guardar · Ctrl+S"
          >
            {save.isPending ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
        <div className="workspace-messages">
          {status.kind === 'error' && (
            <span role="alert" className="save-error">
              {status.message}
            </span>
          )}
          {exporter.isError && (
            <span role="alert" className="save-error">
              No se pudo exportar. Revisa la conexión y vuelve a intentarlo.
            </span>
          )}
          {exportedDirty && exporter.isSuccess && (
            <span className="save-note" role="note">
              Se exportó lo guardado: los cambios sin guardar no se incluyen.
            </span>
          )}
        </div>
        <div className="workspace-actions">
          <button
            type="button"
            className="pixel-button is-ghost"
            onClick={() => void exportNow()}
            disabled={exporter.isPending}
            data-tip="Baja un .zip con el documento Markdown y las imágenes"
          >
            {exporter.isPending ? 'Exportando…' : 'Exportar'}
          </button>
          <button type="button" className="pixel-button" onClick={() => setSharing(true)}>
            Compartir
          </button>
          <button
            type="button"
            className="pixel-button is-ghost icon-button"
            aria-label="Atajos y ayuda"
            data-tip="Atajos · ?"
            onClick={() => window.dispatchEvent(new Event(OPEN_HELP_EVENT))}
          >
            ?
          </button>
          <ApiStatus compact />
          <UserMenu />
        </div>
      </header>
      {sharing && <ShareDialog featureId={featureId} onClose={() => setSharing(false)} />}
      {status.kind === 'conflict' && (
        <div role="alertdialog" aria-labelledby="conflict-title" className="conflict-dialog">
          <p id="conflict-title">
            Alguien guardó este lienzo antes que tú
            {status.serverVersion !== undefined && ` (versión ${status.serverVersion})`}. Tus cambios no se pueden
            guardar sobre esa versión.
          </p>
          <button type="button" className="pixel-button" onClick={() => void reloadFromServer()}>
            Recargar versión del servidor
          </button>
          <button type="button" className="pixel-button" onClick={() => setStatus({ kind: 'idle' })}>
            Seguir editando
          </button>
        </div>
      )}
      <div className="feature-canvas">
        <Canvas key={canvasKey} store={store} catalog={catalog} />
      </div>
    </div>
  );
}

function toStatus(error: unknown): Status {
  if (error instanceof ApiError && error.status === 409) {
    const current = error.problem?.['currentVersion'];
    return { kind: 'conflict', serverVersion: typeof current === 'number' ? current : undefined };
  }
  if (error instanceof ApiError && error.status === 400) {
    const errors = Object.entries(error.problem?.errors ?? {});
    const detail = errors.length > 0 ? ` (${errors[0]![0]}: ${errors[0]![1][0]})` : '';
    return { kind: 'error', message: `La API rechazó el lienzo${detail}.` };
  }
  return { kind: 'error', message: 'No se pudo guardar. Revisa la conexión y vuelve a intentarlo.' };
}
