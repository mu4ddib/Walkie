import { createContext, useContext } from 'react';
import type { CatalogItem } from '../api/client';
import type { Node } from '../schema/walkie-graph';
import type { NodeType } from '../store/graphStore';

/**
 * Catálogo de la app visto desde un lienzo: los nodos `ref` se dibujan con los datos actuales
 * del elemento (spec catalogo, criterio 7). Es de solo lectura: el catálogo se edita en su página.
 */
export interface CanvasCatalog {
  appId: string;
  items: Record<string, CatalogItem>;
}

export const CatalogContext = createContext<CanvasCatalog>({ appId: '', items: {} });

export function useCanvasCatalog(): CanvasCatalog {
  return useContext(CatalogContext);
}

/** Catálogo indexado por id. */
export function toCanvasCatalog(appId: string, items: readonly CatalogItem[]): CanvasCatalog {
  return { appId, items: Object.fromEntries(items.map((i) => [i.id, i])) };
}

/** Elemento al que apunta un `ref`; `undefined` si el nodo no es `ref` o el elemento ya no existe. */
export function refTarget(node: Node, items: Record<string, CatalogItem>): CatalogItem | undefined {
  return node.type === 'ref' && node.catalogId ? items[node.catalogId] : undefined;
}

/** Tipo con el que se comporta un nodo: un `ref` actúa como su elemento (criterio 9). */
export function effectiveType(node: Node, items: Record<string, CatalogItem>): NodeType {
  return refTarget(node, items)?.type ?? node.type;
}
