import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useStore } from 'zustand';
import { ApiError } from '../api/client';
import { useExportFeature, useFetchCanvas, useSaveCanvas } from '../api/hooks';
import { AiContextDialog } from './AiContextDialog';
import { ExportMenu } from './ExportMenu';
import { ImageExportDialog } from './ImageExportDialog';
import type { WalkieCanvasGraphV0 } from '../schema/walkie-graph';
import type { CanvasCatalog } from '../catalog/catalogContext';
import { createGraphStore, toGraph } from '../store/graphStore';
import { ShareDialog } from '../share/ShareDialog';
import { saveFile } from '../ui/download';
import { ApiStatus } from '../api/ApiStatus';
import { UserMenu } from '../auth/UserMenu';
import { LocationBar } from '../workspace/LocationBar';
import { Popover } from '../workspace/Popover';
import { getAutosave, setAutosave } from '../workspace/session';
import { APPS_PATH } from '../workspace/paths';
import { Canvas } from './Canvas';
import { OPEN_HELP_EVENT } from './canvasShortcuts';
import { UNSAVED_AFTER_ERROR_CONFIRM, UNSAVED_CONFIRM, setLeaveGuard } from './leaveGuard';

type Status =
  | { kind: 'idle' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string }
  | { kind: 'conflict'; serverVersion?: number }
  /** Tras "Seguir editando" en un conflicto: el servidor tiene otra versión y guardar volvería a fallar. */
  | { kind: 'stale' };

/** Pausa en la edición tras la que el autoguardado guarda. */
export const AUTOSAVE_DELAY_MS = 1200;
/** Al soltar tras un movimiento (arrastrar una caja), el autoguardado guarda antes. */
export const AUTOSAVE_AFTER_MOVE_MS = 400;

/**
 * Lienzo editable de una feature. Guardado manual (botón y Ctrl+S) o autoguardado (opción en el estado de
 * guardado; usa el mismo `PUT` con versión), indicador de estado y manejo de 409 (recargar la versión del
 * servidor) y 400 (grafo inválido). Un guardado nunca marca como guardado lo que cambió mientras viajaba.
 */
