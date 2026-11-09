import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ApiError, type CatalogItem, type CatalogItemType, type Feature } from '../api/client';
import {
  useApp,
  useCatalog,
  useCatalogItem,
  useCatalogUsages,
  useCreateCatalogItem,
  useDeleteCatalogItem,
  useUpdateCatalogItem,
} from '../api/hooks';
import { NODE_LABELS } from '../nodes/nodeMeta';
import { HTTP_METHODS, TEXT_MAX_LENGTH, TITLE_MAX_LENGTH, type HttpMethod } from '../store/graphStore';
import { normalizeDatabase, normalizeHttp } from '../contracts/contracts';
import { ApiContractEditor } from '../panel/contract/ApiContractEditor';
import { DatabaseEditor } from '../panel/contract/DatabaseEditor';
import '../panel/panel.css';
import { QueryState } from '../ui/QueryState';
import { CATALOG_TYPES, catalogPath } from './catalogPaths';

/**
 * Catálogo de una app (spec catalogo, criterios 1 a 5): lista agrupada por tipo, crear, y el detalle
 * de un elemento (`/apps/:appId/catalog/:itemId`) para editarlo, ver dónde se usa y borrarlo.
 */
export function CatalogPage() {
  const { appId = '', itemId } = useParams();
  const app = useApp(appId);
  const catalog = useCatalog(appId);

  if (!app.data) {
    return (
      <section className="page">
        <Breadcrumb appId={appId} />
        <QueryState isPending={app.isPending} error={app.error} notFound="Esta app no existe." />
      </section>
    );
  }

  return (
    <section className="page catalog-page">
      <Breadcrumb appId={appId} appName={app.data.name} />
      <h2>Catálogo de {app.data.name}</h2>
      <div className="catalog-layout">
        <div>
          <CreateItemForm appId={appId} />
          <QueryState isPending={catalog.isPending} error={catalog.error} notFound="Esta app no existe." />
          {catalog.data && catalog.data.length === 0 && <p>El catálogo está vacío. Crea el primer elemento.</p>}
          {catalog.data &&
            CATALOG_TYPES.map((type) => (
              <ItemGroup
                key={type}
                appId={appId}
                type={type}
                items={catalog.data.filter((i) => i.type === type)}
                selectedId={itemId}
              />
            ))}
        </div>
        {itemId && <ItemDetail key={itemId} appId={appId} itemId={itemId} />}
      </div>
    </section>
  );
}

