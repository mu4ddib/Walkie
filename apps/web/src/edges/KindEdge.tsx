import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type Edge as FlowEdge, type EdgeProps } from '@xyflow/react';
import type { EdgeKind } from '../store/graphStore';
import { useGraphStore } from '../store/useGraphStore';
import { KIND_LABELS, SELECTABLE_KINDS } from './edgeMeta';

export type WalkieFlowEdge = FlowEdge<{ kind: EdgeKind; label?: string; when?: string }>;

/**
 * Conexión en escalones (pixel) con su tipo, su etiqueta y su condición (`[200]`);
 * seleccionada, permite cambiar el tipo.
 */
export function KindEdge({ id, data, selected, ...props }: EdgeProps<WalkieFlowEdge>) {
  const setEdgeKind = useGraphStore((s) => s.setEdgeKind);
  const kind = data?.kind ?? 'uses';
  const [path, labelX, labelY] = getSmoothStepPath({ ...props, borderRadius: 0 });
  const kinds = SELECTABLE_KINDS.includes(kind) ? SELECTABLE_KINDS : [kind, ...SELECTABLE_KINDS];

  return (
    <>
      <BaseEdge id={id} path={path} className={`kind-edge kind-${kind}`} />
      <EdgeLabelRenderer>
        <div
          className="kind-edge-label nodrag nopan"
          data-selected={selected || undefined}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          {selected ? (
            <select
              aria-label="Tipo de conexión"
              value={kind}
              onChange={(e) => setEdgeKind(id, e.target.value as EdgeKind)}
            >
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]} ({k})
                </option>
              ))}
            </select>
          ) : (
            KIND_LABELS[kind]
          )}
          {data?.label && <span className="kind-edge-text"> · {data.label}</span>}
          {data?.when && <span className="kind-edge-when"> [{data.when}]</span>}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
