import { BaseEdge, EdgeLabelRenderer, Position, getSmoothStepPath, type Edge as FlowEdge, type EdgeProps } from '@xyflow/react';
import type { EdgeKind } from '../store/graphStore';
import {
  KIND_LABELS,
  KIND_STYLES,
  SELECTABLE_KINDS,
  edgeDisplay,
  edgeDisplayText,
  statusTone,
  type EdgeDisplay,
} from './edgeMeta';
import { useChangeEdgeKind } from './useChangeEdgeKind';

/** Ancho (px) del área invisible que recibe los clics alrededor del trazo. */
const EDGE_HIT_WIDTH = 28;

export type WalkieFlowEdge = FlowEdge<{
  kind: EdgeKind;
  label?: string;
  when?: string;
  /** Lo que muestra la etiqueta (lo arma `Canvas` con la salida de decisión, el endpoint y el código). */
  display?: EdgeDisplay;
  /** Desplazamiento vertical de la etiqueta cuando varias conexiones unen el mismo par (que no se tapen). */
  labelOffset?: number;
  /** Desplazamiento del trazo (px) cuando varias conexiones unen el mismo par: cada una va por su carril. */
  laneOffset?: number;
  /**
   * El destino queda a la izquierda del origen: el trazo sale por el lado izquierdo del origen (`sourceX`) y
   * entra por el derecho del destino (`targetX`), en vez de rodear las cajas.
   */
  backward?: { sourceX: number; targetX: number };
  /** x en la que dobla el trazo (ramas de una decisión: cada una en la suya). */
  bendX?: number;
  /** Paso en una previsualización (1 = ida, 2 = vuelta…) o pasos de un recorrido que la usan ("2·5"). */
  step?: string;
}>;

/**
 * Conexión en escalones (pixel) con su tipo, su etiqueta, su código y su condición (`[saldo > 0]`); seleccionada,
 * permite cambiar el tipo. Cada tipo tiene su trazo y su punta; un pulso (`kind-edge-flow`) recorre el sentido al
 * seleccionarla, al pasar por encima, en una previsualización o en el paso de un tour.
 */
export function KindEdge({ id, data, selected, ...props }: EdgeProps<WalkieFlowEdge>) {
  const changeKind = useChangeEdgeKind();
  const kind = data?.kind ?? 'uses';
  const display = data?.display ?? edgeDisplay({ kind, label: data?.label, when: data?.when });
  const lane = data?.laneOffset ?? 0;
  const backward = data?.backward;
  const sourceX = backward ? backward.sourceX : props.sourceX;
  const targetX = backward ? backward.targetX : props.targetX;
  const sourceY = props.sourceY + lane;
  const targetY = props.targetY + lane;
  // Cada carril dobla en su propia x: el de fuera de la esquina dobla más lejos y los tramos no se pisan.
  const leftY = backward ? targetY : sourceY;
  const rightY = backward ? sourceY : targetY;
  const centerX = (sourceX + targetX) / 2 - lane * Math.sign(rightY - leftY);
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition: backward ? Position.Left : props.sourcePosition,
    targetPosition: backward ? Position.Right : props.targetPosition,
    borderRadius: 0,
    centerX: data?.bendX ?? (lane === 0 ? undefined : centerX),
  });
  const kinds = SELECTABLE_KINDS.includes(kind) ? SELECTABLE_KINDS : [kind, ...SELECTABLE_KINDS];
  const offset = data?.labelOffset ?? 0;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        className={`kind-edge kind-${kind}${display.branch ? ' is-branch' : ''}`}
        markerEnd={display.marker === 'none' ? undefined : `url(#walkie-arrow-${display.marker}${selected ? '-selected' : ''})`}
        // Área cómoda para tocar el trazo (también con Mayús + clic, al sumar conexiones a un recorrido).
        interactionWidth={EDGE_HIT_WIDTH}
      />
      {/* Pulso direccional: `pathLength` normaliza el largo para que el pulso recorra del origen al destino. */}
      <path d={path} pathLength={100} className="kind-edge-flow-halo" fill="none" aria-hidden="true" />
      <path d={path} pathLength={100} className="kind-edge-flow" fill="none" aria-hidden="true" />
      <EdgeLabelRenderer>
        <div
          className="kind-edge-label nodrag nopan"
          title={`${edgeDisplayText(display)} — ${KIND_LABELS[kind]}: ${KIND_STYLES[kind].description}`}
          data-selected={selected || undefined}
          data-branch={display.branch || undefined}
          data-edge-id={id}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY + offset}px)` }}
        >
          {data?.step !== undefined && (
            <span className="kind-edge-step" aria-label={`Paso ${data.step}`}>
              {data.step}
            </span>
          )}
          {selected && !display.branch ? (
            <select aria-label="Tipo de conexión" value={kind} onChange={(e) => changeKind(id, e.target.value as EdgeKind)}>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]} ({k})
                </option>
              ))}
            </select>
          ) : (
            <span className="kind-edge-main">{display.main}</span>
          )}
          {display.code !== undefined && (
            <span className="kind-edge-code" data-tone={statusTone(display.code)}>
              {' '}
              {display.code}
            </span>
          )}
          {display.detail && (
            <span className={display.mono ? 'kind-edge-text is-mono' : 'kind-edge-text'}> · {display.detail}</span>
          )}
          {display.when && <span className="kind-edge-when"> [{display.when}]</span>}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