export function FeatureEditor({
  featureId,
  initialGraph,
  catalog,
  location,
  focusId,
}: {
  featureId: string;
  initialGraph: WalkieCanvasGraphV0;
  /** Catálogo de la app para los nodos `ref` y la paleta. */
  catalog?: CanvasCatalog;
  /** Dónde está el editor, para la barra superior (app y feature con sus nombres). */
  location?: { appId: string; appName?: string; featureName?: string };
  /** Caja con la que se abre (seleccionada y centrada). */
  focusId?: string;
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
  // «Contexto para IA» (spec exportar-e-importar): abierto o no, y si había cambios sin guardar al abrirlo.
  const [aiContext, setAiContext] = useState<{ dirty: boolean } | null>(null);
  const [imageOpen, setImageOpen] = useState(false);

  async function exportNow() {
    setExportedDirty(store.getState().dirty);
    try {
      const file = await exporter.mutateAsync();
      saveFile(file.blob, file.fileName);
    } catch {
      // El error lo muestra `exporter.isError`.
    }
  }

  const [autosave, setAutosaveState] = useState(getAutosave);
  // Guardado en curso: los guardados van de uno en uno (cada uno necesita la versión que devolvió el anterior).
  const saving = useRef<Promise<boolean> | null>(null);
  const [pending, setPending] = useState(false);
  const { mutateAsync } = save;

  /** Guarda lo pendiente; `true` si el lienzo quedó guardado (o no había nada que guardar). */
  const saveNow = useCallback(async (): Promise<boolean> => {
    while (saving.current) await saving.current;
    const state = store.getState();
    if (!state.dirty) return true;
    const run = (async () => {
      setPending(true);
      try {
        const saved = await mutateAsync(toGraph(state));
        // Solo queda "guardado" si el grafo sigue siendo el que se envió: lo que cambió entretanto sigue pendiente.
        store.getState().markSaved(saved.version, state);
        setStatus({ kind: 'saved' });
        return !store.getState().dirty;
      } catch (error) {
        setStatus(toStatus(error));
        return false;
      } finally {
        saving.current = null;
        setPending(false);
      }
    })();
    saving.current = run;
    return run;
  }, [mutateAsync, store]);

  // Con un conflicto de versión el autoguardado se detiene: reintentar daría otro 409.
  const blocked = status.kind === 'conflict' || status.kind === 'stale';

  // Autoguardado: tras una pausa breve en la edición y al terminar un movimiento. Mientras se arrastra no guarda.
  useEffect(() => {
    if (!autosave || blocked) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pointerDown = false;
    const schedule = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (pointerDown) return;
        void saveNow().then(() => {
          // Lo que cambió durante el guardado se guarda en la siguiente pausa.
          if (store.getState().dirty && timer !== undefined) schedule(AUTOSAVE_DELAY_MS);
        });
      }, ms);
    };
    const unsubscribe = store.subscribe((state, prev) => {
      const changed =
        state.nodes !== prev.nodes ||
        state.edges !== prev.edges ||
        state.layout !== prev.layout ||
        state.tours !== prev.tours ||
        state.groups !== prev.groups ||
        state.stickyNotes !== prev.stickyNotes;
      if (state.dirty && changed) schedule(AUTOSAVE_DELAY_MS);
    });
    const onDown = () => (pointerDown = true);
    const onUp = () => {
      pointerDown = false;
      if (store.getState().dirty) schedule(AUTOSAVE_AFTER_MOVE_MS);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    // Al activarlo con cambios pendientes, se guardan.
    if (store.getState().dirty) schedule(AUTOSAVE_AFTER_MOVE_MS);
    return () => {
      clearTimeout(timer);
      timer = undefined;
      unsubscribe();
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
    };
  }, [autosave, blocked, saveNow, store]);

  // Si el editor se desmonta por otra vía (atrás del navegador) con el autoguardado activo, se intenta guardar.
  const leaving = useRef({ autosave, blocked, saveNow });
  useEffect(() => {
    leaving.current = { autosave, blocked, saveNow };
  });
  useEffect(
    () => () => {
      const last = leaving.current;
      if (last.autosave && !last.blocked && store.getState().dirty) void last.saveNow();
    },
    [store],
  );

  function toggleAutosave(on: boolean) {
    setAutosave(on);
    setAutosaveState(on);
  }

  async function reloadFromServer() {
    try {
      while (saving.current) await saving.current;
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
  // Salir del lienzo (otra feature, otra app) con cambios pendientes: con autoguardado se guardan antes;
  // si no se puede, o en modo manual, la persona decide.
  const canLeaveNow = useCallback(async () => {
    if (!store.getState().dirty) return true;
    if (!autosave || blocked) return window.confirm(UNSAVED_CONFIRM);
    return (await saveNow()) || window.confirm(UNSAVED_AFTER_ERROR_CONFIRM);
  }, [autosave, blocked, saveNow, store]);
  // Cambiar de app o feature desde la barra: con cambios sin guardar se confirma (spec imagenes-portal, decisión 3).
  const go = useCallback(
    (path: string) => {
      void canLeaveNow().then((ok) => {
        if (ok) void navigate(path);
      });
    },
    [navigate, canLeaveNow],
  );

  // Los portales del lienzo salen por la misma puerta (`useOpenFeature` → `canLeave`).
  useEffect(() => {
    setLeaveGuard(store, canLeaveNow);
    return () => setLeaveGuard(store, null);
  }, [store, canLeaveNow]);

  // Estado que se muestra: discreto y de una palabra; el detalle de un error va aparte.
  const saveState: SaveState = pending
    ? 'saving'
    : dirty
      ? status.kind === 'error'
        ? 'error'
        : 'dirty'
      : status.kind === 'saved'
        ? 'saved'
        : 'idle';

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
          <Popover
            className="save-menu"
            label="Opciones de guardado"
            buttonLabel={
              <span className="save-status" role="status" data-state={saveState} data-tip="Opciones de guardado">
                {SAVE_LABELS[saveState]}
                {autosave && !blocked && <span className="save-auto"> · auto</span>}
              </span>
            }
          >
            {() => (
              <div className="save-options">
                <label className="save-option">
                  <input type="checkbox" checked={autosave} onChange={(e) => toggleAutosave(e.target.checked)} />
                  <span>Autoguardado</span>
                </label>
                <p>
                  {autosave
                    ? 'Guarda solo tras una pausa breve al editar y al terminar de mover. Guardar y Ctrl+S siguen disponibles.'
                    : 'Desactivado: los cambios se guardan con el botón Guardar o con Ctrl+S.'}
                </p>
                {autosave && blocked && <p>En pausa: el servidor tiene una versión más reciente de este lienzo.</p>}
              </div>
            )}
          </Popover>
          {saveState === 'error' ? (
            <button type="button" className="pixel-button is-primary" onClick={() => void saveNow()}>
              Reintentar
            </button>
          ) : (
            <button
              type="button"
              className={dirty ? 'pixel-button is-primary' : 'pixel-button'}
              onClick={() => void saveNow()}
              disabled={!dirty || pending}
              data-tip="Guardar · Ctrl+S"
            >
              {pending ? 'Guardando…' : 'Guardar'}
            </button>
          )}
        </div>
        <div className="workspace-messages">
          {status.kind === 'error' && dirty && (
            <span role="alert" className="save-error">
              {status.message}
            </span>
          )}
          {status.kind === 'stale' && dirty && (
            <span role="note" className="save-error">
              El servidor tiene otra versión de este lienzo.{' '}
              <button type="button" className="link-button" onClick={() => void reloadFromServer()}>
                Recargar
              </button>
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
          <ExportMenu
            pending={exporter.isPending}
            onAiContext={() => setAiContext({ dirty: store.getState().dirty })}
            onMarkdown={() => void exportNow()}
            onImage={() => setImageOpen(true)}
          />
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
      {imageOpen && <ImageExportDialog featureName={location?.featureName} onClose={() => setImageOpen(false)} />}
      {aiContext && (
        <AiContextDialog target={{ kind: 'feature', id: featureId }} dirty={aiContext.dirty} onClose={() => setAiContext(null)} />
      )}
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
          <button type="button" className="pixel-button" onClick={() => setStatus({ kind: 'stale' })}>
            Seguir editando
          </button>
        </div>
      )}
      <div className="feature-canvas">
        <Canvas key={canvasKey} store={store} catalog={catalog} focusId={focusId} />
      </div>
    </div>
  );
}

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';
const SAVE_LABELS: Record<SaveState, string> = {
  idle: 'Al día',
  dirty: 'Sin guardar',
  saving: 'Guardando',
  saved: 'Guardado',
  error: 'Error al guardar',
};

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
