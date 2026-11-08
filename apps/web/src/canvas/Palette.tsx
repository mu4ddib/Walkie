import { useId, useMemo, useState, type CSSProperties, type DragEvent } from 'react';
import { Link } from 'react-router';
import type { CatalogItem } from '../api/client';
import { NODE_LABELS } from '../nodes/nodeMeta';
import { catalogPath } from '../pages/catalogPaths';
import { PALETTE_MIME, PALETTE_REF_MIME, PALETTE_TYPES } from './paletteTypes';
import type { NodeType } from '../store/graphStore';
import { nodeColors } from '../theme/palette';

interface PaletteProps {
  onAdd: (type: NodeType) => void;
  /** Panel "Componentes" (catálogo de la app); sin él la barra solo trae los tipos. */
  catalog?: { appId: string; items: CatalogItem[]; onAddRef: (item: CatalogItem) => void };
}

/**
 * Barra de herramientas flotante del lienzo (spec espacio-de-trabajo, criterio 4): un botón por tipo
 * (clic lo pone en el centro, arrastre donde lo sueltes, teclas 1–7) y el panel "Componentes" con
 * el catálogo compartido de la app.
 */
export function Palette({ onAdd, catalog }: PaletteProps) {
  const [componentsOpen, setComponentsOpen] = useState(false);
  const panelId = useId();

  function onDragStart(event: DragEvent, mime: string, value: string) {
    event.dataTransfer.setData(mime, value);
    event.dataTransfer.effectAllowed = 'move';
  }

  return (
    <div className="toolbar-dock">
      <nav className="palette toolbar floating" aria-label="Herramientas">
        {PALETTE_TYPES.map((type, i) => (
          <button
            key={type}
            type="button"
            className="toolbar-tool"
            aria-label={NODE_LABELS[type].label}
            aria-keyshortcuts={String(i + 1)}
            data-tip={`${NODE_LABELS[type].label} · ${i + 1}`}
            draggable
            onDragStart={(e) => onDragStart(e, PALETTE_MIME, type)}
            onClick={() => onAdd(type)}
            style={{ '--node-color': nodeColors[type] } as CSSProperties}
          >
            <span className="toolbar-glyph" aria-hidden="true">
              {NODE_LABELS[type].glyph}
            </span>
            <span className="toolbar-key" aria-hidden="true">
              {i + 1}
            </span>
          </button>
        ))}
        {catalog && (
          <>
            <span className="toolbar-separator" aria-hidden="true" />
            <button
              type="button"
              className="toolbar-tool toolbar-components"
              aria-label="Componentes"
              aria-expanded={componentsOpen}
              aria-controls={panelId}
              data-tip="Componentes del catálogo"
              onClick={() => setComponentsOpen((open) => !open)}
            >
              <span className="toolbar-glyph" aria-hidden="true">
                ◇
              </span>
            </button>
          </>
        )}
      </nav>
      {catalog && componentsOpen && (
        <ComponentsPanel
          id={panelId}
          catalog={catalog}
          onClose={() => setComponentsOpen(false)}
          onDragStart={(e, item) => onDragStart(e, PALETTE_REF_MIME, item.id)}
        />
      )}
    </div>
  );
}

function ComponentsPanel({
  id,
  catalog,
  onClose,
  onDragStart,
}: {
  id: string;
  catalog: NonNullable<PaletteProps['catalog']>;
  onClose: () => void;
  onDragStart: (event: DragEvent, item: CatalogItem) => void;
}) {
  const [query, setQuery] = useState('');
  const searchId = useId();
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? catalog.items.filter((i) => i.title.toLowerCase().includes(q)) : catalog.items;
  }, [catalog.items, query]);

  return (
    <section id={id} className="components-panel floating" aria-label="Catálogo">
      <header className="components-header">
        <h3>Componentes</h3>
        <button type="button" className="pixel-button is-ghost icon-button" aria-label="Cerrar panel" onClick={onClose}>
          ✕
        </button>
      </header>
      <p className="components-help">
        APIs, servicios y bases de datos compartidos por todos los lienzos de la app. Arrástralos o haz clic para usarlos.
      </p>
      {catalog.items.length > 0 && (
        <>
          <label className="sr-only" htmlFor={searchId}>
            Buscar componentes
          </label>
          <input
            id={searchId}
            type="search"
            placeholder="Buscar…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </>
      )}
      {catalog.items.length === 0 ? (
        <p className="components-empty">
          Aún no hay componentes. <Link to={catalogPath(catalog.appId)}>Crea APIs, servicios y BD en el catálogo</Link>.
        </p>
      ) : (
        <div className="components-list">
          {shown.map((item) => (
            <button
              key={item.id}
              type="button"
              className="component-item"
              draggable
              onDragStart={(e) => onDragStart(e, item)}
              onClick={() => catalog.onAddRef(item)}
              style={{ '--node-color': nodeColors[item.type] } as CSSProperties}
            >
              <span className="component-kind" aria-hidden="true">
                {NODE_LABELS[item.type].glyph}
              </span>
              <span className="component-title">{item.title}</span>
            </button>
          ))}
          {shown.length === 0 && <p className="components-empty">Nada coincide con “{query}”.</p>}
        </div>
      )}
      <Link className="components-link" to={catalogPath(catalog.appId)}>
        Abrir el catálogo
      </Link>
    </section>
  );
}
