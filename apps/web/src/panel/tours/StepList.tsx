import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import type { Edge, Node, Tour } from '../../schema/walkie-graph';
import { useGraphStore } from '../../store/useGraphStore';
import { stepIssues, tourKind, type TourStep } from '../../tours/flows';
import type { MenuAction } from './ActionMenu';
import { StepItem } from './StepItem';
import { OVERSCAN, STEP_ESTIMATE, VIRTUAL_FROM, offsetsOf, windowRange } from './stepWindow';
import { toggleStep } from './toursUi';

export interface StepListProps {
  tour: Tour;
  flow: boolean;
  /** Pasos abiertos (ids) y cómo cambiarlos: estado de interfaz, no del documento. */
  open: readonly string[];
  onOpen: (next: string[]) => void;
  /** Paso a enfocar al abrirse (recién creado). */
  focusId: string | null;
  onFocused: () => void;
  nodeOptions: Node[];
  edgeOptions: { edge: Edge; text: string }[];
  /** Insertar un paso después de `index`; devuelve el id nuevo (la lista lo abre y lo enfoca). */
  onInsertAfter: (index: number) => string | null;
  onCreated: (id: string) => void;
  onLocate?: (step: TourStep) => void;
  /** Reproducción: paso activo y saltar a otro. */
  playback?: { step: number; onJump: (step: number) => void };
  /** Solo lectura (enlace compartido): se abren para leer la nota, sin asa, menú ni campos. */
  readOnly?: boolean;
}

/** Clave de un paso (su identidad; los muy anteriores, sin id, por posición). */
const keyOf = (step: TourStep, index: number) => step.id ?? `i${index}`;

/**
 * Pasos de un tour o recorrido como acordeones (spec tours-compactos): reordenar arrastrando desde el asa (o ↑ ↓ con el
 * foco en ella), y un menú por paso con subir, bajar, insertar después, duplicar, mover a otro tour, localizar y quitar.
 * La identidad de cada paso (`id`) es la clave: moverlo conserva si está abierto y lo que tiene. Desde `VIRTUAL_FROM`
 * pasos solo se dibujan los que se ven en el inspector (spec tours-a-escala), con espaciadores que guardan el alto.
 */
