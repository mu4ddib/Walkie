import type { CSSProperties, DragEvent } from 'react';
import { Link } from 'react-router';
import type { CatalogItem } from '../api/client';
import { NODE_LABELS } from '../nodes/nodeMeta';
import { catalogPath } from '../pages/catalogPaths';
import { PALETTE_MIME, PALETTE_REF_MIME, PALETTE_TYPES } from './paletteTypes';
import type { NodeType } from '../store/graphStore';
import { nodeColors } from '../theme/palette';

interface PaletteProps {
  onAdd: (type: NodeType) => void;
  /** Sección "Catálogo" (spec catalogo, criterio 6); sin ella la paleta solo trae los tipos. */
  catalog?: { appId: string; items: CatalogItem[]; onAddRef: (item: CatalogItem) => void };
}

/** Paleta lateral: arrastra un tipo o un elemento del catálogo al lienzo, o haz clic para ponerlo en el centro. */
export function Palette({ onAdd, catalog }: PaletteProps) {
  function onDragStart(event: DragEvent, mime: string, value: string) {
    event.dataTransfer.setData(mime, value);
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
          onDragStart={(e) => onDragStart(e, PALETTE_MIME, type)}
          onClick={() => onAdd(type)}
          style={{ '--node-color': nodeColors[type] } as CSSProperties}
        >
          <span aria-hidden="true">{NODE_LABELS[type].glyph}</span> {NODE_LABELS[type].label}
        </button>
      ))}
      {catalog && (
        <section className="palette-catalog" aria-label="Catálogo">
          <h3>Catálogo</h3>
          {catalog.items.length === 0 && (
            <p className="palette-hint">
              Sin elementos. <Link to={catalogPath(catalog.appId)}>Crea APIs, servicios y BD en el catálogo</Link>.
            </p>
          )}
          {catalog.items.map((item) => (
            <button
              key={item.id}
              type="button"
              className="palette-item palette-ref"
              draggable
              onDragStart={(e) => onDragStart(e, PALETTE_REF_MIME, item.id)}
              onClick={() => catalog.onAddRef(item)}
              style={{ '--node-color': nodeColors[item.type] } as CSSProperties}
            >
              <span aria-hidden="true">{NODE_LABELS[item.type].glyph}</span> {item.title}
            </button>
          ))}
        </section>
      )}
      <p className="palette-hint">
        Arrastra al lienzo. Une nodos desde el punto derecho. Doble clic edita el título; Supr borra.
      </p>
    </aside>
  );
}
