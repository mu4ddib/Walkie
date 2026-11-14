/* Generado desde packages/schema/walkie-discovery-apply-result.schema.json. No editar a mano: `pnpm gen:schema`. */

/**
 * Resultado de walkie-discovery-apply (spec walkie-live, ADR-0012): con dryRun, la vista previa (status planned, nada escrito); sin él, lo que quedó escrito. unchanged lista lo que las operaciones no tocan a propósito, para que la vista previa diga también qué no cambia.
 */
export interface WalkieDiscoveryApplyResultV0 {
  applyId: string;
  dryRun: boolean;
  /**
   * planned: vista previa; completed: todo escrito; compensated: falló y se deshizo lo creado (bitácora, ADR-0012)
   */
  status: 'planned' | 'completed' | 'compensated';
  created: {
    /**
     * Identidad estable entre análisis: sale de lo que define al componente, nunca de líneas ni de la ruta del archivo donde está (ADR-0014). api:<MÉTODO> <ruta normalizada> (parámetros como {}), service:<nombre>, database:<motor>/<nombre>, resource:<subtipo>/<nombre>, screen:<ruta normalizada>, module:<nombre>, feature:<nombre>. DiscoveryKeys (Walkie.Shared) las arma
     */
    entityKey: string;
    target: Target;
    /**
     * En una feature: las pantallas y referencias que entran en su lienzo inicial
     *
     * Items: Identidad estable entre análisis: sale de lo que define al componente, nunca de líneas ni de la ruta del archivo donde está (ADR-0014). api:<MÉTODO> <ruta normalizada> (parámetros como {}), service:<nombre>, database:<motor>/<nombre>, resource:<subtipo>/<nombre>, screen:<ruta normalizada>, module:<nombre>, feature:<nombre>. DiscoveryKeys (Walkie.Shared) las arma
     */
    includes?: string[];
  }[];
  linked: {
    /**
     * Identidad estable entre análisis: sale de lo que define al componente, nunca de líneas ni de la ruta del archivo donde está (ADR-0014). api:<MÉTODO> <ruta normalizada> (parámetros como {}), service:<nombre>, database:<motor>/<nombre>, resource:<subtipo>/<nombre>, screen:<ruta normalizada>, module:<nombre>, feature:<nombre>. DiscoveryKeys (Walkie.Shared) las arma
     */
    entityKey: string;
    target: Target;
  }[];
  /**
   * Items: Identidad estable entre análisis: sale de lo que define al componente, nunca de líneas ni de la ruta del archivo donde está (ADR-0014). api:<MÉTODO> <ruta normalizada> (parámetros como {}), service:<nombre>, database:<motor>/<nombre>, resource:<subtipo>/<nombre>, screen:<ruta normalizada>, module:<nombre>, feature:<nombre>. DiscoveryKeys (Walkie.Shared) las arma
   */
  rejected: string[];
  /**
   * Items: Identidad estable entre análisis: sale de lo que define al componente, nunca de líneas ni de la ruta del archivo donde está (ADR-0014). api:<MÉTODO> <ruta normalizada> (parámetros como {}), service:<nombre>, database:<motor>/<nombre>, resource:<subtipo>/<nombre>, screen:<ruta normalizada>, module:<nombre>, feature:<nombre>. DiscoveryKeys (Walkie.Shared) las arma
   */
  reset: string[];
  /**
   * Elementos de Walkie que las operaciones no modifican (lienzos existentes que usan lo vinculado, elementos vinculados)
   */
  unchanged: Target[];
  warnings: {
    code: string;
    message: string;
    /**
     * Identidad estable entre análisis: sale de lo que define al componente, nunca de líneas ni de la ruta del archivo donde está (ADR-0014). api:<MÉTODO> <ruta normalizada> (parámetros como {}), service:<nombre>, database:<motor>/<nombre>, resource:<subtipo>/<nombre>, screen:<ruta normalizada>, module:<nombre>, feature:<nombre>. DiscoveryKeys (Walkie.Shared) las arma
     */
    entityKey?: string;
  }[];
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
