import { useId, useMemo, useState, type FormEvent } from 'react';
import { useCanvasCatalog } from '../catalog/catalogContext';
import { NODE_LABELS } from '../nodes/nodeMeta';
import type { Edge, Node, Tour } from '../schema/walkie-graph';
import { STEP_NOTE_MAX_LENGTH, TOUR_NAME_MAX_LENGTH } from '../store/graphStore';
import { useGraphStore } from '../store/useGraphStore';
import { continuations, isFlowTour, lastEnd, stepIssues, suggestOrder, type StepIssue, type TourStep } from '../tours/flows';
import { branchLabel, edgeSummary, nodeTitle, stepSummary } from '../tours/flowText';
import { TextField } from './TextField';

export interface ToursSectionProps {
  /** Tour abierto en el editor (lo guarda el lienzo para no perderlo al seleccionar un nodo). */
  openTourId: string | null;
  onOpen: (tourId: string | null) => void;
  /** "Ver tour" / "Reproducir" (modo tour o reproducción del recorrido); sin él, el botón no aparece. */
  onPlay?: (tourId: string) => void;
  /** Recorrido recién creado desde el lienzo: su nombre se enfoca para escribirlo. */
  createdTourId?: string | null;
  /** Agregar pasos tocando conexiones en el lienzo (lo atiende el lienzo); sin él, la opción no aparece. */
  picking?: { tourId: string | null; onToggle: (tourId: string | null) => void };
}

/**
 * Tours de la feature (spec modo-tour, criterios 1 a 3; spec recorridos-y-grupos, partes 3, 5 y 6): con nada
 * seleccionado en el lienzo, lista, "Nuevo tour" y el editor. Un tour guía por nodos; un recorrido, por conexiones
 * (origen → destino, en su sentido real). Todo cambia el grafo por las acciones del store.
 */
export function ToursSection({ openTourId, onOpen, onPlay, createdTourId, picking }: ToursSectionProps) {
  const tours = useGraphStore((s) => s.tours);
  const edges = useGraphStore((s) => s.edges);
  const open = openTourId ? tours[openTourId] : undefined;

  return (
    <section className="panel-section" aria-label="Tours">
      <h4>Tours y recorridos</h4>
      {open ? (
        <TourEditor
          key={open.id}
          tourId={open.id}
          onClose={() => onOpen(null)}
          onPlay={onPlay}
          focusName={createdTourId === open.id}
          picking={picking}
        />
      ) : (
        <>
          {Object.values(tours).length === 0 && (
            <p className="panel-help">
              Aún no hay tours. Crea uno para guiar a quien llega nuevo, o selecciona conexiones con Mayús + clic y
              usa «Crear recorrido».
            </p>
          )}
          <ul className="panel-list tours-list">
            {Object.values(tours)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((tour) => {
                const pending = pendingCount(tour, edges);
                return (
                  <li key={tour.id}>
                    <button type="button" className="link-button" onClick={() => onOpen(tour.id)}>
                      {tour.name}
                    </button>{' '}
                    {isFlowTour(tour) && <span className="tour-kind">recorrido</span>}{' '}
                    <span className="panel-help">({tour.steps.length} pasos)</span>
                    {pending > 0 && (
                      <span className="tour-warning">
                        {' '}
                        ⚠ {pending === 1 ? '1 paso por revisar' : `${pending} pasos por revisar`}
                      </span>
                    )}
                  </li>
                );
              })}
          </ul>
          <NewTourForm onCreated={onOpen} />
        </>
      )}
    </section>
  );
}

