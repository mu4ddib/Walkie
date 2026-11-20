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
export interface Limitation {
  code: string;
  message: string;
  path?: string;
  detector?: string;
  group?: string;
  incomplete: boolean;
}
