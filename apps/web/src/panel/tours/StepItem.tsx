import { useEffect, useId, useRef, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { useCanvasCatalog } from '../../catalog/catalogContext';
import { NODE_LABELS } from '../../nodes/nodeMeta';
import type { Edge, Node } from '../../schema/walkie-graph';
import { STEP_NOTE_MAX_LENGTH } from '../../store/graphStore';
import { useGraphStore } from '../../store/useGraphStore';
import type { StepIssue, TourStep } from '../../tours/flows';
import { branchLabel, edgeSummary, nodeTitle } from '../../tours/flowText';
import { TextField } from '../TextField';
import { ActionMenu, type MenuAction } from './ActionMenu';
import { issueShort, notePreview, stepHeading } from './toursUi';

export interface StepItemProps {
  /** Clave del paso en la lista (para medir su alto). */
  itemKey: string;
  tourId: string;
  index: number;
  count: number;
  step: TourStep;
  /** Paso de conexión (recorrido) o de nodo (tour). */
  flow: boolean;
  issues: StepIssue[];
  open: boolean;
  onToggle: () => void;
  /** Enfocar el primer campo al abrirse (paso recién creado o insertado). */
  focusOnOpen: boolean;
  onFocused: () => void;
  nodeOptions: Node[];
  edgeOptions: { edge: Edge; text: string }[];
  /** Acciones del menú (subir, bajar, insertar, duplicar, quitar…), las arma la lista. */
  actions: MenuAction[];
  onLocate?: () => void;
  /** Reproducción: solo el encabezado, resaltado si es el paso activo; un clic salta a él. */
  playback?: { active: boolean; onJump: () => void };
  /** Solo lectura (enlace compartido): se abre para leer la nota; sin asa, menú ni campos. */
  readOnly?: boolean;
  /** Total de pasos cuando la lista solo dibuja una parte (para lectores de pantalla). */
  setSize?: number;
  /** Algo entre el encabezado y el cuerpo (ej. elegir a qué tour moverlo). */
  extra?: ReactNode;
  drag: {
    onStart: (e: DragEvent) => void;
    onEnd: () => void;
    onOver: (e: DragEvent<HTMLLIElement>) => void;
    onDrop: (e: DragEvent<HTMLLIElement>) => void;
    /** Indicador de dónde caería el paso arrastrado. */
    drop: 'before' | 'after' | null;
    dragging: boolean;
    /** Teclado en el asa: ↑ ↓ mueven el paso. */
    onKey: (e: KeyboardEvent<HTMLElement>) => void;
  };
}

/**
 * Un paso como acordeón (spec tours-compactos). El encabezado se lee sin abrirlo: número, icono, nodo o resumen de la
 * conexión, su tipo y una vista previa de la nota (o el aviso, si hay). Tres zonas que no se confunden: el asa (⠿)
 * arrastra, el cuerpo del encabezado abre y cierra, «⋯» abre las acciones. Abierto: el elemento, la nota (que crece
 * con lo escrito) y «Localizar en lienzo». Lo escrito va al store en cada tecla, así cerrar nunca pierde nada.
 */
export function StepItem(props: StepItemProps) {
  const { index, step, flow, issues, open, onToggle, focusOnOpen, onFocused, playback, drag, readOnly } = props;
  // Sin asa ni menú: reproduciendo o en un enlace de solo lectura.
  const bare = !!playback || !!readOnly;
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const { items } = useCanvasCatalog();
  const bodyId = useId();
  const titleId = useId();
  const body = useRef<HTMLDivElement>(null);
  const n = index + 1;
  const heading = stepHeading(step, nodes, edges, items);
  const issue = issues[0];
  const preview = issue ? issueShort(issue, nodes, items) : notePreview(step.note);

  // Paso recién creado: se abre y enfoca su primer campo.
  useEffect(() => {
    if (!open || !focusOnOpen) return;
    body.current?.querySelector<HTMLElement>('select, textarea, input')?.focus();
    onFocused();
  }, [open, focusOnOpen, onFocused]);

  const toggle = (
    <button
      type="button"
      className="tour-step-toggle"
      aria-expanded={playback ? undefined : open}
      aria-controls={playback ? undefined : bodyId}
      aria-current={playback?.active ? 'step' : undefined}
      onClick={playback ? playback.onJump : onToggle}
      title={`${heading.title}${step.note ? `\n${step.note}` : ''}`}
    >
      <span className="tour-step-number" aria-hidden="true">
        {n}
      </span>
      <span className="tour-step-glyph" aria-hidden="true">
        {heading.glyph}
      </span>
      <span className="tour-step-text">
        <span className="tour-step-title" id={titleId}>
          {heading.title}
        </span>
        {/* Visualmente son dos líneas; para un lector de pantalla, dos frases. */}
        <span className="sr-only">. </span>
        <span className="tour-step-meta" data-issue={issue ? true : undefined}>
          <span className="tour-step-kind">{heading.kind}</span>
          {preview && <span className="tour-step-preview"> · {preview}</span>}
        </span>
      </span>
      {!playback && (
        <span className="tour-step-chevron" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      )}
    </button>
  );

  return (
    <li
      className="tour-step"
      aria-label={`Paso ${n}`}
      data-kind={flow ? 'edge' : 'node'}
      data-open={open || undefined}
      data-active={playback?.active || undefined}
      data-missing={heading.missing || undefined}
      data-drop={drag.drop ?? undefined}
      data-dragging={drag.dragging || undefined}
      data-step-key={props.itemKey}
      data-index={index}
      aria-setsize={props.setSize}
      aria-posinset={props.setSize ? n : undefined}
      onDragOver={bare ? undefined : drag.onOver}
      onDrop={bare ? undefined : drag.onDrop}
    >
      <div className="tour-step-head">
        {!bare && (
          // Un <span> y no un <button>: Chromium no empieza a arrastrar desde un botón (`draggable` no tiene efecto).
          <span
            role="button"
            tabIndex={0}
            className="tour-step-grip"
            draggable
            data-grip={step.id}
            aria-label={`Mover paso ${n} (arrastra, o usa ↑ ↓)`}
            title="Arrastra para reordenar (o ↑ ↓ con el foco aquí)"
            onDragStart={drag.onStart}
            onDragEnd={drag.onEnd}
            onKeyDown={drag.onKey}
          >
            ⠿
          </span>
        )}
        {toggle}
        {!bare && <ActionMenu label={`Acciones del paso ${n}`} actions={props.actions} describedBy={titleId} />}
      </div>
      {props.extra}
      {open && !playback && (
        <div className="tour-step-body" id={bodyId} ref={body}>
          {readOnly ? (
            <p className="tour-step-note">{step.note || 'Este paso no tiene nota.'}</p>
          ) : (
            <StepFields {...props} />
          )}
          <div className="tour-step-tools">
            {props.onLocate && !heading.missing && (
              <button type="button" className="pixel-button is-ghost" onClick={props.onLocate}>
                ⌖ Localizar en lienzo
              </button>
            )}
            {/* Un paso roto se resuelve aquí mismo: reemplazar arriba, o quitarlo. */}
            {heading.missing && !readOnly && (
              <button
                type="button"
                className="pixel-button"
                onClick={props.actions.find((a) => a.danger)?.onSelect}
              >
                Quitar paso
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

/** Campos del paso abierto: el elemento (nodo o conexión), avisos y la nota. */
function StepFields({ tourId, index, step, flow, issues, nodeOptions, edgeOptions }: StepItemProps) {
  const { setStepNode, setStepEdge, updateStepNote, setStepFlags } = useGraphStore((s) => s);
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const { items } = useCanvasCatalog();
  const selectId = useId();
  const n = index + 1;
  const edge = step.edgeId ? edges[step.edgeId] : undefined;
  const removed = step.removedEdge;
  const branch = edge ? branchLabel(edge, nodes) : undefined;
  // Para reemplazar una conexión eliminada, primero las que unen los mismos nodos.
  const sameEnds = removed ? edgeOptions.filter(({ edge: e }) => e.from === removed.from && e.to === removed.to) : [];
  const others = removed ? edgeOptions.filter((o) => !sameEnds.includes(o)) : edgeOptions;
  const legacyNode = flow && !!step.nodeId;

  return (
    <>
      {issues.map((issue, i) => (
        <p key={i} className="tour-step-issue" role="note">
          {issueText(issue, nodes, edges, items)}
        </p>
      ))}
      {legacyNode ? (
        <p className="tour-step-issue" role="note">
          Un recorrido solo recorre conexiones: este paso de nodo viene de antes. Quítalo o pásalo a un tour.
        </p>
      ) : flow ? (
        <>
          {branch && <p className="panel-help">Rama elegida en la decisión: «{branch}»</p>}
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
          <select
            id={selectId}
            value={step.nodeId && nodes[step.nodeId] ? step.nodeId : ''}
            onChange={(e) => e.target.value && setStepNode(tourId, index, e.target.value)}
          >
            {!(step.nodeId && nodes[step.nodeId]) && <option value="">Elige un nodo…</option>}
            {nodeOptions.map((node) => (
              <option key={node.id} value={node.id}>
                {`${NODE_LABELS[node.type].label}: ${node.title}`}
              </option>
            ))}
          </select>
        </div>
      )}
      <TextField
        label={flow ? `Paso ${n}: descripción` : `Paso ${n}: nota`}
        multiline
        autoGrow
        value={step.note ?? ''}
        maxLength={STEP_NOTE_MAX_LENGTH}
        placeholder={flow ? 'Qué ocurre en este paso (opcional)' : 'Lo que el guía cuenta en este paso'}
        onChange={(text) => updateStepNote(tourId, index, text)}
      />
      {flow && step.edgeId && (
        // Fan-out y desenlaces (spec interacciones): ocurre a la vez que el anterior, o quien espera no recibe retorno.
        <div className="tour-step-flags">
          {index > 0 && (
            <label className="contract-check">
              <input
                type="checkbox"
                checked={!!step.parallel}
                onChange={(e) => setStepFlags(tourId, index, { parallel: e.target.checked })}
              />
              A la vez que el paso anterior
            </label>
          )}
          <label className="contract-check">
            <input
              type="checkbox"
              checked={!!step.timeout}
              onChange={(e) => setStepFlags(tourId, index, { timeout: e.target.checked })}
            />
            Termina en timeout (no llega respuesta)
          </label>
        </div>
      )}
    </>
  );
}

function issueText(
  issue: StepIssue,
  nodes: Record<string, Node>,
  edges: Record<string, Edge>,
  items: ReturnType<typeof useCanvasCatalog>['items'],
): string {
  if (issue.kind === 'removed') return '⚠ La conexión de este paso se eliminó: reemplázala o quita el paso. La nota se conserva.';
  if (issue.kind === 'jump') {
    return `↯ Salto: el paso anterior termina en «${nodeTitle(nodes[issue.end], items)}» y este empieza en «${nodeTitle(
      nodes[issue.start],
      items,
    )}».`;
  }
  const request = edges[issue.requestId];
  return `⚠ Esta respuesta va antes de su solicitud${request ? ` (${edgeSummary(request, nodes, items)})` : ''}.`;
}
