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
  state?: State;
}
/**
 * Estado del hallazgo en Walkie, el mismo de la revisión (spec walkie-live-documentacion). Decidir no lo quita de la arquitectura descubierta
 */
export interface State {
  /**
   * new: sin vínculo ni coincidencia; matched: coincide con un elemento existente (sin vínculo todavía); linked/created/rejected: tiene vínculo con esa decisión y su fingerprint no cambió; changed: tiene vínculo y su fingerprint cambió desde que se decidió; missing: estaba en el análisis anterior, tiene vínculo y ya no aparece aunque un detector que lo puede producir corrió (nunca se borra nada) unverified (tarea 10): tenía una decisión y no está en este análisis, pero el análisis no lo cubría (un detector no corrió, quedó fuera del alcance o lo alcanza una limitación): no se concluye que desapareció; coverage dice por qué.
   */
  status: 'new' | 'matched' | 'linked' | 'created' | 'rejected' | 'changed' | 'missing' | 'unverified';
  /**
   * Respecto del análisis anterior de la fuente
   */
  change?: 'added' | 'modified' | 'unchanged';
  target?: Target;
  /**
   * El elemento documentado al que apunta se borró
   */
  targetMissing?: true;
  needsReview: boolean;
}
/**
 * Elemento de Walkie al que apunta un vínculo (referencia por id, como un catalogId o un moduleId en el grafo; sin copia de su contenido)
 */
export interface Target {
  /**
   * catalogItem: walkie-catalog-item; module y feature: filas de apps.features (ADR-0010)
   */
  kind: 'catalogItem' | 'module' | 'feature';
  id: string;
  /**
   * Último nombre conocido (informativo, como el title de un ref)
   */
  title?: string;
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
