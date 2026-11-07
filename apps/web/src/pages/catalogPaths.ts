import type { CatalogItemType } from '../api/client';

/** Tipos del catálogo, en el orden en que se muestran. */
export const CATALOG_TYPES: readonly CatalogItemType[] = ['api', 'service', 'database'];

/** Ruta del catálogo de una app o de uno de sus elementos (también la usa el panel de un `ref`). */
export function catalogPath(appId: string, itemId?: string): string {
  return itemId ? `/apps/${appId}/catalog/${itemId}` : `/apps/${appId}/catalog`;
}
