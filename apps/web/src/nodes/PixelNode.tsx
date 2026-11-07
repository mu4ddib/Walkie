import { useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Handle, Position, type NodeProps, type Node as FlowNode } from '@xyflow/react';
import type { Node } from '../schema/walkie-graph';
import { TITLE_MAX_LENGTH } from '../store/graphStore';
import { useGraphStore } from '../store/useGraphStore';
import { nodeColors } from '../theme/palette';
import { NODE_LABELS } from './nodeMeta';

export type WalkieFlowNode = FlowNode<{
  node: Node;
  /** El lienzo lo activa con `onNodeDoubleClick` (un onDoubleClick propio lo interceptaría el arrastre). */
  editing: boolean;
  onEditDone: () => void;
}>;


/** Caja pixel art común a todos los tipos: borde de 4 px con el color del tipo, título editable. */
export function PixelNode({ id, data, selected }: NodeProps<WalkieFlowNode>) {
  const { node, editing, onEditDone } = data;
  const meta = NODE_LABELS[node.type];

  return (
    <div
      className="pixel-node"
      data-type={node.type}
      data-selected={selected || undefined}
      style={{ '--node-color': nodeColors[node.type] } as CSSProperties}
    >
      <Handle type="target" position={Position.Left} />
      <div className="pixel-node-kind">
        <span aria-hidden="true">{meta.glyph}</span> {meta.label}
      </div>
      {editing ? (
        <TitleInput id={id} title={node.title} onDone={onEditDone} />
      ) : (
        <div className="pixel-node-title" title="Doble clic para editar">
          {node.title}
        </div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

/** Campo del título: Enter o salir del campo confirma; Escape cancela. */
function TitleInput({ id, title, onDone }: { id: string; title: string; onDone: () => void }) {
  const renameNode = useGraphStore((s) => s.renameNode);
  const [draft, setDraft] = useState(title);

  function commit() {
    renameNode(id, draft);
    onDone();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') commit();
    if (event.key === 'Escape') onDone();
  }

  return (
    <input
      className="pixel-node-input nodrag"
      aria-label="Título del nodo"
      autoFocus
      value={draft}
      maxLength={TITLE_MAX_LENGTH}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={commit}
    />
  );
}
