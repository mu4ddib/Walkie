import { useCallback, useEffect, useRef, useState } from 'react';
import { useReactFlow, type Viewport } from '@xyflow/react';
import { useOpenFeature } from '../canvas/useOpenFeature';
import { portalTarget, useCanvasCatalog } from '../catalog/catalogContext';
import { useGraphStore } from '../store/useGraphStore';
import { GUIDE_FRAME } from './guideSprites';
import { Guide } from './Guide';
import { TOUR_TIMING, TOUR_ZOOM } from './tourTiming';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

const GUIDE_SCALE = 2;
const GUIDE_SIZE = GUIDE_FRAME.width * GUIDE_SCALE;
/** Del borde inferior del cuadro a los pies (64 - 54 px, ×2): el guía apoya los pies en la base del nodo. */
const GUIDE_FEET_OFFSET = (GUIDE_FRAME.height - GUIDE_FRAME.baselineY) * GUIDE_SCALE;

type Phase = 'walk' | 'gesture' | 'talk' | 'celebrate';

interface TourPlayerProps {
  tourId: string;
  /** Medidas de los nodos (las reporta React Flow al lienzo). */
  sizes: Record<string, { width: number; height: number }>;
  /** Tamaño del área del lienzo, para ubicar el guía y el globo junto al nodo centrado. */
  pane: { width: number; height: number };
  step: number;
  onStep: (step: number) => void;
  onExit: () => void;
}

/**
 * Modo tour (spec modo-tour, criterios 5 a 10): centra cada nodo, el guía camina hasta él, lo señala
 * (o piensa, si es una regla) y cuenta la nota; Anterior/Siguiente/Salir y ← → Esc; celebra al terminar.
 * Al salir vuelve la vista que había.
 */
