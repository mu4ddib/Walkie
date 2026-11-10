import { useId, useMemo, useState, type FormEvent } from 'react';
import { useCanvasCatalog } from '../catalog/catalogContext';
import { NODE_LABELS } from '../nodes/nodeMeta';
import type { Edge, Node, Tour } from '../schema/walkie-graph';
import { STEP_NOTE_MAX_LENGTH, TOUR_NAME_MAX_LENGTH } from '../store/graphStore';
import { useGraphStore } from '../store/useGraphStore';
import {
  continuations,
  lastEnd,
  stepIssues,
  suggestOrder,
  tourKind,
  type StepIssue,
  type TourKind,
  type TourStep,
} from '../tours/flows';
import { branchLabel, edgeSummary, nodeTitle, stepSummary } from '../tours/flowText';
import { TOUR_KIND_TEXT } from '../tours/tourKinds';
import { TextField } from './TextField';

export interface ToursSectionProps {
  /** Tour o recorrido abierto en el editor (lo guarda el lienzo para no perderlo al seleccionar un nodo). */
  openTourId: string | null;
  onOpen: (tourId: string | null) => void;
  /** Pestaña visible (la guarda el lienzo); sin ella, la sección la recuerda mientras está montada. */
  tab?: TourKind;
  onTab?: (tab: TourKind) => void;
  /** "Ver tour" / "Reproducir recorrido"; sin él, el botón no aparece. */
  onPlay?: (tourId: string) => void;
  /** Recorrido recién creado: su nombre se enfoca para escribirlo. */
  createdTourId?: string | null;
  /** Agregar pasos tocando conexiones en el lienzo (lo atiende el lienzo); sin él, la opción no aparece. */
  picking?: { tourId: string | null; onToggle: (tourId: string | null) => void };
}

/**
 * Tours y recorridos de la feature (spec modo-tour; spec recorridos-y-grupos; spec tours-y-recorridos): con nada
 * seleccionado en el lienzo, dos pestañas con su lista, su alta y su editor. Un tour presenta nodos; un recorrido
 * reproduce conexiones. Todo cambia el grafo por las acciones del store.
 */
