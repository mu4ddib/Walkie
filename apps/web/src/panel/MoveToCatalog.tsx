import { ApiError, type CatalogItemType } from '../api/client';
import { useCreateCatalogItem } from '../api/hooks';
import type { Node } from '../schema/walkie-graph';
import { useGraphStore } from '../store/useGraphStore';

/**
 * "Mover al catálogo" (spec catalogo, criterio 10b): crea el elemento con los datos del nodo y lo
 * convierte en un `ref` con el mismo id, posición y conexiones. El lienzo queda "Sin guardar".
 */
export function MoveToCatalog({ appId, node }: { appId: string; node: Node }) {
  const create = useCreateCatalogItem(appId);
  const convertToRef = useGraphStore((s) => s.convertToRef);

  async function move() {
    const http =
      node.type === 'api' && (node.http?.method || node.http?.path)
        ? { method: node.http.method, path: node.http.path }
        : undefined;
    try {
      const item = await create.mutateAsync({
        type: node.type as CatalogItemType,
        title: node.title,
        description: node.description,
        http,
      });
      convertToRef(node.id, item.id);
    } catch {
      // El error llega por `create.error`.
    }
  }

  return (
    <section className="panel-section" aria-label="Catálogo">
      <button type="button" className="pixel-button" disabled={create.isPending} onClick={() => void move()}>
        Mover al catálogo
      </button>
      <p className="panel-help">Lo podrás usar en otros lienzos de la app; se editará en el catálogo.</p>
      {create.error && (
        <p role="alert" className="panel-error">
          {create.error instanceof ApiError ? create.error.userMessage : 'No se pudo crear en el catálogo.'}
        </p>
      )}
    </section>
  );
}