/** Pasos cuya conexión se eliminó (los que hay que reemplazar o quitar). */
function pendingCount(tour: Tour, edges: Record<string, Edge>): number {
  return tour.steps.filter((s) => s.removedEdge || (s.edgeId && !edges[s.edgeId])).length;
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
  focusName,
  picking,
}: {
  tourId: string;
  onClose: () => void;
  onPlay?: (tourId: string) => void;
  focusName: boolean;
  picking?: ToursSectionProps['picking'];
}) {
  const tour = useGraphStore((s) => s.tours[tourId]);
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const { renameTour, removeTour, addStep, addEdgeStep, reorderSteps } = useGraphStore((s) => s);
  const { items } = useCanvasCatalog();
  const nodeOptions = Object.values(nodes).sort((a, b) => a.title.localeCompare(b.title));
  const edgeOptions = useMemo(
    () =>
      Object.values(edges)
        .map((edge) => ({ edge, text: edgeSummary(edge, nodes, items) }))
        .sort((a, b) => a.text.localeCompare(b.text, 'es')),
    [edges, nodes, items],
  );
  const [newNode, setNewNode] = useState('');
  const [newEdge, setNewEdge] = useState('');
  const newNodeId = useId();
  const newEdgeId = useId();
  if (!tour) return null;

  const flow = isFlowTour(tour);
  const issues = stepIssues(tour, edges);
  const end = lastEnd(tour, edges);
  const next = continuations(edges, end);
  const pickingThis = picking?.tourId === tourId;
  // Orden sugerido: solo con todos los pasos sobre conexiones existentes y una única secuencia posible.
  const edgeIds = tour.steps.map((s) => s.edgeId);
  const allEdges = edgeIds.length > 1 && edgeIds.every((id): id is string => !!id && !!edges[id]);
  const suggested = allEdges ? suggestOrder(edgeIds, edges) : null;
  const inOrder = suggested !== null && suggested.every((id, i) => id === edgeIds[i]);

  function applySuggested() {
    if (!suggested) return;
    // Permutación de índices: cada conexión repetida toma su próxima aparición.
    const left = tour!.steps.map((_, i) => i);
    const order = suggested.map((id) => {
      const at = left.findIndex((i) => tour!.steps[i]!.edgeId === id);
      return left.splice(at, 1)[0]!;
    });
    reorderSteps(tourId, order);
  }

  function addNodeStep() {
    const nodeId = newNode || nodeOptions[0]?.id;
    if (nodeId && addStep(tourId, nodeId) !== null) setNewNode('');
  }

  function addConnectionStep() {
    const edgeId = newEdge || edgeOptions[0]?.edge.id;
    if (edgeId && addEdgeStep(tourId, edgeId) !== null) setNewEdge('');
  }

  return (
    <div className="tour-editor">
      <button type="button" className="link-button" onClick={onClose}>
        ← Todos los tours
      </button>
      <TextField
        label={flow ? 'Nombre del recorrido' : 'Nombre del tour'}
        value={tour.name}
        maxLength={TOUR_NAME_MAX_LENGTH}
        autoFocus={focusName}
        validate={(name) => (name.trim() ? null : 'El nombre no puede quedar vacío.')}
        onChange={(name) => renameTour(tourId, name)}
      />
      {onPlay && (
        <button
          type="button"
          className={flow ? 'pixel-button is-primary' : 'pixel-button'}
          disabled={tour.steps.length === 0}
          onClick={() => onPlay(tourId)}
        >
          {flow ? '▶ Reproducir recorrido' : 'Ver tour'}
        </button>
      )}
      {allEdges && (
        <p className="tour-order" role="status">
          {inOrder ? (
            '✓ Los pasos están encadenados.'
          ) : suggested ? (
            <>
              Hay un único orden encadenado.{' '}
              <button type="button" className="link-button" onClick={applySuggested}>
                Aplicar orden sugerido
              </button>
            </>
          ) : (
            'Hay bifurcaciones, ciclos o pasos sueltos: define tú el orden con ↑ ↓.'
          )}
        </p>
      )}
      <ol className="tour-steps" aria-label="Pasos">
        {tour.steps.map((step, index) => (
          <StepEditor
            key={`${index}-${step.nodeId ?? step.edgeId ?? 'removed'}`}
            tourId={tourId}
            index={index}
            count={tour.steps.length}
            step={step}
            issues={issues[index] ?? []}
            nodeOptions={nodeOptions}
            edgeOptions={edgeOptions}
          />
        ))}
      </ol>
      {edgeOptions.length > 0 && (
        <section className="tour-next" aria-label="Siguiente paso">
          {end && next.length > 0 && (
            <>
              <p className="panel-help">
                {next.length === 1 ? 'Continúa' : `${next.length} continuaciones posibles`} desde «
                {nodeTitle(nodes[end], items)}»:
              </p>
              <ul className="panel-list tour-continuations">
                {next.map((edge) => {
                  const branch = branchLabel(edge, nodes);
                  return (
                    <li key={edge.id}>
                      <button
                        type="button"
                        className="pixel-button is-ghost"
                        aria-label={`Siguiente paso: ${edgeSummary(edge, nodes, items)}`}
                        onClick={() => addEdgeStep(tourId, edge.id)}
                      >
                        + {branch ? `${branch} → ` : '→ '}
                        {nodeTitle(nodes[edge.to], items)}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {picking && (
            <button
              type="button"
              className="pixel-button"
              aria-pressed={pickingThis}
              onClick={() => picking.onToggle(pickingThis ? null : tourId)}
            >
              {pickingThis ? '■ Terminar de elegir' : '＋ Elegir pasos en el lienzo'}
            </button>
          )}
          <div className="panel-field">
            <label htmlFor={newEdgeId}>Conexión del paso nuevo</label>
            <select id={newEdgeId} value={newEdge || edgeOptions[0]!.edge.id} onChange={(e) => setNewEdge(e.target.value)}>
              {edgeOptions.map(({ edge, text }) => (
                <option key={edge.id} value={edge.id}>
                  {text}
                </option>
              ))}
            </select>
            <button type="button" className="pixel-button" onClick={addConnectionStep}>
              Agregar conexión
            </button>
          </div>
        </section>
      )}
      {nodeOptions.length === 0 ? (
        <p className="panel-help">Agrega nodos al lienzo para armar los pasos.</p>
      ) : (
        <div className="panel-field">
          <label htmlFor={newNodeId}>Nodo del paso nuevo</label>
          <select
            id={newNodeId}
            value={newNode || nodeOptions[0]!.id}
            onChange={(e) => setNewNode(e.target.value)}
          >
            {nodeOptions.map((n) => (
              <option key={n.id} value={n.id}>
                {nodeLabel(n)}
              </option>
            ))}
          </select>
          <button type="button" className="pixel-button" onClick={addNodeStep}>
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
        {flow ? 'Borrar recorrido' : 'Borrar tour'}
      </button>
    </div>
  );
}

function StepEditor({
  tourId,
  index,
  count,
  step,
  issues,
  nodeOptions,
  edgeOptions,
}: {
  tourId: string;
  index: number;
  count: number;
  step: TourStep;
  issues: StepIssue[];
  nodeOptions: Node[];
  edgeOptions: { edge: Edge; text: string }[];
}) {
  const { setStepNode, setStepEdge, updateStepNote, moveStep, removeStep } = useGraphStore((s) => s);
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const { items } = useCanvasCatalog();
  const selectId = useId();
  const n = index + 1;
  const edge = step.edgeId ? edges[step.edgeId] : undefined;
  const removed = step.removedEdge;
  const isEdgeStep = !!step.edgeId || !!removed;
  // Para reemplazar una conexión eliminada, primero las que unen los mismos nodos.
  const sameEnds = removed ? edgeOptions.filter(({ edge: e }) => e.from === removed.from && e.to === removed.to) : [];
  const others = removed ? edgeOptions.filter((o) => !sameEnds.includes(o)) : edgeOptions;
  const branch = edge ? branchLabel(edge, nodes) : undefined;

  return (
    <li
      className="tour-step"
      aria-label={`Paso ${n}`}
      data-kind={isEdgeStep ? 'edge' : 'node'}
      data-removed={removed ? true : undefined}
    >
      {isEdgeStep ? (
        <>
          <p className="tour-step-route">
            <span className="flow-step-number">{n}</span> {stepSummary(step, edges, nodes, items)}
          </p>
          {branch && <p className="panel-help">Rama elegida en la decisión: «{branch}»</p>}
          {issues.map((issue, i) => (
            <p key={i} className="tour-step-issue" role="note">
              {issueText(issue, nodes, edges, items)}
            </p>
          ))}
          <div className="panel-field">
            <label htmlFor={selectId}>{removed ? `Paso ${n}: reemplazar por` : `Paso ${n}: conexión`}</label>
            <select
              id={selectId}
              value={edge?.id ?? ''}
              onChange={(e) => e.target.value && setStepEdge(tourId, index, e.target.value)}
            >
              {removed && <option value="">Elige una conexión…</option>}
              {sameEnds.length > 0 && (
                <optgroup label="Entre los mismos nodos">
                  {sameEnds.map(({ edge: e, text }) => (
                    <option key={e.id} value={e.id}>
                      {text}
                    </option>
                  ))}
                </optgroup>
              )}
              {others.map(({ edge: e, text }) => (
                <option key={e.id} value={e.id}>
                  {text}
                </option>
              ))}
            </select>
          </div>
        </>
      ) : (
        <div className="panel-field">
          <label htmlFor={selectId}>Paso {n}: nodo</label>
          <select id={selectId} value={step.nodeId} onChange={(e) => setStepNode(tourId, index, e.target.value)}>
            {nodeOptions.map((node) => (
              <option key={node.id} value={node.id}>
                {nodeLabel(node)}
              </option>
            ))}
          </select>
        </div>
      )}
      <TextField
        label={isEdgeStep ? `Paso ${n}: descripción` : `Paso ${n}: nota`}
        multiline
        value={step.note ?? ''}
        maxLength={STEP_NOTE_MAX_LENGTH}
        placeholder={isEdgeStep ? 'Qué ocurre en este paso (opcional)' : 'Lo que el guía cuenta en este paso'}
        onChange={(text) => updateStepNote(tourId, index, text)}
      />
      <div className="tour-step-actions">
        <button
          type="button"
          className="pixel-button"
          aria-label={`Subir paso ${n}`}
          disabled={index === 0}
          onClick={() => moveStep(tourId, index, -1)}
        >
          ↑
        </button>
        <button
          type="button"
          className="pixel-button"
          aria-label={`Bajar paso ${n}`}
          disabled={index === count - 1}
          onClick={() => moveStep(tourId, index, 1)}
        >
          ↓
        </button>
        <button type="button" className="pixel-button" aria-label={`Quitar paso ${n}`} onClick={() => removeStep(tourId, index)}>
          Quitar
        </button>
      </div>
    </li>
  );
}

function issueText(
  issue: StepIssue,
  nodes: Record<string, Node>,
  edges: Record<string, Edge>,
  items: ReturnType<typeof useCanvasCatalog>['items'],
): string {
  if (issue.kind === 'removed') return '⚠ La conexión de este paso se eliminó: reemplázala o quita el paso.';
  if (issue.kind === 'jump') {
    return `↯ Salto: el paso anterior termina en «${nodeTitle(nodes[issue.end], items)}» y este empieza en «${nodeTitle(
      nodes[issue.start],
      items,
    )}».`;
  }
  const request = edges[issue.requestId];
  return `⚠ Esta respuesta va antes de su solicitud${request ? ` (${edgeSummary(request, nodes, items)})` : ''}.`;
}

function nodeLabel(node: Node): string {
  return `${NODE_LABELS[node.type].label}: ${node.title}`;
}