export function ToursSection({ openTourId, onOpen, tab, onTab, onPlay, createdTourId, picking }: ToursSectionProps) {
  const tours = useGraphStore((s) => s.tours);
  const edges = useGraphStore((s) => s.edges);
  const [localTab, setLocalTab] = useState<TourKind>('guide');
  const open = openTourId ? tours[openTourId] : undefined;
  // La pestaña sigue al tour abierto; si no hay, la elegida.
  const active: TourKind = open ? tourKind(open) : (tab ?? localTab);
  const select = (next: TourKind) => {
    setLocalTab(next);
    onTab?.(next);
    if (open && tourKind(open) !== next) onOpen(null);
  };
  const close = () => {
    if (open) select(tourKind(open));
    onOpen(null);
  };
  const byKind = (kind: TourKind) =>
    Object.values(tours)
      .filter((t) => tourKind(t) === kind)
      .sort((a, b) => a.name.localeCompare(b.name));
  const list = byKind(active);
  const text = TOUR_KIND_TEXT[active];
  const panelId = useId();

  return (
    <section className="panel-section tours-section" aria-label="Tours y recorridos">
      <div className="tours-tabs" role="tablist" aria-label="Tours y recorridos">
        {(['guide', 'flow'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            role="tab"
            id={`${panelId}-${kind}`}
            aria-selected={active === kind}
            aria-controls={panelId}
            className="tours-tab"
            onClick={() => select(kind)}
          >
            {TOUR_KIND_TEXT[kind].title} <span className="tours-tab-count">{byKind(kind).length}</span>
          </button>
        ))}
      </div>
      <div role="tabpanel" id={panelId} aria-labelledby={`${panelId}-${active}`} className="tours-panel">
        {open ? (
          tourKind(open) === 'flow' ? (
            <FlowEditor
              key={open.id}
              tourId={open.id}
              onClose={close}
              onPlay={onPlay}
              focusName={createdTourId === open.id}
              picking={picking}
            />
          ) : (
            <GuideEditor key={open.id} tourId={open.id} onClose={close} onPlay={onPlay} />
          )
        ) : (
          <>
            <p className="panel-help">{text.help}</p>
            {list.length === 0 ? (
              <p className="panel-help tours-empty">{text.empty}</p>
            ) : (
              <ul className="panel-list tours-list" aria-label={text.title}>
                {list.map((tour) => {
                  const pending = pendingCount(tour, edges);
                  return (
                    <li key={tour.id}>
                      <button type="button" className="link-button" onClick={() => onOpen(tour.id)}>
                        {tour.name}
                      </button>{' '}
                      <span className="panel-help">({tour.steps.length === 1 ? '1 paso' : `${tour.steps.length} pasos`})</span>
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
            )}
            <NewTourForm kind={active} onCreated={onOpen} />
          </>
        )}
      </div>
    </section>
  );
}

/** Pasos cuya conexión se eliminó (los que hay que reemplazar o quitar). */
function pendingCount(tour: Tour, edges: Record<string, Edge>): number {
  return tour.steps.filter((s) => s.removedEdge || (s.edgeId && !edges[s.edgeId])).length;
}

function NewTourForm({ kind, onCreated }: { kind: TourKind; onCreated: (tourId: string) => void }) {
  const addTour = useGraphStore((s) => s.addTour);
  const [name, setName] = useState('');
  const inputId = useId();
  const flow = kind === 'flow';

  function submit(event: FormEvent) {
    event.preventDefault();
    const id = addTour(name, kind);
    if (id) {
      setName('');
      onCreated(id);
    }
  }

  return (
    <form className="panel-field" onSubmit={submit} aria-label={flow ? 'Nuevo recorrido' : 'Nuevo tour'}>
      <label htmlFor={inputId}>{flow ? 'Nombre del recorrido nuevo' : 'Nombre del tour nuevo'}</label>
      <input
        id={inputId}
        type="text"
        value={name}
        maxLength={TOUR_NAME_MAX_LENGTH}
        placeholder={flow ? 'Alta exitosa' : 'Iniciar sesión'}
        onChange={(e) => setName(e.target.value)}
      />
      <button type="submit" className="pixel-button" disabled={!name.trim()}>
        {flow ? 'Nuevo recorrido' : 'Nuevo tour'}
      </button>
    </form>
  );
}

/** Tour guiado: solo pasos de nodo, con su nota. */
function GuideEditor({
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
  const nodeOptions = Object.values(nodes).sort((a, b) => a.title.localeCompare(b.title));
  const [newNode, setNewNode] = useState('');
  const newNodeId = useId();
  if (!tour) return null;

  function addNodeStep() {
    const nodeId = newNode || nodeOptions[0]?.id;
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
        <button type="button" className="pixel-button" disabled={tour.steps.length === 0} onClick={() => onPlay(tourId)}>
          Ver tour
        </button>
      )}
      <ol className="tour-steps" aria-label="Pasos">
        {tour.steps.map((step, index) => (
          <StepEditor
            key={`${index}-${step.nodeId ?? step.edgeId ?? 'removed'}`}
            tourId={tourId}
            index={index}
            count={tour.steps.length}
            step={step}
            issues={[]}
            nodeOptions={nodeOptions}
            edgeOptions={[]}
          />
        ))}
      </ol>
      {nodeOptions.length === 0 ? (
        <p className="panel-help">Agrega nodos al lienzo para armar los pasos.</p>
      ) : (
        <div className="panel-field">
          <label htmlFor={newNodeId}>Nodo del paso nuevo</label>
          <select id={newNodeId} value={newNode || nodeOptions[0]!.id} onChange={(e) => setNewNode(e.target.value)}>
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
        Borrar tour
      </button>
    </div>
  );
}

/** Recorrido: solo pasos de conexión, con continuaciones, elegir en el lienzo, orden sugerido y avisos. */
function FlowEditor({
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
  const { renameTour, removeTour, addEdgeStep, reorderSteps } = useGraphStore((s) => s);
  const { items } = useCanvasCatalog();
  const edgeOptions = useMemo(
    () =>
      Object.values(edges)
        .map((edge) => ({ edge, text: edgeSummary(edge, nodes, items) }))
        .sort((a, b) => a.text.localeCompare(b.text, 'es')),
    [edges, nodes, items],
  );
  const [newEdge, setNewEdge] = useState('');
  const newEdgeId = useId();
  if (!tour) return null;

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

  function addConnectionStep() {
    const edgeId = newEdge || edgeOptions[0]?.edge.id;
    if (edgeId && addEdgeStep(tourId, edgeId) !== null) setNewEdge('');
  }

  return (
    <div className="tour-editor">
      <button type="button" className="link-button" onClick={onClose}>
        ← Todos los recorridos
      </button>
      <TextField
        label="Nombre del recorrido"
        value={tour.name}
        maxLength={TOUR_NAME_MAX_LENGTH}
        autoFocus={focusName}
        validate={(name) => (name.trim() ? null : 'El nombre no puede quedar vacío.')}
        onChange={(name) => renameTour(tourId, name)}
      />
      {onPlay && (
        <button
          type="button"
          className="pixel-button is-primary"
          disabled={!tour.steps.some((s) => s.edgeId && edges[s.edgeId])}
          onClick={() => onPlay(tourId)}
        >
          ▶ Reproducir recorrido
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
      {tour.steps.length === 0 && (
        <p className="panel-help">
          Agrega la primera conexión: elígela en el lienzo o en la lista de abajo. Después se ofrecen las que continúan.
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
            nodeOptions={[]}
            edgeOptions={edgeOptions}
            legacyNode={!!step.nodeId}
          />
        ))}
      </ol>
      {edgeOptions.length === 0 ? (
        <p className="panel-help">Conecta nodos en el lienzo para armar los pasos.</p>
      ) : (
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
      <button
        type="button"
        className="pixel-button"
        onClick={() => {
          removeTour(tourId);
          onClose();
        }}
      >
        Borrar recorrido
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
  legacyNode,
}: {
  tourId: string;
  index: number;
  count: number;
  step: TourStep;
  issues: StepIssue[];
  nodeOptions: Node[];
  edgeOptions: { edge: Edge; text: string }[];
  /** En un recorrido, un paso de nodo (de un lienzo anterior) no se cambia: solo se describe o se quita. */
  legacyNode?: boolean;
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
      ) : legacyNode ? (
        <>
          <p className="tour-step-route">
            <span className="flow-step-number">{n}</span> Paso de nodo: {stepSummary(step, edges, nodes, items)}
          </p>
          <p className="tour-step-issue" role="note">
            Un recorrido solo recorre conexiones: este paso viene de antes. Quítalo o pásalo a un tour.
          </p>
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
