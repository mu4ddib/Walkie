import { Handle, NodeResizer, Position, type Node as FlowNode, type NodeProps } from '@xyflow/react';
import type { CSSProperties } from 'react';
import type { Group } from '../schema/walkie-graph';
import { GROUP_MIN } from '../store/graphStore';
import { GROUP_COLORS, GROUP_LABELS } from './groupMeta';

export type GroupFlowNode = FlowNode<
  {
    group: Group;
    /** Nodos que contiene. */
    count: number;
    /** Plegar o desplegar; sin él (solo lectura) no hay botón. */
    onToggle?: () => void;
    /** Se puede redimensionar (no en solo lectura); los cambios llegan a `Canvas` por `onNodesChange`. */
    resizable: boolean;
  },
  'infraGroup'
>;

/**
 * Grupo de infraestructura (spec espacio-de-trabajo, criterios 18 y 19): un límite con nombre detrás de sus nodos.
 * Plegado es una caja compacta con el nombre y cuántos nodos tiene, y sus conexiones llegan a ella.
 */
export function GroupNode({ data, selected }: NodeProps<GroupFlowNode>) {
  const { group, count, onToggle, resizable } = data;
  const collapsed = !!group.collapsed;
  const label = GROUP_LABELS[group.kind];

  return (
    <div
      className="group-node"
      data-collapsed={collapsed || undefined}
      data-selected={selected || undefined}
      style={{ '--group-color': GROUP_COLORS[group.kind] } as CSSProperties}
    >
      {!collapsed && resizable && (
        <NodeResizer isVisible={selected} minWidth={GROUP_MIN.w} minHeight={GROUP_MIN.h} color={GROUP_COLORS[group.kind]} />
      )}
      {/* Plegado, las conexiones de sus nodos llegan aquí; no se conecta a mano a un grupo. */}
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="group-node-header">
        <span className="group-node-kind">{label}</span>
        <span className="group-node-title">{group.title}</span>
        <span className="group-node-count">{count === 1 ? '1 nodo' : `${count} nodos`}</span>
        {onToggle && (
          <button
            type="button"
            className="group-node-toggle nodrag"
            aria-label={`${collapsed ? 'Desplegar' : 'Plegar'} grupo ${group.title}`}
            aria-expanded={!collapsed}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
          >
            {collapsed ? '▸' : '▾'}
          </button>
        )}
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}
