/* Generado desde packages/schema/walkie-discovery-review.schema.json. No editar a mano: `pnpm gen:schema`. */

export type Item = {
  /**
   * Identidad estable entre análisis: sale de lo que define al componente, nunca de líneas ni de la ruta del archivo donde está (ADR-0014). api:<MÉTODO> <ruta normalizada> (parámetros como {}), service:<nombre>, database:<motor>/<nombre>, resource:<subtipo>/<nombre>, screen:<ámbito de la app>:<ruta normalizada>, module:<nombre>, feature:<ámbito de la app>:<nombre> (formatVersion 1; en la 0, screen:<ruta> y feature:<nombre>, que siguen siendo válidas en los registros de la API: un vínculo decidido antes conserva su clave). DiscoveryKeys (Walkie.Shared) las arma
   */
  key: string;
  /**
   * api, service, database y resource se proponen como elementos del catálogo; screen como pantalla de una feature; module como módulo compartido (ADR-0010) y feature como feature con su lienzo inicial
   */
  kind: 'api' | 'service' | 'database' | 'resource' | 'screen' | 'module' | 'feature';
  title: string;
  /**
   * observed: declarado tal cual en el código o la configuración (un archivo OpenAPI, un MapGet con ruta literal, un servicio de compose); inferred: deducido por convención o heurística (un módulo por proyecto, una feature por pantalla). Ninguno es una confirmación
   */
  basis: 'observed' | 'inferred';
  /**
   * high: sin ambigüedad (solo en lo observado); medium: convención clara; low: heurística. La revisión nunca aplica sola lo que no es high
   */
  confidence: 'high' | 'medium' | 'low';
  status: Status;
  /**
   * En missing, el del análisis anterior
   */
  fingerprint: string;
  binding?: WalkieDiscoveryBindingV0;
  legacyBinding?: WalkieDiscoveryBindingV01;
  /**
   * Solo con un vínculo linked o created cuyo elemento ya no existe en Walkie (se borró a mano): la decisión sigue guardada pero no apunta a nada. Restablécela o vincúlalo a otro elemento
   */
  targetMissing?: true;
  /**
   * Solo en matched: con qué elemento existente coincide y por qué
   */
  match?: {
    target: Target;
    /**
     * signature: misma firma (api: método y ruta normalizada; database: motor y nombre; service: nombre); title: título parecido (solo sugerencia, nunca se vincula sola)
     */
    reason: 'signature' | 'title';
  };
  /**
   * Solo en new: varios elementos existentes coinciden por el mismo motivo y no se elige ninguno (la persona decide). Agregado en la tarea 4
   *
   * @minItems 2
   */
  candidates?: [
    {
      target: Target;
      reason: 'signature' | 'title';
    },
    {
      target: Target;
      reason: 'signature' | 'title';
    },
    ...{
      target: Target;
      reason: 'signature' | 'title';
    }[]
  ];
  evidenceCount: number;
  /**
   * Lo que Walkie sugiere; la persona decide con una operación de walkie-discovery-apply
   */
  proposal: {
    /**
     * create: crear el elemento; link: vincular al de match; none: nada que hacer (ya decidido, missing o una screen que solo entra con su feature)
     */
    op: 'create' | 'link' | 'none';
    target?: Target;
  };
  /**
   * Respecto del análisis anterior (solo si hay uno, y no en lo que ya no aparece)
   */
  change?: 'added' | 'modified' | 'unchanged';
  /**
   * Solo en unverified: qué no cubrió este análisis
   */
  coverage?: string;
  /**
   * Pide una decisión: sin decidir, sugerido, cambiado, desaparecido, una decisión vieja ambigua o un destino borrado
   */
  needsReview: boolean;
};
/**
 * new: sin vínculo ni coincidencia; matched: coincide con un elemento existente (sin vínculo todavía); linked/created/rejected: tiene vínculo con esa decisión y su fingerprint no cambió; changed: tiene vínculo y su fingerprint cambió desde que se decidió; missing: estaba en el análisis anterior, tiene vínculo y ya no aparece aunque un detector que lo puede producir corrió (nunca se borra nada) unverified (tarea 10): tenía una decisión y no está en este análisis, pero el análisis no lo cubría (un detector no corrió, quedó fuera del alcance o lo alcanza una limitación): no se concluye que desapareció; coverage dice por qué.
 */
