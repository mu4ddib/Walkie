import { endFamily, useCanvasCatalog } from '../catalog/catalogContext';
import { kindFor, type OperationId, type Pattern } from '../interactions/operations';
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
  const { items, modules } = useCanvasCatalog();
  return (edgeId, kind) => {
    const { edges, nodes, updateEdge } = store.getState();
    const edge = edges[edgeId];
    if (!edge || edge.kind === kind) return false;
    const reverse = shouldReverse(
      edge.kind,
      kind,
      endFamily(nodes[edge.from], edge.fromInterface, items, modules),
      endFamily(nodes[edge.to], edge.toInterface, items, modules),
    );
    updateEdge(edgeId, { kind, reverse });
    return reverse;
  };
}

/**
 * Fija la operación de una conexión (spec interacciones, ADR-0011): la operación pasa a ser la fuente de verdad y el
 * trazo (`kind`) el que le corresponde con su patrón. No cambia el sentido: para eso está «Invertir sentido».
 */
export function useSetOperation(): (edgeId: string, operation: OperationId, pattern?: Pattern) => void {
  const store = useGraphStoreApi();
  return (edgeId, operation, pattern) => {
    const { edges, updateEdge } = store.getState();
    const edge = edges[edgeId];
    if (!edge || edge.kind === 'response') return;
    updateEdge(edgeId, { operation, kind: kindFor(operation, pattern ?? edge.pattern), ...(pattern ? { pattern } : {}) });
  };
}
