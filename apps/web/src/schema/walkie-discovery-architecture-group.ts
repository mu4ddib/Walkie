/* Generado desde packages/schema/walkie-discovery-architecture-group.schema.json. No editar a mano: `pnpm gen:schema`. */

/**
 * Lo que hay dentro de un grupo de la arquitectura descubierta (spec walkie-live-arquitectura): sus hallazgos (paginados), sus relaciones y los vecinos de otros grupos con los que se relaciona. Calculado, sin guardar. GET /api/snapshots/{snapshotId}/architecture/group?key=…
 */
export interface WalkieDiscoveryArchitectureGroupV0 {
  key: string;
  page: number;
  pageSize: number;
  total: number;
  entities: Entity[];
  relations: Relation[];
  /**
   * Hallazgos de otros grupos en el otro extremo de una relación
   */
  neighbors: Entity[];
}
export interface Entity {
  key: string;
  kind: 'api' | 'service' | 'database' | 'resource' | 'screen' | 'module' | 'feature';
  title: string;
  basis: 'observed' | 'inferred';
  confidence: 'high' | 'medium' | 'low';
  group: string;
  route?: string;
  decision?: 'created' | 'linked' | 'rejected';
}
export interface Relation {
  key: string;
  kind: 'calls' | 'reads' | 'writes' | 'publishes' | 'consumes' | 'exposes' | 'depends-on' | 'navigates' | 'contains';
  from: string;
  to: string;
  basis: 'observed' | 'inferred';
  confidence: 'high' | 'medium' | 'low';
  semantic: 'execution' | 'navigation' | 'containment' | 'dependency';
}
