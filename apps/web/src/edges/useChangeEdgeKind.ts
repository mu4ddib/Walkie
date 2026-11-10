import { effectiveType, useCanvasCatalog } from '../catalog/catalogContext';
import type { EdgeKind } from '../store/graphStore';
import { useGraphStoreApi } from '../store/useGraphStore';
import { shouldReverse } from './edgeMeta';

/**
 * Cambia el tipo de una conexión cuidando que tipo y sentido concuerden: si el tipo nuevo contradice el sentido
 * (una pantalla → API marcada como "responde"), la invierte en el mismo cambio. Devuelve si la invirtió.
 * La etiqueta personalizada y el resto del detalle se conservan.
 */
export function useChangeEdgeKind(): (edgeId: string, kind: EdgeKind) => boolean {
  const store = useGraphStoreApi();
  const { items } = useCanvasCatalog();
  return (edgeId, kind) => {
    const { edges, nodes, updateEdge } = store.getState();
    const edge = edges[edgeId];
    if (!edge || edge.kind === kind) return false;
    const from = nodes[edge.from];
    const to = nodes[edge.to];
    const reverse = shouldReverse(
      edge.kind,
      kind,
      from && effectiveType(from, items),
      to && effectiveType(to, items),
    );
    updateEdge(edgeId, { kind, reverse });
    return reverse;
  };
}
