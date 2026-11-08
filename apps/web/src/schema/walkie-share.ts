/* Generado desde packages/schema/walkie-share.schema.json. No editar a mano: `pnpm gen:schema`. */

/**
 * Enlace de solo lectura a una feature (ADR-0005). El token solo viaja en la respuesta de creación; la web arma la URL /s/{token}.
 */
export interface WalkieShareV0 {
  id: string;
  featureId: string;
  /**
   * Nombre de quien lo creó (claim name del token)
   */
  createdByName: string;
  createdAt: string;
  expiresAt: string;
  /**
   * Último acceso con el enlace; ausente si nunca se abrió
   */
  lastAccessedAt?: string;
  /**
   * 256 bits en base64url. Solo en la respuesta de creación: la base guarda su hash SHA-256
   */
  token?: string;
}
