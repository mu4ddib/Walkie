import { useCallback, useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import type { Edge, Node, Tour } from '../../schema/walkie-graph';
import { useGraphStore } from '../../store/useGraphStore';
import { stepIssues, type TourStep } from '../../tours/flows';
import type { MenuAction } from './ActionMenu';
import { StepItem } from './StepItem';
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
}

/**
 * Pasos de un tour o recorrido como acordeones (spec tours-compactos): reordenar arrastrando desde el asa (o ↑ ↓ con el
 * foco en ella), y un menú por paso con subir, bajar, insertar después, duplicar, localizar y quitar. La identidad de
 * cada paso (`id`) es la clave: moverlo conserva si está abierto y lo que tiene.
 */
export function StepList(props: StepListProps) {
  const { tour, flow, open, onOpen, focusId, onFocused, playback } = props;
  const { moveStep, moveStepTo, duplicateStep, removeStep } = useGraphStore((s) => s);
  const edges = useGraphStore((s) => s.edges);
  const issues = stepIssues(tour, edges);
  const [drag, setDrag] = useState<{ from: number; drop: { index: number; where: 'before' | 'after' } | null } | null>(null);
  const [announce, setAnnounce] = useState('');
  const list = useRef<HTMLOListElement>(null);
  // Tras mover con el teclado, el foco sigue en el asa del mismo paso.
  const regrip = useRef<string | null>(null);

  useEffect(() => {
    const id = regrip.current;
    if (!id) return;
    regrip.current = null;
    list.current?.querySelector<HTMLElement>(`[data-grip="${CSS.escape(id)}"]`)?.focus();
  }, [tour.steps]);

  // Reproducción: el paso activo se ve, desplazando la lista solo si hace falta.
  const activeStep = playback?.step;
  useEffect(() => {
    if (activeStep === undefined) return;
    const item = list.current?.children[activeStep] as HTMLElement | undefined;
    if (item) revealInPanel(item);
  }, [activeStep]);

  const move = useCallback(
    (from: number, to: number) => {
      if (to < 0 || to >= tour.steps.length || from === to) return;
      moveStepTo(tour.id, from, to);
      setAnnounce(`Paso movido a la posición ${to + 1} de ${tour.steps.length}.`);
    },
    [moveStepTo, tour.id, tour.steps.length],
  );

  const actionsFor = (index: number, step: TourStep): MenuAction[] => {
    const n = index + 1;
    return [
      ...(props.onLocate && !step.removedEdge
        ? [{ label: 'Localizar en lienzo', ariaLabel: `Localizar paso ${n} en el lienzo`, onSelect: () => props.onLocate!(step) }]
        : []),
      { label: 'Subir', ariaLabel: `Subir paso ${n}`, disabled: index === 0, onSelect: () => moveStep(tour.id, index, -1) },
      {
        label: 'Bajar',
        ariaLabel: `Bajar paso ${n}`,
        disabled: index === tour.steps.length - 1,
        onSelect: () => moveStep(tour.id, index, 1),
      },
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

  return (
    <>
      <ol className="tour-steps" aria-label="Pasos" ref={list}>
        {tour.steps.map((step, index) => (
          <StepItem
            key={step.id ?? `i${index}`}
            tourId={tour.id}
            index={index}
            count={tour.steps.length}
            step={step}
            flow={flow}
            issues={issues[index] ?? []}
            open={!!step.id && open.includes(step.id)}
            onToggle={() => step.id && onOpen(toggleStep(open, step.id))}
            focusOnOpen={!!step.id && focusId === step.id}
            onFocused={onFocused}
            nodeOptions={props.nodeOptions}
            edgeOptions={props.edgeOptions}
            actions={actionsFor(index, step)}
            onLocate={props.onLocate ? () => props.onLocate!(step) : undefined}
            playback={playback ? { active: playback.step === index, onJump: () => playback.onJump(index) } : undefined}
            drag={dragFor(index, step)}
          />
        ))}
      </ol>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </>
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
