import type { CSSProperties, DragEvent } from 'react';
import { NODE_LABELS } from '../nodes/nodeMeta';
import { PALETTE_MIME, PALETTE_TYPES } from './paletteTypes';
import type { NodeType } from '../store/graphStore';
import { nodeColors } from '../theme/palette';

/** Paleta lateral: arrastra un tipo al lienzo, o haz clic para ponerlo en el centro. */
export function Palette({ onAdd }: { onAdd: (type: NodeType) => void }) {
  function onDragStart(event: DragEvent, type: NodeType) {
    event.dataTransfer.setData(PALETTE_MIME, type);
    event.dataTransfer.effectAllowed = 'move';
  }

  return (
    <aside className="palette" aria-label="Paleta de nodos">
      <h3>Nodos</h3>
      {PALETTE_TYPES.map((type) => (
        <button
          key={type}
          type="button"
          className="palette-item"
          draggable
          onDragStart={(e) => onDragStart(e, type)}
          onClick={() => onAdd(type)}
          style={{ '--node-color': nodeColors[type] } as CSSProperties}
        >
          <span aria-hidden="true">{NODE_LABELS[type].glyph}</span> {NODE_LABELS[type].label}
        </button>
      ))}
      <p className="palette-hint">Arrastra al lienzo. Une nodos desde el punto derecho. Doble clic edita el título; Supr borra.</p>
    </aside>
  );
}
