import { useId, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { ApiError, type CatalogItem } from '../api/client';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys, refreshAfterWrite, useCatalogUsages, useUpdateCatalogItem } from '../api/hooks';
import { refTarget, useCanvasCatalog } from '../catalog/catalogContext';
import { NODE_LABELS } from '../nodes/nodeMeta';
import { catalogPath } from '../pages/catalogPaths';
import type { Node } from '../schema/walkie-graph';
import { HTTP_METHODS, TEXT_MAX_LENGTH, TITLE_MAX_LENGTH, type HttpMethod } from '../store/graphStore';
import { normalizeDatabase, normalizeHttp } from '../contracts/contracts';
import { ApiContractEditor } from './contract/ApiContractEditor';
import { DatabaseEditor } from './contract/DatabaseEditor';
import { useGraphStore } from '../store/useGraphStore';

/**
 * Inspector de un componente del catálogo (spec espacio-de-trabajo, criterios 11 y 12): separa la
 * "Definición compartida" (se guarda en el catálogo, aparte del lienzo, y avisa en qué lienzos se usa) de
 * "En este lienzo" (sus conexiones aquí y "Crear copia independiente").
 */
export function RefPanel({ node }: { node: Node }) {
  const { appId, items, share } = useCanvasCatalog();
  const item = refTarget(node, items);

  if (!item) {
    return (
      <>
        <h3>
          <span aria-hidden="true">{NODE_LABELS.ref.glyph}</span> Elemento no encontrado
        </h3>
        <p className="panel-help">
          El elemento del catálogo ya no existe. Último título conocido: <strong>{node.title}</strong>. Puedes borrar
          este nodo con Supr.
        </p>
      </>
    );
  }

  const meta = NODE_LABELS[item.type];
  return (
    <>
      <h3>
        <span aria-hidden="true">{meta.glyph}</span> {meta.label} · componente
      </h3>
      <p className="panel-help">
        Este nodo usa un componente del catálogo de la app: su definición es la misma en todos los lienzos que lo usan.
      </p>
      {appId && !share ? (
        <SharedDefinition appId={appId} item={item} />
      ) : (
        <ReadOnlyDefinition item={item} />
      )}
      <InThisCanvas appId={appId} node={node} item={item} />
    </>
  );
}

/** "Definición compartida": la mutación vive aquí; el formulario se monta de nuevo con cada versión. */
function SharedDefinition({ appId, item }: { appId: string; item: CatalogItem }) {
  const update = useUpdateCatalogItem(appId, item.id);
  const queryClient = useQueryClient();
  const reload = () => {
    update.reset();
    void refreshAfterWrite(queryClient, { queryKey: queryKeys.catalog(appId) });
  };
  return (
    <section className="panel-section shared-definition" aria-label="Definición compartida">
      <h4>Definición compartida</h4>
      <DefinitionForm key={item.version} item={item} update={update} onReload={reload} />
    </section>
  );
}

