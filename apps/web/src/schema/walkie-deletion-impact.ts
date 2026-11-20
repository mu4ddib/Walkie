/* Generado desde packages/schema/walkie-deletion-impact.schema.json. No editar a mano: `pnpm gen:schema`. */

/**
 * Lo que se pierde al eliminar una feature o una app y lo que lo impide (spec eliminar-apps-y-features, ADR-0017). GET /api/features/{featureId}/deletion y GET /api/apps/{appId}/deletion; también va en extensions.impact de un 409.
 */
export interface WalkieDeletionImpactV0 {
  kind: 'feature' | 'app';
  id: string;
  name: string;
  /**
   * Siempre false: la eliminación es definitiva (ADR-0017)
   */
  reversible: boolean;
  /**
   * Solo de una feature: la versión de su lienzo (0 sin lienzo). DELETE la exige igual: si alguien guardó después, 409
   */
  canvasVersion?: number;
  /**
   * Conteos por concepto. Feature: nodes, edges, tours, flows, shares (enlaces activos), images (exclusivas, se borran), imagesShared (las usa otro lienzo, se conservan), mapPosition, provenance (vínculos de Walkie Live). App: features, modules, catalogItems, members, canvases, tours, flows, map, images, shares, sources, snapshots, decisions, pendingOperations
   */
  counts: {
    [k: string]: number;
  };
  /**
   * Lo que impide eliminar ahora; vacío si se puede
   */
  blockers: {
    code: 'portal' | 'module' | 'discovery-in-progress';
    message: string;
    /**
     * Lo que hay que resolver (ej. las features con portales hacia esta)
     */
    references: {
      kind: 'feature' | 'module';
      id: string;
      name: string;
    }[];
  }[];
}
