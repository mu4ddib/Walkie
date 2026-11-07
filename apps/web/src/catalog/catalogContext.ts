import { createContext, useContext } from 'react';
import type { CatalogItem, Feature } from '../api/client';
import type { Node } from '../schema/walkie-graph';
import type { NodeType } from '../store/graphStore';

/**
 * Catálogo de la app visto desde un lienzo: los nodos `ref` se dibujan con los datos actuales
 * del elemento (spec catalogo, criterio 7). Es de solo lectura: el catálogo se edita en su página.
 */
export interface CanvasCatalog {
  appId: string;
  items: Record<string, CatalogItem>;
  /** Features de la app (destinos de los `portal`) y la del lienzo actual. */
  features?: Record<string, Feature>;
  featureId?: string;
}

export const CatalogContext = createContext<CanvasCatalog>({ appId: '', items: {} });

export function useCanvasCatalog(): CanvasCatalog {
  return useContext(CatalogContext);
}

/** Catálogo (y features de la app) indexados por id. */
export function toCanvasCatalog(
  appId: string,
  items: readonly CatalogItem[],
  features: readonly Feature[] = [],
  featureId?: string,
): CanvasCatalog {
  return {
    appId,
    items: Object.fromEntries(items.map((i) => [i.id, i])),
    features: Object.fromEntries(features.map((f) => [f.id, f])),
    featureId,
  };
}

/** Feature a la que lleva un `portal`; `undefined` si no tiene destino o ya no existe. */
export function portalTarget(node: Node, features: Record<string, Feature> | undefined): Feature | undefined {
  return node.type === 'portal' && node.targetFeatureId ? features?.[node.targetFeatureId] : undefined;
}

/** Elemento al que apunta un `ref`; `undefined` si el nodo no es `ref` o el elemento ya no existe. */
export function refTarget(node: Node, items: Record<string, CatalogItem>): CatalogItem | undefined {
  return node.type === 'ref' && node.catalogId ? items[node.catalogId] : undefined;
}

/** Tipo con el que se comporta un nodo: un `ref` actúa como su elemento (criterio 9). */
export function effectiveType(node: Node, items: Record<string, CatalogItem>): NodeType {
  return refTarget(node, items)?.type ?? node.type;
}