function DefinitionForm({
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
  // Auth, parámetros, request y respuestas (el método y la ruta van arriba, en sus campos).
  const [contract, setContract] = useState(item.http);
  const [database, setDatabase] = useState(item.database);
  const [localError, setLocalError] = useState<string | null>(null);
  const ids = { title: useId(), description: useId(), method: useId(), path: useId() };
  const changed =
    title.trim() !== item.title ||
    description.trim() !== (item.description ?? '') ||
    method !== (item.http?.method ?? '') ||
    path.trim() !== (item.http?.path ?? '') ||
    JSON.stringify(normalizeHttp(httpOf(contract, method, path))) !== JSON.stringify(normalizeHttp(item.http)) ||
    JSON.stringify(normalizeDatabase(database)) !== JSON.stringify(normalizeDatabase(item.database));

  function save(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) {
      setLocalError('El título es obligatorio.');
      return;
    }
    setLocalError(null);
    update.mutate({
      title: title.trim(),
      description: description.trim() || undefined,
      http: item.type === 'api' ? normalizeHttp(httpOf(contract, method, path)) : undefined,
      database: item.type === 'database' ? normalizeDatabase(database) : undefined,
      version: item.version,
    });
  }

  const apiError = update.error instanceof ApiError ? update.error : null;
  const conflict = apiError?.status === 409;
  const message =
    localError ?? (update.error && !conflict ? (apiError?.userMessage ?? 'No se pudo guardar el componente.') : null);

  return (
    <form className="definition-form" onSubmit={save}>
      <div className="panel-field">
        <label htmlFor={ids.title}>Título</label>
        <input id={ids.title} value={title} maxLength={TITLE_MAX_LENGTH} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="panel-field">
        <label htmlFor={ids.description}>Descripción</label>
        <textarea
          id={ids.description}
          rows={3}
          value={description}
          maxLength={TEXT_MAX_LENGTH}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      {item.type === 'api' && (
        <>
          <div className="panel-field">
            <label htmlFor={ids.method}>Método</label>
            <select id={ids.method} value={method} onChange={(e) => setMethod(e.target.value as HttpMethod | '')}>
              <option value="">—</option>
              {HTTP_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className="panel-field">
            <label htmlFor={ids.path}>Ruta HTTP</label>
            <input
              id={ids.path}
              className="mono"
              value={path}
              maxLength={TEXT_MAX_LENGTH}
              placeholder="/clientes/{id}"
              onChange={(e) => setPath(e.target.value)}
            />
          </div>
        </>
      )}
      {item.type === 'api' && <ApiContractEditor value={contract} onChange={setContract} />}
      {item.type === 'database' && <DatabaseEditor value={database} onChange={setDatabase} />}
      <Usages itemId={item.id} />
      <div className="definition-actions">
        <button type="submit" className="pixel-button is-primary" disabled={!changed || update.isPending}>
          Guardar definición
        </button>
        <span role="status" className="definition-status">
          {update.isSuccess && !changed ? 'Definición guardada' : ''}
        </span>
      </div>
      <p className="panel-help">Se guarda en el catálogo al momento, aparte del lienzo.</p>
      {message && (
        <p role="alert" className="panel-error">
          {message}
        </p>
      )}
      {conflict && (
        <div role="alert" className="panel-error">
          <p>Otra persona cambió este componente antes. Carga su versión y vuelve a aplicar tus cambios.</p>
          <button type="button" className="pixel-button" onClick={onReload}>
            Cargar su versión
          </button>
        </div>
      )}
    </form>
  );
}

/** El contrato del editor con el método y la ruta de sus campos. */
function httpOf(contract: CatalogItem['http'], method: HttpMethod | '', path: string): CatalogItem['http'] {
  return { ...contract, method: method || undefined, path };
}

/** "Se usa en N lienzos", con la lista, antes de guardar (criterio 12). Cuenta lo guardado de cada lienzo. */
function Usages({ itemId }: { itemId: string }) {
  const usages = useCatalogUsages(itemId);
  const { featureId } = useCanvasCatalog();
  if (!usages.data) return null;
  const count = usages.data.length;
  return (
    <div className="definition-usages">
      <p>
        {count === 0
          ? 'Aún no se usa en ningún lienzo guardado.'
          : `Se usa en ${count === 1 ? '1 lienzo' : `${count} lienzos`}; un cambio se verá en ${count === 1 ? 'él' : 'todos'}:`}
      </p>
      {count > 0 && (
        <ul aria-label="Lienzos que lo usan">
          {usages.data.map((f) => (
            <li key={f.id}>
              {f.name}
              {f.id === featureId && <span className="definition-current"> (este lienzo)</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReadOnlyDefinition({ item }: { item: CatalogItem }) {
  const http = [item.http?.method, item.http?.path].filter(Boolean).join(' ');
  return (
    <section className="panel-section" aria-label="Definición compartida">
      <h4>Definición compartida</h4>
      <dl className="panel-readonly">
        <dt>Título</dt>
        <dd>{item.title}</dd>
        {item.description && (
          <>
            <dt>Descripción</dt>
            <dd>{item.description}</dd>
          </>
        )}
        {http && (
          <>
            <dt>Método y ruta</dt>
            <dd>{http}</dd>
          </>
        )}
      </dl>
    </section>
  );
}

/** "En este lienzo": lo propio de este uso y la salida a un nodo local. */
function InThisCanvas({ appId, node, item }: { appId: string; node: Node; item: CatalogItem }) {
  const { share } = useCanvasCatalog();
  const links = useGraphStore((s) => Object.values(s.edges).filter((e) => e.from === node.id || e.to === node.id).length);
  const convertToLocal = useGraphStore((s) => s.convertToLocal);

  return (
    <section className="panel-section" aria-label="En este lienzo">
      <h4>En este lienzo</h4>
      <p className="panel-help">
        {links === 0 ? 'Sin conexiones aquí.' : links === 1 ? '1 conexión aquí.' : `${links} conexiones aquí.`}
      </p>
      {!share && (
        <>
          <button
            type="button"
            className="pixel-button"
            onClick={() =>
              convertToLocal(node.id, {
                type: item.type,
                title: item.title,
                description: item.description,
                http: item.http,
                database: item.database,
              })
            }
          >
            Crear copia independiente
          </button>
          <p className="panel-help">
            Lo vuelve un nodo propio de este lienzo con los datos actuales; los cambios del componente ya no le llegan.
          </p>
        </>
      )}
      {appId && !share && (
        <Link className="panel-link" to={catalogPath(appId, item.id)}>
          Abrir en el catálogo
        </Link>
      )}
    </section>
  );
}
