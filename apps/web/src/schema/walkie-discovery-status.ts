/* Generado desde packages/schema/walkie-discovery-status.schema.json. No editar a mano: `pnpm gen:schema`. */

/**
 * Respuesta de GET /api/discovery (spec walkie-live, tarea 10): Walkie Live está encendido en esta API. Si Discovery:Enabled está apagado, el endpoint responde 404 (como todo Discovery): la web no ofrece sus opciones.
 */
export interface WalkieDiscoveryStatusV0 {
  enabled: true;
  /**
   * La versión del .walkiepack que entiende (las anteriores las migra)
   */
  formatVersion: number;
  maxPackBytes: number;
}
