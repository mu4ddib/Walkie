import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useReactFlow, type Viewport } from '@xyflow/react';
import { interfaceTarget, useCanvasCatalog } from '../catalog/catalogContext';
import { useOpenModule } from '../canvas/useOpenModule';
import { useGraphStore } from '../store/useGraphStore';
import { FLOW_SPEEDS, setFlowSpeed } from '../workspace/session';
import { stepSummary } from './flowText';
import { advance, ended, firstPhase, goTo, phaseDuration, type Playing } from './flowPlayback';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface FlowPlayerProps {
  playing: Playing;
  setPlaying: Dispatch<SetStateAction<Playing | null>>;
  /** Velocidad (1 = normal); la guarda el lienzo, que también la usa para la animación de la conexión. */
  speed: number;
  onSpeed: (speed: number) => void;
  /** Cajas a encuadrar (las calcula el lienzo con lo que se ve): el paso activo y el recorrido completo. */
  frames: { step: Rect | null; all: Rect | null };
  /** Tamaño del área del lienzo. */
  pane: { width: number; height: number };
  onExit: () => void;
}

/** Espacio que ocupa la barra del reproductor arriba (px de pantalla). */
const BAR_SPACE = 168;
const SIDE_SPACE = 48;
const MAX_ZOOM = 1.25;

/**
 * Reproductor de un recorrido (spec recorridos-y-grupos, parte 4): nombre, paso actual y total, descripción, controles
 * (reproducir, pausar, continuar, reiniciar, anterior, siguiente, detener), velocidad, encuadrar todo y seguir el paso
 * activo con movimientos suaves. Al salir vuelve la vista que había.
 */