export type Status = 'new' | 'matched' | 'linked' | 'created' | 'rejected' | 'changed' | 'missing' | 'unverified';
/**
 * Vínculo de un hallazgo con Walkie (spec walkie-live, ADR-0012 y ADR-0014): la única confirmación que existe. Lo decide una persona y se guarda en Walkie, nunca en el .walkiepack. Une la clave estable de una entidad de una fuente con un elemento del catálogo, un módulo o una feature (linked: ya existía; created: lo creó una aplicación) o la descarta (rejected). Persiste entre análisis de la misma fuente y no cambia el elemento al que apunta.
 */
export type WalkieDiscoveryBindingV0 = {
  sourceId: string;
  /**
   * Identidad estable entre análisis: sale de lo que define al componente, nunca de líneas ni de la ruta del archivo donde está (ADR-0014). api:<MÉTODO> <ruta normalizada> (parámetros como {}), service:<nombre>, database:<motor>/<nombre>, resource:<subtipo>/<nombre>, screen:<ámbito de la app>:<ruta normalizada>, module:<nombre>, feature:<ámbito de la app>:<nombre> (formatVersion 1; en la 0, screen:<ruta> y feature:<nombre>, que siguen siendo válidas en los registros de la API: un vínculo decidido antes conserva su clave). DiscoveryKeys (Walkie.Shared) las arma
   */
  entityKey: string;
  decision: 'linked' | 'created' | 'rejected';
  target?: Target;
  /**
   * Fingerprint de la entidad cuando se decidió: si cambia en un análisis posterior, la revisión la marca changed
   */
  entityFingerprint: string;
  /**
   * Análisis en el que se decidió
   */
  snapshotId: string;
  /**
   * Identidad estable entre análisis: sale de lo que define al componente, nunca de líneas ni de la ruta del archivo donde está (ADR-0014). api:<MÉTODO> <ruta normalizada> (parámetros como {}), service:<nombre>, database:<motor>/<nombre>, resource:<subtipo>/<nombre>, screen:<ámbito de la app>:<ruta normalizada>, module:<nombre>, feature:<ámbito de la app>:<nombre> (formatVersion 1; en la 0, screen:<ruta> y feature:<nombre>, que siguen siendo válidas en los registros de la API: un vínculo decidido antes conserva su clave). DiscoveryKeys (Walkie.Shared) las arma
   */
  decidedKey?: string;
  /**
   * Aplicación que lo escribió (bitácora, ADR-0012)
   */
  applyId?: string;
  /**
   * Por qué se descartó o vinculó así
   */
  note?: string;
  /**
   * Claim sub de quien decidió (ADR-0003)
   */
  decidedBy: string;
  decidedAt: string;
  /**
   * Concurrencia optimista: una operación con versión vieja responde 409
   */
  version: number;
};
/**
 * Vínculo de un hallazgo con Walkie (spec walkie-live, ADR-0012 y ADR-0014): la única confirmación que existe. Lo decide una persona y se guarda en Walkie, nunca en el .walkiepack. Une la clave estable de una entidad de una fuente con un elemento del catálogo, un módulo o una feature (linked: ya existía; created: lo creó una aplicación) o la descarta (rejected). Persiste entre análisis de la misma fuente y no cambia el elemento al que apunta.
 */