export function StepList(props: StepListProps) {
  const { tour, flow, open, onOpen, focusId, onFocused, playback, readOnly } = props;
  const { moveStep, moveStepTo, duplicateStep, removeStep, moveStepToTour } = useGraphStore((s) => s);
  const edges = useGraphStore((s) => s.edges);
  const tours = useGraphStore((s) => s.tours);
  const issues = useMemo(() => stepIssues(tour, edges), [tour, edges]);
  const [drag, setDrag] = useState<{ from: number; drop: { index: number; where: 'before' | 'after' } | null } | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const list = useRef<HTMLOListElement>(null);
  // Tras mover con el teclado, el foco sigue en el asa del mismo paso.
  const regrip = useRef<string | null>(null);
  const count = tour.steps.length;

  // Otros tours a los que puede ir un paso: de nodo a un tour; de conexión a un recorrido.
  const targetsFor = (step: TourStep) => {
    const kind = step.nodeId ? 'guide' : 'flow';
    return Object.values(tours)
      .filter((t) => t.id !== tour.id && tourKind(t) === kind)
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  };

  // --- Ventana: qué pasos se dibujan -------------------------------------------------------------------------------
  const virtual = count >= VIRTUAL_FROM;
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [view, setView] = useState({ top: 0, height: 900 });
  const offsets = useMemo(
    () => (virtual ? offsetsOf(tour.steps.map((s, i) => heights.get(keyOf(s, i)) ?? STEP_ESTIMATE)) : []),
    [virtual, tour.steps, heights],
  );
  const [start, end] = virtual ? windowRange(offsets, view.top, view.height, OVERSCAN, drag?.from) : [0, count];

  /** El inspector (lo que se desplaza) y dónde empieza la lista dentro de él. */
  const frame = useCallback(() => {
    const el = list.current;
    const scroller = el?.closest<HTMLElement>('.properties-panel');
    if (!el || !scroller) return null;
    const listTop = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    return { scroller, listTop };
  }, []);

  useEffect(() => {
    if (!virtual) return;
    const f = frame();
    if (!f) return;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const now = frame();
        if (!now) return;
        const top = now.scroller.scrollTop - now.listTop;
        const height = now.scroller.clientHeight;
        setView((v) => (v.top === top && v.height === height ? v : { top, height }));
      });
    };
    update();
    f.scroller.addEventListener('scroll', update, { passive: true });
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    resize?.observe(f.scroller);
    return () => {
      cancelAnimationFrame(raf);
      f.scroller.removeEventListener('scroll', update);
      resize?.disconnect();
    };
  }, [virtual, frame]);

  // Medir lo dibujado: los pasos abiertos o con texto largo no miden lo estimado.
  useLayoutEffect(() => {
    if (!virtual || !list.current) return;
    const gap = parseFloat(getComputedStyle(list.current).rowGap) || 0;
    const found: [string, number][] = [];
    list.current.querySelectorAll<HTMLElement>(':scope > [data-step-key]').forEach((item) => {
      found.push([item.dataset.stepKey!, item.offsetHeight + gap]);
    });
    setHeights((known) => {
      const changed = found.filter(([key, h]) => Math.abs((known.get(key) ?? STEP_ESTIMATE) - h) > 0.5);
      return changed.length === 0 ? known : new Map([...known, ...changed]);
    });
  }, [virtual, start, end, tour.steps, open, moving]);

  useEffect(() => {
    const id = regrip.current;
    if (!id) return;
    regrip.current = null;
    list.current?.querySelector<HTMLElement>(`[data-grip="${CSS.escape(id)}"]`)?.focus();
  }, [tour.steps]);

  // Reproducción: el paso activo se ve, desplazando el inspector solo si hace falta. Si la ventana aún no lo dibuja,
  // primero se desplaza a su posición estimada y, ya dibujado, se ajusta.
  const activeStep = playback?.step;
  const reveal = useRef<number | null>(null);
  useEffect(() => {
    if (activeStep === undefined) return;
    reveal.current = activeStep;
    const item = list.current?.querySelector<HTMLElement>(`:scope > [data-index="${activeStep}"]`);
    if (item) {
      revealInPanel(item);
      reveal.current = null;
      return;
    }
    const f = frame();
    if (f && virtual) {
      const head = f.scroller.querySelector('.tour-detail-head')?.getBoundingClientRect().height ?? 0;
      f.scroller.scrollTop = f.listTop + offsets[activeStep]! - head - 8;
    }
    // Solo al cambiar de paso: las medidas no deben volver a desplazar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStep]);
  useEffect(() => {
    if (reveal.current === null) return;
    const item = list.current?.querySelector<HTMLElement>(`:scope > [data-index="${reveal.current}"]`);
    if (item) {
      revealInPanel(item);
      reveal.current = null;
    }
  }, [start, end]);

  const move = useCallback(
    (from: number, to: number) => {
      if (to < 0 || to >= count || from === to) return;
      moveStepTo(tour.id, from, to);
      setAnnounce(`Paso movido a la posición ${to + 1} de ${count}.`);
    },
    [moveStepTo, tour.id, count],
  );

  const actionsFor = (index: number, step: TourStep): MenuAction[] => {
    const n = index + 1;
    const targets = targetsFor(step);
    return [
      ...(props.onLocate && !step.removedEdge
        ? [{ label: 'Localizar en lienzo', ariaLabel: `Localizar paso ${n} en el lienzo`, onSelect: () => props.onLocate!(step) }]
        : []),
      { label: 'Subir', ariaLabel: `Subir paso ${n}`, disabled: index === 0, onSelect: () => moveStep(tour.id, index, -1) },
      { label: 'Bajar', ariaLabel: `Bajar paso ${n}`, disabled: index === count - 1, onSelect: () => moveStep(tour.id, index, 1) },
      {
        label: 'Insertar paso después',
        ariaLabel: `Insertar paso después del ${n}`,
        onSelect: () => {
          const id = props.onInsertAfter(index);
          if (id) props.onCreated(id);
        },
      },
      {
        label: 'Duplicar',
        ariaLabel: `Duplicar paso ${n}`,
        onSelect: () => {
          const id = duplicateStep(tour.id, index);
          if (id) props.onCreated(id);
        },
      },
      ...(targets.length > 0 && step.id
        ? [
            {
              label: step.nodeId ? 'Mover a otro tour…' : 'Mover a otro recorrido…',
              ariaLabel: `Mover paso ${n} a otro ${step.nodeId ? 'tour' : 'recorrido'}`,
              onSelect: () => setMoving(step.id!),
            },
          ]
        : []),
      {
        label: 'Quitar',
        ariaLabel: `Quitar paso ${n}`,
        danger: true,
        onSelect: () => {
          removeStep(tour.id, index);
          if (step.id) onOpen(open.filter((x) => x !== step.id));
        },
      },
    ];
  };

  const moveTo = (index: number, step: TourStep, target: Tour) => {
    if (moveStepToTour(tour.id, index, target.id)) {
      if (step.id) onOpen(open.filter((x) => x !== step.id));
      setAnnounce(`Paso ${index + 1} movido al final de «${target.name}».`);
    }
    setMoving(null);
  };

  const dragFor = (index: number, step: TourStep) => ({
    onStart: (e: DragEvent) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', step.id ?? String(index));
      setDrag({ from: index, drop: null });
    },
    onEnd: () => setDrag(null),
    onOver: (e: DragEvent<HTMLLIElement>) => {
      if (!drag) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = e.currentTarget.getBoundingClientRect();
      const where = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
      if (drag.drop?.index !== index || drag.drop.where !== where) setDrag({ ...drag, drop: { index, where } });
    },
    onDrop: (e: DragEvent<HTMLLIElement>) => {
      if (!drag?.drop) return;
      e.preventDefault();
      let to = drag.drop.where === 'before' ? drag.drop.index : drag.drop.index + 1;
      if (drag.from < to) to -= 1;
      move(drag.from, to);
      setDrag(null);
    },
    drop: drag?.drop?.index === index && drag.from !== index ? drag.drop.where : null,
    dragging: drag?.from === index,
    onKey: (e: KeyboardEvent<HTMLElement>) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      move(index, index + (e.key === 'ArrowUp' ? -1 : 1));
      if (step.id) regrip.current = step.id;
    },
  });

  const shown = tour.steps.slice(start, end);
  return (
    <>
      <ol className="tour-steps" aria-label="Pasos" ref={list} data-virtual={virtual || undefined}>
        {virtual && start > 0 && <li className="tour-steps-spacer" aria-hidden="true" style={{ height: offsets[start] }} />}
        {shown.map((step, at) => {
          const index = start + at;
          return (
            <StepItem
              key={keyOf(step, index)}
              itemKey={keyOf(step, index)}
              tourId={tour.id}
              index={index}
              count={count}
              step={step}
              flow={flow}
              issues={issues[index] ?? []}
              open={!!step.id && open.includes(step.id)}
              onToggle={() => step.id && onOpen(toggleStep(open, step.id))}
              focusOnOpen={!!step.id && focusId === step.id}
              onFocused={onFocused}
              nodeOptions={props.nodeOptions}
              edgeOptions={props.edgeOptions}
              actions={readOnly ? [] : actionsFor(index, step)}
              onLocate={props.onLocate ? () => props.onLocate!(step) : undefined}
              playback={playback ? { active: playback.step === index, onJump: () => playback.onJump(index) } : undefined}
              readOnly={readOnly}
              setSize={virtual ? count : undefined}
              drag={dragFor(index, step)}
              extra={
                moving && moving === step.id ? (
                  <MovePicker
                    n={index + 1}
                    flow={!step.nodeId}
                    targets={targetsFor(step)}
                    onMove={(target) => moveTo(index, step, target)}
                    onCancel={() => setMoving(null)}
                  />
                ) : null
              }
            />
          );
        })}
        {virtual && end < count && (
          <li className="tour-steps-spacer" aria-hidden="true" style={{ height: offsets[count]! - offsets[end]! }} />
        )}
      </ol>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </>
  );
}

