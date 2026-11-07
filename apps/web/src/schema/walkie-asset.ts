/* Generado desde packages/schema/walkie-asset.schema.json. No editar a mano: `pnpm gen:schema`. */

/**
 * Imagen subida a una app (ADR-0004). Un nodo screen la usa con assetId; los bytes se leen en GET /api/assets/{id}.
 */
export interface WalkieAssetV0 {
  id: string;
  appId: string;
  contentType: 'image/png' | 'image/jpeg' | 'image/webp';
  /**
   * Bytes (hasta 5 MB)
   */
  size: number;
  width: number;
  height: number;
}
