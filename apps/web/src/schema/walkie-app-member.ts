/* Generado desde packages/schema/walkie-app-member.schema.json. No editar a mano: `pnpm gen:schema`. */

/**
 * viewer lee; editor además crea y edita; owner además borra del catálogo y módulos, maneja enlaces y miembros
 */
export type Role = 'owner' | 'editor' | 'viewer';

/**
 * Un miembro de una app con su rol (spec autorizacion-por-app, ADR-0015). GET /api/apps/{appId}/members devuelve un arreglo de estos; POST y PUT de un miembro devuelven uno.
 */
export interface WalkieAppMemberV0 {
  /**
   * El claim sub de la persona
   */
  userId: string;
  /**
   * Nombre que dio el token al entrar; si no dio uno, el correo o el id
   */
  name: string;
  /**
   * Correo en minúsculas, si el token lo trajo
   */
  email?: string;
  role: Role;
  grantedAt: string;
}