/** Elegir a qué tour (o recorrido) pasa un paso; va al final. Esc cancela. */
function MovePicker({
  n,
  flow,
  targets,
  onMove,
  onCancel,
}: {
  n: number;
  flow: boolean;
  targets: Tour[];
  onMove: (target: Tour) => void;
  onCancel: () => void;
}) {
  const [target, setTarget] = useState(targets[0]?.id ?? '');
  const selectId = useId();
  const chosen = targets.find((t) => t.id === target) ?? targets[0];
  return (
    <form
      className="tour-step-move"
      aria-label={`Mover paso ${n}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (chosen) onMove(chosen);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <label htmlFor={selectId}>
        Mover paso {n} al final de{flow ? 'l recorrido' : 'l tour'}
      </label>
      <div className="tour-step-move-row">
        <select id={selectId} value={chosen?.id ?? ''} autoFocus onChange={(e) => setTarget(e.target.value)}>
          {targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button type="submit" className="pixel-button is-primary">
          Mover
        </button>
        <button type="button" className="pixel-button is-ghost" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

/**
 * Desplaza solo el inspector (no sus contenedores) lo justo para que `item` se vea entre la cabecera y el pie fijos del
 * tour. `scrollIntoView` movería también los ancestros con `overflow: hidden` y cortaría el panel.
 */
function revealInPanel(item: HTMLElement) {
  const scroller = item.closest<HTMLElement>('.properties-panel');
  if (!scroller) return;
  const view = scroller.getBoundingClientRect();
  const head = scroller.querySelector('.tour-detail-head')?.getBoundingClientRect().height ?? 0;
  const foot = scroller.querySelector('.tour-add')?.getBoundingClientRect().height ?? 0;
  const box = item.getBoundingClientRect();
  const top = view.top + head + 8;
  const bottom = view.bottom - foot - 8;
  if (box.top < top) scroller.scrollTop -= top - box.top;
  else if (box.bottom > bottom) scroller.scrollTop += box.bottom - bottom;
}
