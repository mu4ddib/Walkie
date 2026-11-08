import { useId, useState, type FormEvent } from 'react';
import { NODE_LABELS } from '../nodes/nodeMeta';
import type { Node } from '../schema/walkie-graph';
import { STEP_NOTE_MAX_LENGTH, TOUR_NAME_MAX_LENGTH } from '../store/graphStore';
import { useGraphStore } from '../store/useGraphStore';
import { TextField } from './TextField';

export interface ToursSectionProps {
  /** Tour abierto en el editor (lo guarda el lienzo para no perderlo al seleccionar un nodo). */
  openTourId: string | null;
  onOpen: (tourId: string | null) => void;
  /** "Ver tour" (modo tour); sin él, el botón no aparece. */
  onPlay?: (tourId: string) => void;
}

/**
 * Tours de la feature (spec modo-tour, criterios 1 a 3): con nada seleccionado en el lienzo, lista,
 * "Nuevo tour" y el editor de un tour. Todo cambia el grafo por las acciones del store.
 */
export function ToursSection({ openTourId, onOpen, onPlay }: ToursSectionProps) {
  const tours = useGraphStore((s) => s.tours);
  const open = openTourId ? tours[openTourId] : undefined;

  return (
    <section className="panel-section" aria-label="Tours">
      <h4>Tours</h4>
      {open ? (
        <TourEditor key={open.id} tourId={open.id} onClose={() => onOpen(null)} onPlay={onPlay} />
      ) : (
        <>
          {Object.values(tours).length === 0 && (
            <p className="panel-help">Aún no hay tours. Crea uno para guiar a quien llega nuevo.</p>
          )}
          <ul className="panel-list tours-list">
            {Object.values(tours)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((tour) => (
                <li key={tour.id}>
                  <button type="button" className="link-button" onClick={() => onOpen(tour.id)}>
                    {tour.name}
                  </button>{' '}
                  <span className="panel-help">({tour.steps.length} pasos)</span>
                </li>
              ))}
          </ul>
          <NewTourForm onCreated={onOpen} />
        </>
      )}
    </section>
  );
}

function NewTourForm({ onCreated }: { onCreated: (tourId: string) => void }) {
  const addTour = useGraphStore((s) => s.addTour);
  const [name, setName] = useState('');
  const inputId = useId();

  function submit(event: FormEvent) {
    event.preventDefault();
    const id = addTour(name);
    if (id) {
      setName('');
      onCreated(id);
    }
  }

  return (
    <form className="panel-field" onSubmit={submit} aria-label="Nuevo tour">
      <label htmlFor={inputId}>Nombre del tour nuevo</label>
      <input
        id={inputId}
        type="text"
        value={name}
        maxLength={TOUR_NAME_MAX_LENGTH}
        placeholder="Iniciar sesión"
        onChange={(e) => setName(e.target.value)}
      />
      <button type="submit" className="pixel-button" disabled={!name.trim()}>
        Nuevo tour
      </button>
    </form>
  );
}

function TourEditor({
  tourId,
  onClose,
  onPlay,
}: {
  tourId: string;
  onClose: () => void;
  onPlay?: (tourId: string) => void;
}) {
  const tour = useGraphStore((s) => s.tours[tourId]);
  const nodes = useGraphStore((s) => s.nodes);
  const { renameTour, removeTour, addStep } = useGraphStore((s) => s);
  const options = Object.values(nodes).sort((a, b) => a.title.localeCompare(b.title));
  const [newNode, setNewNode] = useState('');
  const newNodeId = useId();
  if (!tour) return null;

  function add() {
    const nodeId = newNode || options[0]?.id;
    if (nodeId && addStep(tourId, nodeId) !== null) setNewNode('');
  }

  return (
    <div className="tour-editor">
      <button type="button" className="link-button" onClick={onClose}>
        ← Todos los tours
      </button>
      <TextField
        label="Nombre del tour"
        value={tour.name}
        maxLength={TOUR_NAME_MAX_LENGTH}
        validate={(name) => (name.trim() ? null : 'El nombre no puede quedar vacío.')}
        onChange={(name) => renameTour(tourId, name)}
      />
      {onPlay && (
        <button
          type="button"
          className="pixel-button"
          disabled={tour.steps.length === 0}
          onClick={() => onPlay(tourId)}
        >
          Ver tour
        </button>
      )}
      <ol className="tour-steps" aria-label="Pasos">
        {tour.steps.map((step, index) => (
          <StepEditor
            key={`${index}-${step.nodeId}`}
            tourId={tourId}
            index={index}
            count={tour.steps.length}
            nodeId={step.nodeId}
            note={step.note ?? ''}
            options={options}
          />
        ))}
      </ol>
      {options.length === 0 ? (
        <p className="panel-help">Agrega nodos al lienzo para armar los pasos.</p>
      ) : (
        <div className="panel-field">
          <label htmlFor={newNodeId}>Nodo del paso nuevo</label>
          <select id={newNodeId} value={newNode || options[0]!.id} onChange={(e) => setNewNode(e.target.value)}>
            {options.map((n) => (
              <option key={n.id} value={n.id}>
                {nodeLabel(n)}
              </option>
            ))}
          </select>
          <button type="button" className="pixel-button" onClick={add}>
            Agregar paso
          </button>
        </div>
      )}
      <button
        type="button"
        className="pixel-button"
        onClick={() => {
          removeTour(tourId);
          onClose();
        }}
      >
        Borrar tour
      </button>
    </div>
  );
}

function StepEditor({
  tourId,
  index,
  count,
  nodeId,
  note,
  options,
}: {
  tourId: string;
  index: number;
  count: number;
  nodeId: string;
  note: string;
  options: Node[];
}) {
  const { setStepNode, updateStepNote, moveStep, removeStep } = useGraphStore((s) => s);
  const selectId = useId();

  return (
    <li className="tour-step" aria-label={`Paso ${index + 1}`}>
      <div className="panel-field">
        <label htmlFor={selectId}>Paso {index + 1}: nodo</label>
        <select id={selectId} value={nodeId} onChange={(e) => setStepNode(tourId, index, e.target.value)}>
          {options.map((n) => (
            <option key={n.id} value={n.id}>
              {nodeLabel(n)}
            </option>
          ))}
        </select>
      </div>
      <TextField
        label={`Paso ${index + 1}: nota`}
        multiline
        value={note}
        maxLength={STEP_NOTE_MAX_LENGTH}
        placeholder="Lo que el guía cuenta en este paso"
        onChange={(text) => updateStepNote(tourId, index, text)}
      />
      <div className="tour-step-actions">
        <button
          type="button"
          className="pixel-button"
          aria-label={`Subir paso ${index + 1}`}
          disabled={index === 0}
          onClick={() => moveStep(tourId, index, -1)}
        >
          ↑
        </button>
        <button
          type="button"
          className="pixel-button"
          aria-label={`Bajar paso ${index + 1}`}
          disabled={index === count - 1}
          onClick={() => moveStep(tourId, index, 1)}
        >
          ↓
        </button>
        <button
          type="button"
          className="pixel-button"
          aria-label={`Quitar paso ${index + 1}`}
          onClick={() => removeStep(tourId, index)}
        >
          Quitar
        </button>
      </div>
    </li>
  );
}

function nodeLabel(node: Node): string {
  return `${NODE_LABELS[node.type].label}: ${node.title}`;
}
