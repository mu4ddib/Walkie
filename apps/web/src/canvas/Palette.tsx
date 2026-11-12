import { useCallback, useId, useMemo, useRef, useState, type CSSProperties, type DragEvent, type FormEvent } from 'react';
import { Link } from 'react-router';
import { ApiError, type CatalogItem, type CatalogItemType, type NewCatalogItem } from '../api/client';
import { NODE_LABELS, nodeLabel } from '../nodes/nodeMeta';
import { CATALOG_TYPES, catalogPath } from '../pages/catalogPaths';
import { PALETTE_MIME, PALETTE_REF_MIME, PALETTE_TYPES, RESOURCE_KEY } from './paletteTypes';
import { ResourcePicker } from './ResourcePicker';
import { RESOURCE_KINDS, normalizeResource, type ResourceKind } from '../nodes/resourceMeta';
import type { NodeType } from '../store/graphStore';
import { nodeColors } from '../theme/palette';

interface PaletteProps {
  onAdd: (type: NodeType) => void;
  /** "Grupo" (tecla G): rodea las cajas seleccionadas o crea uno vacío. */
  onAddGroup?: () => void;
  /** "Nota" (tecla N): una nota adhesiva en el centro, lista para escribir. */
  onAddNote?: () => void;
  /** "Recurso" (tecla 8): la lista de subtipos, abierta o no (la abre también el lienzo con la tecla). */
  resources?: { open: boolean; onOpenChange: (open: boolean) => void; onPick: (kind: ResourceKind) => void };
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
export function Palette({ onAdd, onAddGroup, onAddNote, resources, catalog }: PaletteProps) {
  const [componentsOpen, setComponentsOpen] = useState(false);
  const panelId = useId();
  const resourcesId = useId();
  const resourceButton = useRef<HTMLButtonElement>(null);
  const onResourcesOpenChange = resources?.onOpenChange;
  const closeResources = useCallback(
    (refocus: boolean) => {
      onResourcesOpenChange?.(false);
      if (refocus) resourceButton.current?.focus();
    },
    [onResourcesOpenChange],
  );
  // Un panel a la vez junto a la barra.
  const showComponents = componentsOpen && !resources?.open;

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
        {resources && (
          <button
            ref={resourceButton}
            type="button"
            className="toolbar-tool"
            aria-label="Recurso"
            aria-haspopup="menu"
            aria-expanded={resources.open}
            aria-controls={resources.open ? resourcesId : undefined}
            aria-keyshortcuts={RESOURCE_KEY}
            data-tip={`Recurso: bucket, función, cola… · ${RESOURCE_KEY}`}
            data-resource-trigger
            onClick={() => resources.onOpenChange(!resources.open)}
            style={{ '--node-color': nodeColors.resource } as CSSProperties}
          >
            <span className="toolbar-glyph" aria-hidden="true">
              {NODE_LABELS.resource.glyph}
            </span>
            <span className="toolbar-key" aria-hidden="true">
              {RESOURCE_KEY}
            </span>
          </button>
        )}
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
              aria-expanded={showComponents}
              aria-controls={panelId}
              data-tip="Componentes del catálogo"
              onClick={() => {
                setComponentsOpen((open) => !open);
                resources?.onOpenChange(false);
              }}
            >
              <span className="toolbar-glyph" aria-hidden="true">
                ◇
              </span>
            </button>
          </>
        )}
      </nav>
      {resources?.open && (
        <ResourcePicker
          id={resourcesId}
          onPick={(kind) => {
            resources.onPick(kind);
            resources.onOpenChange(false);
          }}
          onClose={closeResources}
        />
      )}
      {catalog && showComponents && (
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
        APIs, servicios, bases de datos y recursos compartidos por todos los lienzos de la app: si cambias su
        definición, cambia en todos. Arrástralos o haz clic para usarlos.
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
          <Link to={catalogPath(catalog.appId)}>crea APIs, servicios, BD y recursos en el catálogo</Link>.
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
              <span className="component-kind" aria-hidden="true" title={nodeLabel(item).label}>
                {nodeLabel(item).glyph}
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
  const [kind, setKind] = useState<ResourceKind>('storage');
  const [title, setTitle] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const typeId = useId();
  const kindId = useId();
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
      await onCreate({ type, title: title.trim(), resource: type === 'resource' ? normalizeResource({ kind }) : undefined });
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
        {type === 'resource' && (
          <>
            <label className="sr-only" htmlFor={kindId}>
              Subtipo del recurso
            </label>
            <select id={kindId} value={kind} onChange={(e) => setKind(e.target.value as ResourceKind)} disabled={pending}>
              {RESOURCE_KINDS.map((k) => (
                <option key={k.kind} value={k.kind}>
                  {k.label}
                </option>
              ))}
            </select>
          </>
        )}
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
