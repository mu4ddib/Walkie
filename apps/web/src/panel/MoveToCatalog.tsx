import { ApiError, type CatalogItemType } from '../api/client';
import { useCreateCatalogItem } from '../api/hooks';
import type { Node } from '../schema/walkie-graph';
import { useGraphStore } from '../store/useGraphStore';

/**
 * "Guardar como componente" (spec espacio-de-trabajo, criterio 11; antes "Mover al catálogo"): crea el
 * elemento con los datos del nodo y lo convierte en un `ref` con el mismo id, posición y conexiones.
 * El lienzo queda "Sin guardar".
 */
export function MoveToCatalog({ appId, node }: { appId: string; node: Node }) {
  const create = useCreateCatalogItem(appId);
  const convertToRef = useGraphStore((s) => s.convertToRef);

  async function move() {
    try {
      // El contrato o la estructura pasan tal cual: la definición compartida es la misma estructura.
      const item = await create.mutateAsync({
        type: node.type as CatalogItemType,
        title: node.title,
        description: node.description,
        http: node.type === 'api' ? node.http : undefined,
        database: node.type === 'database' ? node.database : undefined,
        resource: node.type === 'resource' ? node.resource : undefined,
        runtime: node.type === 'service' ? node.runtime : undefined,
      });
      convertToRef(node.id, item.id);
    } catch {
      // El error llega por `create.error`.
    }
  }

  return (
    <section className="panel-section" aria-label="Componente">
      <button type="button" className="pixel-button" disabled={create.isPending} onClick={() => void move()}>
        Guardar como componente
      </button>
      <p className="panel-help">
        Pasa al catálogo de la app: lo podrás usar en otros lienzos y su definición se compartirá entre todos.
      </p>
      {create.error && (
        <p role="alert" className="panel-error">
          {create.error instanceof ApiError ? create.error.userMessage : 'No se pudo crear en el catálogo.'}
        </p>
      )}
    </section>
  );
}
