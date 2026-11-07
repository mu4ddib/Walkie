/* Generado desde packages/schema/walkie-catalog-item.schema.json. No editar a mano: `pnpm gen:schema`. */

/**
 * Elemento reutilizable del catálogo de una app (ADR-0002). Los lienzos lo usan con nodos ref (catalogId).
 */
export interface WalkieCatalogItemV0 {
  /**
   * Generado por la API
   */
  id: string;
  appId: string;
  type: 'api' | 'service' | 'database';
  title: string;
  description?: string;
  /**
   * Contrato básico (solo type api)
   */
  http?: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path?: string;
  };
  /**
   * Versión para concurrencia optimista
   */
  version: number;
}
