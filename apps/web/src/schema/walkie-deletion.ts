/* Generado desde packages/schema/walkie-deletion.schema.json. No editar a mano: `pnpm gen:schema`. */

/**
 * Estado de una eliminación (spec eliminar-apps-y-features, ADR-0017): cuerpo de un 202 de DELETE /api/apps/{appId} o /api/features/{featureId} y de GET /api/deletions/{deletionId}.
 */
export interface WalkieDeletionV0 {
  /**
   * El id que generó el cliente
   */
  id: string;
  kind: 'feature' | 'app';
  appId: string;
  featureId?: string;
  name: string;
  /**
   * pending: ya no es accesible, falta limpiar algún módulo (se reintenta sola); completed: no queda nada; cancelled: algo cambió en medio y no se eliminó
   */
  status: 'pending' | 'completed' | 'cancelled';
  requestedAt: string;
  completedAt?: string;
  steps: {
    step: string;
    status: 'done' | 'failed';
    error?: string;
  }[];
  /**
   * El paso que falló y por qué, mientras siga pendiente
   */
  error?: string;
}
