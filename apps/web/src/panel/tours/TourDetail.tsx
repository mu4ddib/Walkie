import { useCallback, useContext, useId, useMemo, useState } from 'react';
import { useCanvasCatalog } from '../../catalog/catalogContext';
import { NODE_LABELS } from '../../nodes/nodeMeta';
import { TOUR_NAME_MAX_LENGTH } from '../../store/graphStore';
import { GraphStoreContext } from '../../store/graphStoreContext';
import { useGraphStore } from '../../store/useGraphStore';
import { continuations, lastEnd, stepEnds, suggestOrder, type TourKind, type TourStep } from '../../tours/flows';
import { branchLabel, edgeSummary, nodeTitle } from '../../tours/flowText';
import { TextField } from '../TextField';
import { ActionMenu } from './ActionMenu';
import { StepList } from './StepList';

export interface TourDetailProps {
  tourId: string;
  kind: TourKind;
  onBack: () => void;
  onPlay?: (tourId: string) => void;
  /** Tour recién creado: su nombre se enfoca para escribirlo. */
  focusName: boolean;
  /** Pasos abiertos (estado de interfaz) y cómo cambiarlos. */
  open: readonly string[];
  onOpen: (next: string[]) => void;
  onLocate?: (step: TourStep) => void;
  /** Agregar pasos tocando conexiones en el lienzo (solo recorridos). */
  picking?: { tourId: string | null; onToggle: (tourId: string | null) => void };
  /** Reproducción en curso: lista de solo lectura con el paso activo. */
  playback?: { step: number; onJump: (step: number) => void };
  /** Duplicar el tour abre la copia. */
  onOpenTour: (tourId: string) => void;
  /** Solo lectura (enlace compartido): leer, localizar y reproducir; nada se edita. */
  readOnly?: boolean;
}

/**
 * Detalle de un tour o recorrido (spec tours-compactos): cabecera fija (volver, nombre, pasos, reproducir y «⋯»), los
 * pasos como acordeones y, fija abajo, la forma de agregar el siguiente. Un tour agrega nodos; un recorrido, conexiones
 * (con las continuaciones del último nodo, la lista o tocándolas en el lienzo).
 */