export type WalkieDiscoveryBindingV01 = {
  sourceId: string;
  /**
   * Identidad estable entre análisis: sale de lo que define al componente, nunca de líneas ni de la ruta del archivo donde está (ADR-0014). api:<MÉTODO> <ruta normalizada> (parámetros como {}), service:<nombre>, database:<motor>/<nombre>, resource:<subtipo>/<nombre>, screen:<ámbito de la app>:<ruta normalizada>, module:<nombre>, feature:<ámbito de la app>:<nombre> (formatVersion 1; en la 0, screen:<ruta> y feature:<nombre>, que siguen siendo válidas en los registros de la API: un vínculo decidido antes conserva su clave). DiscoveryKeys (Walkie.Shared) las arma
   */
  entityKey: string;
  decision: 'linked' | 'created' | 'rejected';
  target?: Target;
  /**
   * Fingerprint de la entidad cuando se decidió: si cambia en un análisis posterior, la revisión la marca changed
   */
  entityFingerprint: string;
  /**
   * Análisis en el que se decidió
   */
  snapshotId: string;
  /**
   * Identidad estable entre análisis: sale de lo que define al componente, nunca de líneas ni de la ruta del archivo donde está (ADR-0014). api:<MÉTODO> <ruta normalizada> (parámetros como {}), service:<nombre>, database:<motor>/<nombre>, resource:<subtipo>/<nombre>, screen:<ámbito de la app>:<ruta normalizada>, module:<nombre>, feature:<ámbito de la app>:<nombre> (formatVersion 1; en la 0, screen:<ruta> y feature:<nombre>, que siguen siendo válidas en los registros de la API: un vínculo decidido antes conserva su clave). DiscoveryKeys (Walkie.Shared) las arma
   */
  decidedKey?: string;
  /**
   * Aplicación que lo escribió (bitácora, ADR-0012)
   */
  applyId?: string;
  /**
   * Por qué se descartó o vinculó así
   */
  note?: string;
  /**
   * Claim sub de quien decidió (ADR-0003)
   */
  decidedBy: string;
  decidedAt: string;
  /**
   * Concurrencia optimista: una operación con versión vieja responde 409
   */
  version: number;
};

/**
 * Revisión de un análisis (spec walkie-live, ADR-0012 y ADR-0014): una página de hallazgos con su estado y su propuesta de cambio. No se guarda: se calcula del análisis, los vínculos de la fuente, el análisis anterior y el catálogo y los módulos actuales. Proponer no escribe nada; los cambios se piden con walkie-discovery-apply.
 */
export interface WalkieDiscoveryReviewV0 {
  snapshotId: string;
  sourceId: string;
  previousSnapshotId?: string;
  /**
   * Totales del análisis completo (no de la página), por estado
   */
  counts: {
    new: number;
    matched: number;
    linked: number;
    created: number;
    rejected: number;
    changed: number;
    missing: number;
    unverified: number;
  };
  /**
   * Orden estable: por kind y key
   */
  page: {
    index: number;
    size: number;
    /**
     * Hallazgos que cumplen los filtros
     */
    total: number;
  };
  items: Item[];
  previous?: Brief;
  /**
   * Comparación con el análisis anterior (solo si hay uno; tarea 10). Lo que ya no aparece va en counts.missing (con cobertura) y counts.unverified (sin ella)
   */
  comparison?: {
    /**
     * Hallazgos que no estaban en el anterior
     */
    added: number;
    /**
     * Estaban y cambió su contenido (fingerprint)
     */
    modified: number;
    /**
     * Estaban y siguen iguales
     */
    unchanged: number;
    /**
     * Piden una decisión de una persona (needsReview en el ítem)
     */
    needsReview: number;
  };
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
/**
 * El análisis anterior de la fuente, con el que se compara (tarea 10)
 */
export interface Brief {
  id: string;
  generatedAt: string;
  importedAt: string;
  /**
   * complete: todos los detectores corrieron sobre todo el proyecto (include = ** /*); partial: no. Un análisis parcial es válido: la revisión no marca como «ya no aparece» lo que quedó fuera
   */
  completeness: 'complete' | 'partial';
  vcs?: Vcs;
}
/**
 * Estado del control de versiones al analizar, si lo hay (leído de los archivos de .git, sin ejecutar git)
 */
export interface Vcs {
  kind: 'git';
  commit: string;
  branch?: string;
  /**
   * Hay cambios sin confirmar (si se pudo saber)
   */
  dirty?: boolean;
}
