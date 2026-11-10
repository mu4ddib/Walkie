import { useId, useMemo, useState, type CSSProperties, type DragEvent, type FormEvent } from 'react';
import { Link } from 'react-router';
import { ApiError, type CatalogItem, type CatalogItemType, type NewCatalogItem } from '../api/client';
import { NODE_LABELS } from '../nodes/nodeMeta';
import { CATALOG_TYPES, catalogPath } from '../pages/catalogPaths';
import { PALETTE_MIME, PALETTE_REF_MIME, PALETTE_TYPES } from './paletteTypes';
import type { NodeType } from '../store/graphStore';
import { nodeColors } from '../theme/palette';

interface PaletteProps {
  onAdd: (type: NodeType) => void;
  /** "Grupo" (tecla G): rodea las cajas seleccionadas o crea uno vacío. */
  onAddGroup?: () => void;
  /** "Nota" (tecla N): una nota adhesiva en el centro, lista para escribir. */
  onAddNote?: () => void;
  /** Panel "Componentes" (catálogo de la app); sin él la barra solo trae los tipos. */
  catalog?: {
    appId: string;
    items: CatalogItem[];
    onAddRef: (item: CatalogItem) => void;
    /** Crea el componente y lo pone en el lienzo; sin él, el panel no ofrece crear. */
    onCreate?: (item: NewCatalogItem) => Promise<void>;
  };
}

/**
 * Barra de herramientas flotante del lienzo (spec espacio-de-trabajo, criterio 4): un botón por tipo
 * (clic lo pone en el centro, arrastre donde lo sueltes, teclas 1–7) y el panel "Componentes" con
 * el catálogo compartido de la app.
 */
export function Palette({ onAdd, onAddGroup, onAddNote, catalog }: PaletteProps) {
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
        {onAddGroup && (
          <button
            type="button"
            className="toolbar-tool toolbar-group"
            aria-label="Grupo"
            aria-keyshortcuts="G"
            data-tip="Grupo (rodea lo seleccionado) · G"
            onClick={onAddGroup}
          >
            <span className="toolbar-glyph" aria-hidden="true">
              ⬚
            </span>
            <span className="toolbar-key" aria-hidden="true">
              G
            </span>
          </button>
        )}
        {onAddNote && (
          <button
            type="button"
            className="toolbar-tool toolbar-note"
            aria-label="Nota adhesiva"
            aria-keyshortcuts="N"
            data-tip="Nota adhesiva (anotación) · N"
            onClick={onAddNote}
          >
            <span className="toolbar-glyph" aria-hidden="true">
              ▤
            </span>
            <span className="toolbar-key" aria-hidden="true">
              N
            </span>
          </button>
        )}
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
  const [type, setType] = useState<CatalogItemType | null>(null);
  const searchId = useId();
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.items.filter((i) => (!type || i.type === type) && (!q || i.title.toLowerCase().includes(q)));
  }, [catalog.items, query, type]);

  return (
    <section id={id} className="components-panel floating" aria-label="Catálogo">
      <header className="components-header">
        <h3>Componentes</h3>
        <button type="button" className="pixel-button is-ghost icon-button" aria-label="Cerrar panel" onClick={onClose}>
          ✕
        </button>
      </header>
      <p className="components-help">
        APIs, servicios y bases de datos compartidos por todos los lienzos de la app: si cambias su definición, cambia
        en todos. Arrástralos o haz clic para usarlos.
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
          <div className="components-filter" role="group" aria-label="Filtrar por tipo">
            <button type="button" aria-pressed={type === null} onClick={() => setType(null)}>
              Todos
            </button>
            {CATALOG_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={type === t}
                onClick={() => setType(type === t ? null : t)}
                style={{ '--node-color': nodeColors[t] } as CSSProperties}
              >
                {NODE_LABELS[t].label}
              </button>
            ))}
          </div>
        </>
      )}
      {catalog.items.length === 0 ? (
        <p className="components-empty">
          Aún no hay componentes.{' '}
          {catalog.onCreate ? 'Crea el primero aquí abajo o ' : ''}
          <Link to={catalogPath(catalog.appId)}>crea APIs, servicios y BD en el catálogo</Link>.
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
          {shown.length === 0 && <p className="components-empty">Nada coincide con el filtro.</p>}
        </div>
      )}
      {catalog.onCreate && <NewComponent onCreate={catalog.onCreate} />}
      <Link className="components-link" to={catalogPath(catalog.appId)}>
        Abrir el catálogo
      </Link>
    </section>
  );
}

/** "Nuevo componente" sin salir del lienzo (spec espacio-de-trabajo, criterio 10): se crea y queda en el lienzo. */
function NewComponent({ onCreate }: { onCreate: (item: NewCatalogItem) => Promise<void> }) {
  const [type, setType] = useState<CatalogItemType>('api');
  const [title, setTitle] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const typeId = useId();
  const titleId = useId();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) {
      setError('El título es obligatorio.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onCreate({ type, title: title.trim() });
      setTitle('');
    } catch (e) {
      setError(e instanceof ApiError ? e.userMessage : 'No se pudo crear el componente.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="components-new" aria-label="Nuevo componente" onSubmit={(e) => void submit(e)}>
      <h4>Nuevo componente</h4>
      <div className="components-new-row">
        <label className="sr-only" htmlFor={typeId}>
          Tipo de componente
        </label>
        <select id={typeId} value={type} onChange={(e) => setType(e.target.value as CatalogItemType)} disabled={pending}>
          {CATALOG_TYPES.map((t) => (
            <option key={t} value={t}>
              {NODE_LABELS[t].label}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor={titleId}>
          Título del componente
        </label>
        <input
          id={titleId}
          value={title}
          maxLength={120}
          placeholder="Título"
          onChange={(e) => setTitle(e.target.value)}
          disabled={pending}
        />
      </div>
      <button type="submit" className="pixel-button" disabled={pending}>
        Crear y agregar
      </button>
      {error && (
        <p role="alert" className="components-error">
          {error}
        </p>
      )}
    </form>
  );
}
