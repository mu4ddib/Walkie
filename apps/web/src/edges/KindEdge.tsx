import { BaseEdge, EdgeLabelRenderer, Position, getSmoothStepPath, type Edge as FlowEdge, type EdgeProps } from '@xyflow/react';
import type { EdgeKind } from '../store/graphStore';
import { OPERATIONS, OPERATION_IDS, type OperationId } from '../interactions/operations';
import {
  KIND_STYLES,
  edgeDisplay,
  edgeDisplayText,
  statusTone,
  type EdgeDisplay,
} from './edgeMeta';
import type { Port, Side } from './ports';
import { polylinePath, type Point } from './route';
import { useSetOperation } from './useChangeEdgeKind';

const SIDE_POSITION: Record<Side, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};

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
  /** Camino que esquiva cajas (spec puertos-de-conexion, tarea 4); sin él, el escalón de siempre. */
  route?: Point[];
  /**
   * Centro de la etiqueta cuando la coloca `Canvas` (conexiones de un mismo par en carriles: spec
   * conexiones-ida-y-vuelta); `joined` la une a las del par en una etiqueta compuesta.
   */
  labelAt?: { x: number; y: number; joined?: 'start' | 'middle' | 'end' };
  /** y en la que dobla el trazo (conexiones que comparten un lado de arriba o de abajo). */
  bendY?: number;
  /**
   * Puertos (spec puertos-de-conexion): desde qué punto y lado sale y a cuál llega. Sin `source` (rama de una
   * decisión), sale del punto de su salida.
   */
  ports?: { source?: Port; target: Port };
  /** Paso en una previsualización (1 = ida, 2 = vuelta…) o pasos de un recorrido que la usan ("2·5"). */
  step?: string;
  /**
   * Operación de la conexión seleccionada (spec interacciones): la efectiva y las sugeridas para el par, para el
   * selector de la etiqueta. Sin ella (retornos, ramas, no seleccionada) la etiqueta es solo texto.
   */
  operation?: { id: OperationId; explicit: boolean; suggested: OperationId[] };
}>;

/**
 * Conexión en escalones (pixel) con su tipo, su etiqueta, su código y su condición (`[saldo > 0]`); seleccionada,
 * permite cambiar el tipo. Cada tipo tiene su trazo y su punta; un pulso (`kind-edge-flow`) recorre el sentido al
 * seleccionarla, al pasar por encima, en una previsualización o en el paso de un tour.
 */
export function KindEdge({ id, data, selected, ...props }: EdgeProps<WalkieFlowEdge>) {
  const setOperation = useSetOperation();
  const kind = data?.kind ?? 'uses';
  const display = data?.display ?? edgeDisplay({ kind, label: data?.label, when: data?.when });
  const ports = data?.ports;
  // Con puertos, cada conexión ya tiene su punto: no hacen falta carriles ni rodeos.
  const lane = ports ? 0 : (data?.laneOffset ?? 0);
  const backward = ports ? undefined : data?.backward;
  const sourceX = ports?.source ? ports.source.x : backward ? backward.sourceX : props.sourceX;
  const targetX = ports ? ports.target.x : backward ? backward.targetX : props.targetX;
  const sourceY = (ports?.source ? ports.source.y : props.sourceY) + lane;
  const targetY = (ports ? ports.target.y : props.targetY) + lane;
  // Cada carril dobla en su propia x: el de fuera de la esquina dobla más lejos y los tramos no se pisan.
  const leftY = backward ? targetY : sourceY;
  const rightY = backward ? sourceY : targetY;
  const centerX = (sourceX + targetX) / 2 - lane * Math.sign(rightY - leftY);
  const [stepPath, stepLabelX, stepLabelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition: ports?.source ? SIDE_POSITION[ports.source.side] : backward ? Position.Left : props.sourcePosition,
    targetPosition: ports ? SIDE_POSITION[ports.target.side] : backward ? Position.Right : props.targetPosition,
    borderRadius: 0,
    centerX: data?.bendX ?? (lane === 0 ? undefined : centerX),
    centerY: data?.bendY,
  });
  // Si hay que esquivar cajas, el trazo es el camino calculado y la etiqueta va a mitad de su largo.
  const routed = data?.route ? polylinePath(data.route) : null;
  const path = routed?.d ?? stepPath;
  const placed = data?.labelAt;
  const labelX = placed?.x ?? routed?.labelX ?? stepLabelX;
  const labelY = placed?.y ?? routed?.labelY ?? stepLabelY;
  const operation = data?.operation;
  const others = operation ? OPERATION_IDS.filter((op) => !operation.suggested.includes(op)) : [];
  const offset = placed ? 0 : (data?.labelOffset ?? 0);

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
          title={`${edgeDisplayText(display)} — ${KIND_STYLES[kind].description}`}
          data-selected={selected || undefined}
          data-branch={display.branch || undefined}
          data-edge-id={id}
          data-joined={placed?.joined}
          data-error={display.error}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY + offset}px)` }}
        >
          {data?.step !== undefined && (
            <span className="kind-edge-step" aria-label={`Paso ${data.step}`}>
              {data.step}
            </span>
          )}
          {selected && !display.branch && operation ? (
            <select
              aria-label="Operación de la conexión"
              value={operation.explicit ? operation.id : ''}
              onChange={(e) => e.target.value && setOperation(id, e.target.value as OperationId)}
            >
              {!operation.explicit && <option value="">{display.main} (por el tipo)</option>}
              {operation.suggested.map((op) => (
                <option key={op} value={op}>
                  {OPERATIONS[op].verb}
                </option>
              ))}
              <optgroup label="Otras">
                {others.map((op) => (
                  <option key={op} value={op}>
                    {OPERATIONS[op].name}
                  </option>
                ))}
              </optgroup>
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
