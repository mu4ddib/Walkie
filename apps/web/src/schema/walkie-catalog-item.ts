/* Generado desde packages/schema/walkie-catalog-item.schema.json. No editar a mano: `pnpm gen:schema`. */
import type {Database, Http} from './walkie-graph';

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
  http?: Http;
  database?: Database;
  /**
   * Versión para concurrencia optimista
   */
  version: number;
}
