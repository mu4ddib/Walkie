/* Generado desde packages/schema/walkie-discovery-architecture.schema.json. No editar a mano: `pnpm gen:schema`. */

/**
 * frontend: una app de front y sus pantallas; service: un servicio del backend y sus APIs; module: un módulo y lo suyo; data: bases sin dueño; infrastructure: recursos; external: APIs que el análisis no ve publicar; unassigned: lo demás
 */
export type GroupKind = 'frontend' | 'service' | 'module' | 'data' | 'infrastructure' | 'external' | 'unassigned';
/**
 * execution: calls, reads, writes, publishes, consumes; navigation: navigates; containment: exposes, contains; dependency: depends-on. Una contención o una dependencia nunca es una solicitud
 */
export type Semantic = 'execution' | 'navigation' | 'containment' | 'dependency';

/**
 * Arquitectura descubierta de un análisis (spec walkie-live-arquitectura, ADR-0016): una proyección calculada al pedirla, sin guardar nada. Agrupa los hallazgos por app técnica y responsabilidad, agrega sus relaciones por tipo y significado, y lista las propuestas de feature con su evidencia. Es lo descubierto, no lo confirmado en Walkie. GET /api/snapshots/{snapshotId}/architecture.
 */
export interface WalkieDiscoveryArchitectureV0 {
  snapshotId: string;
  completeness: 'complete' | 'partial';
  totals: {
    entities: number;
    relations: number;
  };
  groups: Group[];
  links: Link[];
  proposals: Proposal[];
  limitations: Limitation[];
  /**
   * El análisis anterior de la misma fuente, para abrir su arquitectura
   */
  previousSnapshotId?: string;
}
export interface Group {
  key: string;
  kind: GroupKind;
  title: string;
  technology?: string;
  /**
   * El hallazgo que da nombre al grupo (la app o el módulo), si lo hay
   */
  entityKey?: string;
  counts: Counts;
  /**
   * Relaciones dentro del grupo, por significado
   */
  internal: {
    [k: string]: number;
  };
  /**
   * Limitaciones de sus archivos
   */
  limitations: number;
  /**
   * De ellas, las que dejan algo sin ver
   */
  incomplete: number;
  /**
   * Hallazgos del grupo por estado (solo los que hay)
   */
  states?: {
    [k: string]: number;
  };
}
/**
 * Hallazgos por tipo
 */
export interface Counts {
  [k: string]: number;
}
export interface Link {
  from: string;
  to: string;
  kind: 'calls' | 'reads' | 'writes' | 'publishes' | 'consumes' | 'exposes' | 'depends-on' | 'navigates' | 'contains';
  semantic: Semantic;
  total: number;
  observed: number;
  inferred: number;
  /**
   * De ellas, las de confianza baja
   */
  low: number;
  /**
   * Las mismas relaciones en categorías disjuntas (base × confianza): la web suma las que deja ver cada filtro, sin mostrar un total que no cumple el filtro.
   */
  byBasis: {
    observed: CountByConfidence;
    inferred: CountByConfidence;
  };
}
export interface CountByConfidence {
  high: number;
  medium: number;
  low: number;
}
export interface Proposal {
  key: string;
  title: string;
  app?: string;
  /**
   * El grupo de su app técnica
   */
  group?: string;
  description?: string;
  confidence: 'high' | 'medium' | 'low';
  /**
   * evidence: navegación o carga diferida, y APIs en común o del mismo módulo; heuristic: solo la forma de las rutas
   */
  strength: 'evidence' | 'heuristic';
  screens: number;
  apis: number;
  /**
   * Navegaciones demostradas entre sus pantallas
   */
  navigation: number;
  /**
   * Llamadas demostradas de sus pantallas a sus APIs
   */
  requests: number;
  /**
   * Limitaciones que dejan algo sin ver en su app técnica
   */
  unresolved: number;
  /**
   * Si ya se decidió (la feature existe o se descartó)
   */
  decision?: 'created' | 'linked' | 'rejected';
  state?: State;
  /**
   * Sus pantallas y las APIs que llaman (las claves de los hallazgos), en orden
   *
   * @maxItems 500
   */
  members: string[];
  /**
   * Cuántos miembros tiene la propuesta en el análisis. Si es mayor que members (que llega hasta 500), la lista está truncada y la revisión por conjuntos no la aplica de una vez.
   */
  memberCount: number;
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
export interface Limitation {
  code: string;
  message: string;
  path?: string;
  detector?: string;
  group?: string;
  incomplete: boolean;
}