function ItemGroup({
  appId,
  type,
  items,
  selectedId,
}: {
  appId: string;
  type: CatalogItemType;
  items: CatalogItem[];
  selectedId?: string;
}) {
  if (items.length === 0) return null;
  const meta = NODE_LABELS[type];
  return (
    <section className="catalog-group" aria-label={meta.label}>
      <h3>
        <span aria-hidden="true">{meta.glyph}</span> {meta.label}
      </h3>
      <ul className="item-list">
        {items.map((item) => (
          <li key={item.id}>
            <Link to={catalogPath(appId, item.id)} aria-current={item.id === selectedId ? 'page' : undefined}>
              {item.title}
            </Link>
            {item.http && (item.http.method || item.http.path) && (
              <span className="catalog-http"> {[item.http.method, item.http.path].filter(Boolean).join(' ')}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function CreateItemForm({ appId }: { appId: string }) {
  const create = useCreateCatalogItem(appId);
  const navigate = useNavigate();
  const [type, setType] = useState<CatalogItemType>('api');
  const [title, setTitle] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const clean = title.trim();
    if (clean.length === 0) {
      setLocalError('El título es obligatorio.');
      return;
    }
    setLocalError(null);
    try {
      const item = await create.mutateAsync({ type, title: clean });
      setTitle('');
      void navigate(catalogPath(appId, item.id));
    } catch {
      // El error llega por `create.error`.
    }
  }

  const message = localError ?? errorMessage(create.error);

  return (
    <form className="name-form catalog-form" aria-label="Nuevo elemento" onSubmit={(e) => void handleSubmit(e)}>
      <label>
        Tipo
        <select value={type} onChange={(e) => setType(e.target.value as CatalogItemType)}>
          {CATALOG_TYPES.map((t) => (
            <option key={t} value={t}>
              {NODE_LABELS[t].label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Título
        <input value={title} maxLength={TITLE_MAX_LENGTH} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <button type="submit" className="pixel-button" disabled={create.isPending}>
        Crear elemento
      </button>
      {message && <p role="alert">{message}</p>}
    </form>
  );
}

function ItemDetail({ appId, itemId }: { appId: string; itemId: string }) {
  const item = useCatalogItem(itemId);
  // La mutación vive aquí y no en el formulario: el formulario se monta de nuevo con cada versión.
  const update = useUpdateCatalogItem(appId, itemId);

  return (
    <aside className="catalog-detail" aria-label="Detalle del elemento">
      <QueryState isPending={item.isPending} error={item.error} notFound="Este elemento no existe." />
      {item.data && (
        <>
          <ItemEditor
            key={item.data.version}
            item={item.data}
            update={update}
            onReload={() => {
              update.reset();
              void item.refetch();
            }}
          />
          <Usages appId={appId} itemId={itemId} />
          <DeleteItem appId={appId} itemId={itemId} />
        </>
      )}
    </aside>
  );
}

/** Formulario de edición. Se monta de nuevo con cada versión (`key`), así recargar trae los datos del servidor. */
function ItemEditor({
  item,
  update,
  onReload,
}: {
  item: CatalogItem;
  update: ReturnType<typeof useUpdateCatalogItem>;
  onReload: () => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description ?? '');
  const [method, setMethod] = useState<HttpMethod | ''>(item.http?.method ?? '');
  const [path, setPath] = useState(item.http?.path ?? '');
  const [contract, setContract] = useState(item.http);
  const [database, setDatabase] = useState(item.database);
  const meta = NODE_LABELS[item.type];
  const conflict = update.error instanceof ApiError && update.error.status === 409;

  function save(event: FormEvent) {
    event.preventDefault();
    update.mutate({
      title: title.trim(),
      description: description.trim() || undefined,
      http: item.type === 'api' ? normalizeHttp({ ...contract, method: method || undefined, path }) : undefined,
      database: item.type === 'database' ? normalizeDatabase(database) : undefined,
      version: item.version,
    });
  }

  return (
    <form className="catalog-editor" onSubmit={save}>
      <h3>
        <span aria-hidden="true">{meta.glyph}</span> {meta.label}
      </h3>
      <label>
        Título
        <input value={title} maxLength={TITLE_MAX_LENGTH} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        Descripción
        <textarea
          rows={4}
          value={description}
          maxLength={TEXT_MAX_LENGTH}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      {item.type === 'api' && (
        <>
          <label>
            Método
            <select value={method} onChange={(e) => setMethod(e.target.value as HttpMethod | '')}>
              <option value="">—</option>
              {HTTP_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label>
            Ruta HTTP
            <input
              value={path}
              maxLength={TEXT_MAX_LENGTH}
              placeholder="/clientes/{id}"
              onChange={(e) => setPath(e.target.value)}
            />
          </label>
        </>
      )}
      {item.type === 'api' && <ApiContractEditor value={contract} onChange={setContract} />}
      {item.type === 'database' && <DatabaseEditor value={database} onChange={setDatabase} />}
      <div className="catalog-actions">
        <button type="submit" className="pixel-button" disabled={update.isPending}>
          Guardar
        </button>
        <span role="status" className="save-status">
          {update.isSuccess ? 'Guardado' : ''}
        </span>
      </div>
      {conflict ? (
        <div role="alertdialog" aria-labelledby="catalog-conflict" className="conflict-dialog">
          <p id="catalog-conflict">Otra persona guardó este elemento antes. Recarga para ver su versión.</p>
          <button type="button" className="pixel-button" onClick={onReload}>
            Recargar versión del servidor
          </button>
        </div>
      ) : (
        update.error && <p role="alert">{errorMessage(update.error)}</p>
      )}
    </form>
  );
}

function Usages({ appId, itemId }: { appId: string; itemId: string }) {
  const usages = useCatalogUsages(itemId);
  return (
    <section className="catalog-usages" aria-label="Usado en">
      <h4>Usado en</h4>
      <QueryState isPending={usages.isPending} error={usages.error} notFound="Este elemento no existe." />
      {usages.data && usages.data.length === 0 && <p>No se usa en ningún lienzo.</p>}
      {usages.data && usages.data.length > 0 && <FeatureLinks appId={appId} features={usages.data} />}
    </section>
  );
}

function DeleteItem({ appId, itemId }: { appId: string; itemId: string }) {
  const remove = useDeleteCatalogItem(appId, itemId);
  const navigate = useNavigate();
  const inUse =
    remove.error instanceof ApiError && remove.error.status === 409
      ? ((remove.error.problem?.features as Feature[] | undefined) ?? [])
      : null;

  async function handleDelete() {
    try {
      await remove.mutateAsync();
      void navigate(catalogPath(appId));
    } catch {
      // El error llega por `remove.error`.
    }
  }

  return (
    <div className="catalog-delete">
      <button type="button" className="pixel-button" disabled={remove.isPending} onClick={() => void handleDelete()}>
        Borrar elemento
      </button>
      {inUse ? (
        <div role="alert">
          <p>No se puede borrar: se usa en estos lienzos. Quita sus nodos del catálogo primero.</p>
          <FeatureLinks appId={appId} features={inUse} />
        </div>
      ) : (
        remove.error && <p role="alert">{errorMessage(remove.error)}</p>
      )}
    </div>
  );
}

function FeatureLinks({ appId, features }: { appId: string; features: Feature[] }) {
  return (
    <ul className="item-list">
      {features.map((f) => (
        <li key={f.id}>
          <Link to={`/apps/${appId}/features/${f.id}`}>{f.name}</Link>
        </li>
      ))}
    </ul>
  );
}

function Breadcrumb({ appId, appName }: { appId: string; appName?: string }) {
  return (
    <nav className="breadcrumb" aria-label="Ruta">
      <Link to="/apps">Apps</Link>
      {appName && (
        <>
          {' / '}
          <Link to={`/apps/${appId}`}>{appName}</Link>
          {' / '}
          <Link to={catalogPath(appId)}>Catálogo</Link>
        </>
      )}
    </nav>
  );
}

function errorMessage(error: unknown): string | null {
  if (!error) return null;
  return error instanceof ApiError ? error.userMessage : 'No se pudo guardar. Revisa la conexión con la API.';
}