export function FlowPlayer({ playing, setPlaying, speed, onSpeed, frames, pane, onExit }: FlowPlayerProps) {
  const tour = useGraphStore((s) => s.tours[playing.tourId]);
  const edges = useGraphStore((s) => s.edges);
  const nodes = useGraphStore((s) => s.nodes);
  const { items, modules, share } = useCanvasCatalog();
  const openModule = useOpenModule();
  const { getViewport, setViewport } = useReactFlow();
  const reduced = usePrefersReducedMotion();
  const [follow, setFollow] = useState(true);

  // Vista anterior: se restaura al detener.
  const saved = useRef<Viewport | null>(null);
  useEffect(() => {
    saved.current = getViewport();
    return () => {
      if (saved.current) void setViewport(saved.current);
    };
  }, [getViewport, setViewport]);

  // Las fases avanzan solas mientras se reproduce (o mientras termina el paso elegido a mano).
  useEffect(() => {
    if (playing.mode === 'paused') return;
    const timer = setTimeout(
      () => setPlaying((p) => (p ? advance(tour, p) : p)),
      phaseDuration(tour, playing, speed),
    );
    return () => clearTimeout(timer);
  }, [playing, speed, tour, setPlaying]);

  // Encuadre suave del paso activo (o del recorrido entero).
  const frame = (rect: Rect | null) => {
    if (!rect || pane.width === 0) return;
    const zoom = Math.min(
      MAX_ZOOM,
      (pane.width - SIDE_SPACE * 2) / Math.max(rect.w, 1),
      (pane.height - BAR_SPACE - SIDE_SPACE) / Math.max(rect.h, 1),
    );
    const x = pane.width / 2 - (rect.x + rect.w / 2) * zoom;
    const y = BAR_SPACE + (pane.height - BAR_SPACE - SIDE_SPACE) / 2 - (rect.y + rect.h / 2) * zoom;
    void setViewport({ x, y, zoom }, { duration: reduced ? 0 : 450 });
  };
  const stepKey = frames.step ? `${frames.step.x},${frames.step.y},${frames.step.w},${frames.step.h}` : '';
  useEffect(() => {
    if (follow) frame(frames.step);
    // Solo cuando cambia la caja del paso (o el tamaño del lienzo), no en cada fase.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey, follow, pane.width, pane.height]);

  const steps = tour?.steps ?? [];
  const current = steps[playing.step];
  const last = steps.length - 1;
  const isEnded = ended(tour, playing);
  const atStart = playing.step === 0 && playing.phase === firstPhase(tour, 0) && playing.mode === 'paused';

  const togglePlay = () =>
    setPlaying((p) => {
      if (!p) return p;
      if (p.mode === 'play') return { ...p, mode: 'paused' };
      if (ended(tour, p)) return { ...p, step: 0, phase: firstPhase(tour, 0), mode: 'play' };
      return { ...p, mode: 'play' };
    });
  const restart = () => setPlaying((p) => p && { ...p, step: 0, phase: firstPhase(tour, 0), mode: 'play' });
  const next = () => setPlaying((p) => (p && p.step < last ? goTo(tour, p, p.step + 1) : p));
  const previous = () => setPlaying((p) => (p && p.step > 0 ? goTo(tour, p, p.step - 1) : p));
  const jump = (index: number) => setPlaying((p) => p && goTo(tour, p, index));

  // Teclado: Espacio reproduce o pausa, ← → pasos, Inicio reinicia, Esc detiene. Se vuelve a enlazar en cada render
  // (como los atajos del lienzo) para usar siempre el estado actual.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest('select, input, textarea')) return;
      if (e.key === ' ' || e.key === 'k') togglePlay();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') previous();
      else if (e.key === 'Home') restart();
      else if (e.key === 'Escape') onExit();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!tour) return null;

  const describe = (index: number) => stepSummary(steps[index], edges, nodes, items);

  /** Si la conexión del paso llega a (o sale de) una interfaz con recorrido interno, cuál. */
  const inside = (edgeId: string | undefined) => {
    const edge = edgeId ? edges[edgeId] : undefined;
    if (!edge) return null;
    for (const [nodeId, ref] of [
      [edge.to, edge.toInterface],
      [edge.from, edge.fromInterface],
    ] as const) {
      const node = nodes[nodeId];
      const iface = interfaceTarget(node, ref, modules);
      if (node?.moduleId && iface?.tourId) return { moduleId: node.moduleId, nodeId, tourId: iface.tourId, name: iface.tourName ?? iface.name };
    }
    return null;
  };

  const playLabel =
    playing.mode === 'play' ? '⏸ Pausar' : isEnded ? '↺ Reproducir de nuevo' : atStart ? '▶ Reproducir' : '▶ Continuar';

  return (
    <div
      className="flow-player"
      role="region"
      aria-label="Reproducción del recorrido"
      // Centrada en el área libre (sin el inspector).
      style={{ left: pane.width / 2, width: `min(820px, ${Math.max(280, pane.width - 24)}px)` }}
    >
      <div className="flow-bar" role="toolbar" aria-label="Controles del recorrido">
        <strong className="flow-name">{tour.name}</strong>
        <span className="flow-progress" role="status">
          Paso {playing.step + 1} de {steps.length}
        </span>
        <div className="flow-controls">
          <button type="button" className="pixel-button icon-button" aria-label="Reiniciar" data-tip="Reiniciar · Inicio" onClick={restart}>
            ⏮
          </button>
          <button
            type="button"
            className="pixel-button icon-button"
            aria-label="Paso anterior"
            data-tip="Paso anterior · ←"
            disabled={playing.step === 0}
            onClick={previous}
          >
            ◀
          </button>
          <button type="button" className="pixel-button is-primary flow-play" onClick={togglePlay} data-tip="Espacio">
            {playLabel}
          </button>
          <button
            type="button"
            className="pixel-button icon-button"
            aria-label="Paso siguiente"
            data-tip="Paso siguiente · →"
            disabled={playing.step >= last}
            onClick={next}
          >
            ▶
          </button>
          <button type="button" className="pixel-button" onClick={onExit} data-tip="Esc">
            ■ Detener
          </button>
        </div>
        <div className="flow-view">
          <label className="flow-speed">
            Velocidad
            <select
              value={speed}
              onChange={(e) => {
                const value = Number(e.target.value);
                onSpeed(value);
                setFlowSpeed(value);
              }}
            >
              {FLOW_SPEEDS.map((v) => (
                <option key={v} value={v}>
                  {String(v).replace('.', ',')}×
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="pixel-button is-ghost"
            onClick={() => {
              setFollow(false);
              frame(frames.all);
            }}
          >
            ⛶ Encuadrar recorrido
          </button>
          <label className="panel-check flow-follow">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
            Seguir paso
          </label>
        </div>
      </div>
      <div className="flow-detail" aria-live="polite">
        <p className="flow-route" data-removed={current?.removedEdge ? true : undefined}>
          <span className="flow-step-number">{playing.step + 1}</span> {describe(playing.step)}
        </p>
        {current?.note ? <p className="flow-note">{current.note}</p> : null}
        {!share && inside(current?.edgeId) && (
          // El paso pasa por la interfaz de un módulo con recorrido interno (spec modulos-compartidos, criterio 24).
          <button
            type="button"
            className="pixel-button flow-inside"
            onClick={() => {
              const target = inside(current?.edgeId)!;
              openModule(target.moduleId, {
                nodeId: target.nodeId,
                play: { tourId: target.tourId, returnTour: playing.tourId, returnStep: playing.step },
              });
            }}
          >
            [::] Ver dentro del módulo: {inside(current?.edgeId)!.name}
          </button>
        )}
        {isEnded && <p className="panel-help">Fin del recorrido.</p>}
      </div>
      {steps.length > 1 && (
        <ol className="flow-chips" aria-label="Pasos del recorrido">
          {steps.map((step, index) => (
            <li key={index}>
              <button
                type="button"
                className="flow-chip"
                aria-current={index === playing.step ? 'step' : undefined}
                data-done={index < playing.step || undefined}
                data-removed={step.removedEdge ? true : undefined}
                title={describe(index)}
                aria-label={`Ir al paso ${index + 1}: ${describe(index)}`}
                onClick={() => jump(index)}
              >
                {index + 1}
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