export function TourPlayer({ tourId, sizes, pane, step, onStep, onExit }: TourPlayerProps) {
  const tour = useGraphStore((s) => s.tours[tourId]);
  const nodes = useGraphStore((s) => s.nodes);
  const layout = useGraphStore((s) => s.layout);
  const { features } = useCanvasCatalog();
  const openFeature = useOpenFeature();
  const { setCenter, getViewport, setViewport } = useReactFlow();
  const reduced = usePrefersReducedMotion();
  const [phase, setPhase] = useState<{ step: number; phase: Phase; chars: number }>({
    step,
    phase: 'walk',
    chars: 0,
  });

  // Vista anterior: se restaura al salir del modo tour (criterio 7).
  const saved = useRef<Viewport | null>(null);
  useEffect(() => {
    saved.current = getViewport();
    return () => {
      if (saved.current) void setViewport(saved.current);
    };
  }, [getViewport, setViewport]);

  const steps = tour?.steps ?? [];
  const current = steps[step];
  const node = current?.nodeId ? nodes[current.nodeId] : undefined;
  const note = current?.note ?? '';
  const last = step === steps.length - 1;
  const destination = node ? portalTarget(node, features) : undefined;

  // Cada paso empieza caminando (o hablando de una vez con movimiento reducido).
  if (phase.step !== step) setPhase({ step, phase: reduced ? 'talk' : 'walk', chars: reduced ? note.length : 0 });
  const state = phase.step === step ? phase : { step, phase: 'walk' as Phase, chars: 0 };

  // Centra el nodo del paso.
  const size = node ? (sizes[node.id] ?? { width: 160, height: 48 }) : undefined;
  const target = node && size ? centerOf(layout[node.id] ?? { x: 0, y: 0 }, size) : undefined;
  const targetX = target?.x;
  const targetY = target?.y;
  useEffect(() => {
    if (targetX === undefined || targetY === undefined) return;
    void setCenter(targetX, targetY, { zoom: TOUR_ZOOM, duration: reduced ? 0 : TOUR_TIMING.pan });
    // Al entrar al modo tour se ocultan paleta y panel y el lienzo se agranda: se vuelve a centrar con el ancho nuevo.
  }, [targetX, targetY, setCenter, reduced, pane.width, pane.height]);

  // walk → gesto (point/think lo termina el Guide) ; talk escribe la nota letra a letra → idle.
  useEffect(() => {
    if (state.phase === 'walk') {
      const t = setTimeout(() => setPhase((p) => ({ ...p, phase: 'gesture' })), TOUR_TIMING.walk);
      return () => clearTimeout(t);
    }
    if (state.phase === 'talk' && state.chars < note.length) {
      const t = setTimeout(() => setPhase((p) => ({ ...p, chars: p.chars + 1 })), TOUR_TIMING.typing);
      return () => clearTimeout(t);
    }
  }, [state.phase, state.chars, note.length]);

  const onGestureEnd = useCallback(() => setPhase((p) => (p.phase === 'gesture' ? { ...p, phase: 'talk' } : p)), []);
  const onCelebrateEnd = useCallback(() => onExit(), [onExit]);

  const next = useCallback(() => {
    if (last) setPhase((p) => ({ ...p, phase: 'celebrate' }));
    else onStep(step + 1);
  }, [last, onStep, step]);
  const previous = useCallback(() => step > 0 && onStep(step - 1), [onStep, step]);

  // Teclado: ← → y Esc (criterio 7).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') previous();
      else if (e.key === 'Escape') onExit();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, previous, onExit]);

  if (!tour || !current || !node || !size) return null;

  // Terminada la nota, el guía queda quieto (estado derivado: no hace falta otro render).
  const talking = state.phase === 'talk' && state.chars < note.length;
  const animation =
    state.phase === 'walk'
      ? 'walk'
      : state.phase === 'gesture'
        ? node.type === 'rule'
          ? 'think'
          : 'point'
        : state.phase === 'celebrate'
          ? 'celebrate'
          : talking
            ? 'talk'
            : 'idle';
  const nodeHalfW = (size.width * TOUR_ZOOM) / 2;
  const nodeBottom = pane.height / 2 + (size.height * TOUR_ZOOM) / 2;
  const celebrating = state.phase === 'celebrate';

  return (
    <div className="tour-player">
      <div className="tour-bar" role="toolbar" aria-label="Tour">
        <strong>{tour.name}</strong>
        <span className="tour-progress" role="status">
          Paso {step + 1} de {steps.length}
        </span>
        <button type="button" className="pixel-button" onClick={previous} disabled={step === 0 || celebrating}>
          Anterior
        </button>
        <button type="button" className="pixel-button" onClick={next} disabled={celebrating}>
          {last ? 'Terminar' : 'Siguiente'}
        </button>
        <button type="button" className="pixel-button" onClick={onExit}>
          Salir
        </button>
      </div>
      <div
        key={step}
        className={['tour-guide', state.phase === 'walk' && !reduced ? 'tour-guide-walking' : '']
          .filter(Boolean)
          .join(' ')}
        style={{
          left: pane.width / 2 - nodeHalfW - GUIDE_SIZE - 8,
          top: nodeBottom - GUIDE_SIZE + GUIDE_FEET_OFFSET,
        }}
      >
        <Guide
          animation={animation}
          scale={GUIDE_SCALE}
          onEnd={celebrating ? onCelebrateEnd : state.phase === 'gesture' ? onGestureEnd : undefined}
        />
      </div>
      <div
        className="tour-bubble"
        role="region"
        aria-label="Paso del tour"
        aria-live="polite"
        style={{ left: pane.width / 2 - 160, top: nodeBottom + 16 }}
      >
        <p className="tour-bubble-title">{node.title}</p>
        {celebrating ? (
          <p>¡Fin del tour! Ya conoces este flujo.</p>
        ) : (
          <>
            {/* El texto completo para lectores de pantalla; el visible aparece letra a letra. */}
            <span className="sr-only">{note}</span>
            <p aria-hidden="true">{note.slice(0, state.chars) || (state.phase === 'walk' ? '…' : '')}</p>
            {!note && state.phase !== 'walk' && <p className="panel-help">(Este paso no tiene nota.)</p>}
          </>
        )}
        {destination && !celebrating && (
          <button type="button" className="pixel-button" onClick={() => openFeature(destination.id)}>
            Ir a {destination.name}
          </button>
        )}
      </div>
    </div>
  );
}

function centerOf(position: { x: number; y: number }, size: { width: number; height: number }) {
  return { x: position.x + size.width / 2, y: position.y + size.height / 2 };
}
