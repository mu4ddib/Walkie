import { BaseEdge, EdgeLabelRenderer, Position, getSmoothStepPath, type Edge as FlowEdge, type EdgeProps } from '@xyflow/react';
import type { Port, Side } from '../edges/ports';
import { polylinePath, type Point } from '../edges/route';

export type MapFlowEdge = FlowEdge<{
  /** `portal`: una feature lleva a otra; `uses`: una feature usa un componente compartido. */
  variant: 'portal' | 'uses';
  label?: string;
  ports?: { source: Port; target: Port };
  route?: Point[];
}>;

const SIDE: Record<Side, Position> = { top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left };

/** Flecha del mapa: se dibuja desde sus puertos y esquiva las cajas, como en el lienzo (spec puertos-de-conexion). */
export function MapEdge({ id, data, selected, ...props }: EdgeProps<MapFlowEdge>) {
  const ports = data?.ports;
  const [stepPath, stepX, stepY] = getSmoothStepPath({
    sourceX: ports?.source.x ?? props.sourceX,
    sourceY: ports?.source.y ?? props.sourceY,
    targetX: ports?.target.x ?? props.targetX,
    targetY: ports?.target.y ?? props.targetY,
    sourcePosition: ports ? SIDE[ports.source.side] : props.sourcePosition,
    targetPosition: ports ? SIDE[ports.target.side] : props.targetPosition,
    borderRadius: 0,
  });
  const routed = data?.route ? polylinePath(data.route) : null;
  const path = routed?.d ?? stepPath;
  const portal = data?.variant !== 'uses';

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        className={`map-edge map-edge-${data?.variant ?? 'portal'}`}
        markerEnd={portal ? `url(#walkie-arrow-open${selected ? '-selected' : ''})` : undefined}
        interactionWidth={28}
      />
      {portal && data?.label && (
        <EdgeLabelRenderer>
          <div
            className="kind-edge-label map-edge-label nodrag nopan"
            data-selected={selected || undefined}
            data-edge-id={id}
            style={{
              transform: `translate(-50%, -50%) translate(${routed?.labelX ?? stepX}px, ${routed?.labelY ?? stepY}px)`,
            }}
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
