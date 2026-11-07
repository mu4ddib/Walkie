import { useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Handle, Position, type NodeProps, type Node as FlowNode } from '@xyflow/react';
import { refTarget, useCanvasCatalog } from '../catalog/catalogContext';
import type { Node } from '../schema/walkie-graph';
import { TITLE_MAX_LENGTH } from '../store/graphStore';
import { useGraphStore } from '../store/useGraphStore';
import { nodeColors } from '../theme/palette';
import {
  MAX_VISIBLE_EXPRESSION_LINES,
  MAX_VISIBLE_INPUTS,
  expressionLines,
  httpLabel,
  moreLabel,
  preview,
} from './nodeContent';
import { NODE_LABELS } from './nodeMeta';

export type WalkieFlowNode = FlowNode<{
  node: Node;
  /** El lienzo lo activa con `onNodeDoubleClick` (un onDoubleClick propio lo interceptaría el arrastre). */
  editing: boolean;
  onEditDone: () => void;
}>;

/**
 * Caja pixel art común a todos los tipos: borde de 4 px con el color del tipo, título editable
 * y un resumen del contenido (descripción, `MÉTODO /ruta`, inputs, expresión). El detalle, en el panel.
 */
export function PixelNode({ id, data, selected }: NodeProps<WalkieFlowNode>) {
  const { node, editing, onEditDone } = data;
  const { items } = useCanvasCatalog();
  // Un `ref` se ve como su elemento del catálogo, con los datos actuales (spec catalogo, criterio 7).
  const target = refTarget(node, items);
  const shown: Node = target
    ? { ...node, type: target.type, title: target.title, description: target.description, http: target.http }
    : node;
  const missing = node.type === 'ref' && !target;
  const meta = NODE_LABELS[shown.type];

  return (
    <div
      className="pixel-node"
      data-type={node.type}
      data-ref={node.type === 'ref' ? (missing ? 'missing' : 'ok') : undefined}
      data-selected={selected || undefined}
      style={{ '--node-color': nodeColors[shown.type] } as CSSProperties}
    >
      <Handle type="target" position={Position.Left} />
      <div className="pixel-node-kind">
        <span aria-hidden="true">{meta.glyph}</span> {missing ? 'Elemento no encontrado' : meta.label}
        {target && <span className="pixel-node-badge">catálogo</span>}
      </div>
      {editing ? (
        <TitleInput id={id} title={node.title} onDone={onEditDone} />
      ) : (
        <div className="pixel-node-title" title={node.type === 'ref' ? undefined : 'Doble clic para editar'}>
          {shown.title}
        </div>
      )}
      <NodeContent node={shown} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function NodeContent({ node }: { node: Node }) {
  const http = httpLabel(node.http);
  const inputs = preview(node.inputs ?? [], MAX_VISIBLE_INPUTS);
  const lines = preview(expressionLines(node.expression), MAX_VISIBLE_EXPRESSION_LINES);

  return (
    <>
      {http && <div className="pixel-node-http">{http}</div>}
      {node.description && <p className="pixel-node-description">{node.description}</p>}
      {inputs.shown.length > 0 && (
        <ul className="pixel-node-list" aria-label="Inputs">
          {inputs.shown.map((input) => (
            <li key={input.name}>
              {input.name}
              {input.required && <span title="Obligatorio">*</span>}
              <span className="pixel-node-muted"> : {input.type}</span>
            </li>
          ))}
          {inputs.more > 0 && <li className="pixel-node-muted">{moreLabel(inputs.more)}</li>}
        </ul>
      )}
      {lines.shown.length > 0 && (
        <div className="pixel-node-expression" aria-label="Expresión">
          {lines.shown.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
          {lines.more > 0 && <div className="pixel-node-muted">{moreLabel(lines.more)}</div>}
        </div>
      )}
    </>
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
