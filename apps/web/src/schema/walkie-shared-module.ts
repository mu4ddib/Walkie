/* Generado desde packages/schema/walkie-shared-module.schema.json. No editar a mano: `pnpm gen:schema`. */
import type {WalkieCanvasGraphV0} from './walkie-graph';
import type {WalkieCatalogItemV0} from './walkie-catalog-item';

/**
 * Un módulo compartido visto desde un enlace de solo lectura (GET /api/public/shares/{token}/modules/{moduleId}, spec modulos-compartidos): solo si la feature del enlace lo usa, directa o indirectamente.
 */
export interface WalkieSharedModuleV0 {
  name: string;
  description?: string;
  graph: WalkieCanvasGraphV0;
  /**
   * Solo los elementos del catálogo que usan los nodos ref del lienzo del módulo
   */
  catalog: WalkieCatalogItemV0[];
}
