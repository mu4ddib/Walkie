/* Generado desde packages/schema/walkie-discovery-binding.schema.json. No editar a mano: `pnpm gen:schema`. */

/**
 * Vínculo de un hallazgo con Walkie (spec walkie-live, ADR-0012 y ADR-0014): la única confirmación que existe. Lo decide una persona y se guarda en Walkie, nunca en el .walkiepack. Une la clave estable de una entidad de una fuente con un elemento del catálogo, un módulo o una feature (linked: ya existía; created: lo creó una aplicación) o la descarta (rejected). Persiste entre análisis de la misma fuente y no cambia el elemento al que apunta.
 */
export type WalkieDiscoveryBindingV0 = {
  sourceId: string;
  /**
   * Identidad estable entre análisis: sale de lo que define al componente, nunca de líneas ni de la ruta del archivo donde está (ADR-0014). api:<MÉTODO> <ruta normalizada> (parámetros como {}), service:<nombre>, database:<motor>/<nombre>, resource:<subtipo>/<nombre>, screen:<ruta normalizada>, module:<nombre>, feature:<nombre>. DiscoveryKeys (Walkie.Shared) las arma
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