export function TourDetail(props: TourDetailProps) {
  const { tourId, kind, onBack, onPlay, focusName, open, onOpen, playback, readOnly } = props;
  // Sin edición: reproduciendo o en un enlace de solo lectura.
  const still = !!playback || !!readOnly;
  const tour = useGraphStore((s) => s.tours[tourId]);
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const { renameTour, removeTour, duplicateTour, addStep, addEdgeStep, insertStep, reorderSteps } = useGraphStore((s) => s);
  const { items } = useCanvasCatalog();
  const store = useContext(GraphStoreContext);
  const flow = kind === 'flow';
  const [focusId, setFocusId] = useState<string | null>(null);
  const [newNode, setNewNode] = useState('');
  const [newEdge, setNewEdge] = useState('');
  const addId = useId();
  const nodeOptions = useMemo(() => Object.values(nodes).sort((a, b) => a.title.localeCompare(b.title, 'es')), [nodes]);
  const edgeOptions = useMemo(
    () =>
      Object.values(edges)
        .map((edge) => ({ edge, text: edgeSummary(edge, nodes, items) }))
        .sort((a, b) => a.text.localeCompare(b.text, 'es')),
    [edges, nodes, items],
  );
  const onFocused = useCallback(() => setFocusId(null), []);
  if (!tour) return null;

  const word = flow ? 'recorrido' : 'tour';
  const count = tour.steps.length;
  /** Un paso recién creado: abierto (solo él) y con el foco en su primer campo. */
  const created = (id: string) => {
    onOpen([id]);
    setFocusId(id);
  };

  // Insertar después de un paso: en un recorrido, la conexión que continúa desde ese paso (si hay).
  const insertAfter = (index: number): string | null => {
    if (!flow) {
      const nodeId = tour.steps[index]?.nodeId ?? nodeOptions[0]?.id;
      return nodeId ? insertStep(tourId, index + 1, { nodeId }) : null;
    }
    const ends = stepEnds(tour.steps[index]!, edges);
    const edgeId = (ends && continuations(edges, ends.to)[0]?.id) ?? edgeOptions[0]?.edge.id;
    return edgeId ? insertStep(tourId, index + 1, { edgeId }) : null;
  };

  const addAtEnd = (add: () => number | null) => {
    const index = add();
    // El store ya tiene el paso: su id se lee del estado recién cambiado.
    const id = index !== null ? store?.getState().tours[tourId]?.steps[index]?.id : undefined;
    if (id) created(id);
  };

  // Orden sugerido (recorridos): con todos los pasos sobre conexiones existentes y una única secuencia posible.
  const edgeIds = tour.steps.map((s) => s.edgeId);
  const allEdges = flow && edgeIds.length > 1 && edgeIds.every((id): id is string => !!id && !!edges[id]);
  const suggested = allEdges ? suggestOrder(edgeIds, edges) : null;
  const inOrder = suggested !== null && suggested.every((id, i) => id === edgeIds[i]);
  const applySuggested = () => {
    if (!suggested) return;
    const left = tour.steps.map((_, i) => i);
    const order = suggested.map((id) => {
      const at = left.findIndex((i) => tour.steps[i]!.edgeId === id);
      return left.splice(at, 1)[0]!;
    });
    reorderSteps(tourId, order);
  };
  const end = flow ? lastEnd(tour, edges) : null;
  const next = flow ? continuations(edges, end) : [];
  const pickingThis = props.picking?.tourId === tourId;

  return (
    <div className="tour-editor" data-kind={kind}>
      <div className="tour-detail-head">
        {/* En pantallas bajas la cabecera es una fila: los textos de los botones quedan solo para lectores de pantalla. */}
        <button type="button" className="link-button tour-back" onClick={onBack} title={`Volver a ${flow ? 'recorridos' : 'tours'}`}>
          {'← '}<span className="tour-compact-hide">Volver a {flow ? 'recorridos' : 'tours'}</span>
        </button>
        {still ? (
          <p className="tour-detail-name" title={tour.name}>
            {tour.name}
          </p>
        ) : (
          <TextField
            label={flow ? 'Nombre del recorrido' : 'Nombre del tour'}
            labelHidden
            inputClassName="tour-name-input"
            value={tour.name}
            maxLength={TOUR_NAME_MAX_LENGTH}
            autoFocus={focusName}
            validate={(name) => (name.trim() ? null : 'El nombre no puede quedar vacío.')}
            onChange={(name) => renameTour(tourId, name)}
          />
        )}
        <div className="tour-detail-bar">
          <span className="tour-detail-count" role="status">
            {playback ? `Reproduciendo · paso ${playback.step + 1} de ${count}` : count === 1 ? '1 paso' : `${count} pasos`}
          </span>
          {onPlay && !playback && (
            <button
              type="button"
              className={`tour-play ${flow ? 'pixel-button is-primary' : 'pixel-button'}`}
              title={flow ? 'Reproducir recorrido' : 'Ver tour'}
              disabled={flow ? !tour.steps.some((s) => s.edgeId && edges[s.edgeId]) : count === 0}
              onClick={() => onPlay(tourId)}
            >
              {flow ? (
                <>
                  {'▶ '}<span className="tour-compact-hide">Reproducir recorrido</span>
                </>
              ) : (
                <>
                  <span className="tour-compact-icon" aria-hidden="true">
                    ▶
                  </span>
                  <span className="tour-compact-hide">Ver tour</span>
                </>
              )}
            </button>
          )}
          {!still && (
            <ActionMenu
              label={`Acciones del ${word}`}
              actions={[
                {
                  label: `Duplicar ${word}`,
                  onSelect: () => {
                    const copy = duplicateTour(tourId);
                    if (copy) props.onOpenTour(copy);
                  },
                },
                {
                  label: `Eliminar ${word}`,
                  danger: true,
                  onSelect: () => {
                    if (window.confirm(`¿Eliminar «${tour.name}»? Se puede deshacer con Ctrl+Z.`)) {
                      removeTour(tourId);
                      onBack();
                    }
                  },
                },
              ]}
            />
          )}
        </div>
        {!playback && count > 1 && (
          <div className="tour-detail-tools">
            <button type="button" className="link-button" onClick={() => onOpen(tour.steps.flatMap((s) => (s.id ? [s.id] : [])))}>
              Expandir todos
            </button>
            <button type="button" className="link-button" onClick={() => onOpen([])} disabled={open.length === 0}>
              Contraer todos
            </button>
          </div>
        )}
        {allEdges && !still && (
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
              'Hay bifurcaciones, ciclos o pasos sueltos: ordénalos arrastrando o con ↑ ↓.'
            )}
          </p>
        )}
      </div>

      {count === 0 ? (
        <div className="tours-empty tour-detail-empty">
          <p className="panel-help">
            {flow
              ? 'Este recorrido aún no tiene pasos. Agrega la primera conexión abajo o elígela en el lienzo; después se ofrecen las que continúan.'
              : 'Este tour aún no tiene pasos. Elige abajo el primer nodo que el guía presenta.'}
          </p>
        </div>
      ) : (
        <StepList
          tour={tour}
          flow={flow}
          open={open}
          onOpen={onOpen}
          focusId={focusId}
          onFocused={onFocused}
          nodeOptions={nodeOptions}
          edgeOptions={edgeOptions}
          onInsertAfter={insertAfter}
          onCreated={created}
          onLocate={props.onLocate}
          playback={playback}
          readOnly={readOnly}
        />
      )}

      {flow && !still && end && next.length > 0 && (
        <section className="tour-next" aria-label="Siguiente paso">
          <p className="panel-help">
            {next.length === 1 ? 'Continúa' : `${next.length} continuaciones posibles`} desde «{nodeTitle(nodes[end], items)}»:
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
                    onClick={() => addAtEnd(() => addEdgeStep(tourId, edge.id))}
                  >
                    + {branch ? `${branch} → ` : '→ '}
                    {nodeTitle(nodes[edge.to], items)}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {!still && (
        <div className="tour-add" aria-label="Agregar paso" role="group">
          {flow ? (
            edgeOptions.length === 0 ? (
              <p className="panel-help">Conecta nodos en el lienzo para armar los pasos.</p>
            ) : (
              <>
                <div className="tour-add-row">
                  <label htmlFor={addId} className="sr-only">
                    Conexión del paso nuevo
                  </label>
                  <select id={addId} value={newEdge || edgeOptions[0]!.edge.id} onChange={(e) => setNewEdge(e.target.value)}>
                    {edgeOptions.map(({ edge, text }) => (
                      <option key={edge.id} value={edge.id}>
                        {text}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="pixel-button"
                    onClick={() => addAtEnd(() => addEdgeStep(tourId, newEdge || edgeOptions[0]!.edge.id))}
                  >
                    Agregar conexión
                  </button>
                </div>
                {props.picking && (
                  <button
                    type="button"
                    className="pixel-button is-ghost tour-pick"
                    aria-pressed={pickingThis}
                    title={pickingThis ? 'Terminar de elegir' : 'Elegir pasos en el lienzo'}
                    onClick={() => props.picking!.onToggle(pickingThis ? null : tourId)}
                  >
                    {pickingThis ? '■ ' : '＋ '}
                    <span className="tour-compact-hide">{pickingThis ? 'Terminar de elegir' : 'Elegir pasos en el lienzo'}</span>
                  </button>
                )}
              </>
            )
          ) : nodeOptions.length === 0 ? (
            <p className="panel-help">Agrega nodos al lienzo para armar los pasos.</p>
          ) : (
            <div className="tour-add-row">
              <label htmlFor={addId} className="sr-only">
                Nodo del paso nuevo
              </label>
              <select id={addId} value={newNode || nodeOptions[0]!.id} onChange={(e) => setNewNode(e.target.value)}>
                {nodeOptions.map((n) => (
                  <option key={n.id} value={n.id}>
                    {`${NODE_LABELS[n.type].label}: ${n.title}`}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="pixel-button is-primary"
                onClick={() => addAtEnd(() => addStep(tourId, newNode || nodeOptions[0]!.id))}
              >
                Agregar paso
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
