import { Handle, Position, type Node as FlowNode, type NodeProps } from '@xyflow/react';
import { NODE_LABELS } from '../nodes/nodeMeta';
import type { NodeType } from '../store/graphStore';

export type CatalogMapFlowNode = FlowNode<{ title: string; type: NodeType; users: number }, 'catalog'>;

/** Componente del catálogo que comparten varias features (spec mapa-de-la-app). */
export function CatalogMapNode({ data, selected }: NodeProps<CatalogMapFlowNode>) {
  const meta = NODE_LABELS[data.type];
  return (
    <div className="map-catalog" data-type={data.type} data-selected={selected || undefined}>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <span className="map-catalog-kind">
        <span aria-hidden="true">{meta.glyph}</span> {meta.label} · componente
      </span>
      <strong className="map-catalog-title">{data.title}</strong>
      <span className="map-catalog-users">Lo usan {data.users} features</span>
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
}
