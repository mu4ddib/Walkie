/* Generado desde packages/schema/walkie-shared-feature.schema.json. No editar a mano: `pnpm gen:schema`. */
import type {WalkieCanvasGraphV0} from './walkie-graph';
import type {WalkieCatalogItemV0} from './walkie-catalog-item';

/**
 * Lo que ve quien abre un enlace de solo lectura (GET /api/public/shares/{token}, ADR-0005): una feature, sin nada más de su app.
 */
export interface WalkieSharedFeatureV0 {
  appName: string;
  featureName: string;
  expiresAt: string;
  graph: WalkieCanvasGraphV0;
  /**
   * Solo los elementos del catálogo que usan los nodos ref del grafo
   */
  catalog: WalkieCatalogItemV0[];
}
