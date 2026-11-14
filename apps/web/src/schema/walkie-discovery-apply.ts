/* Generado desde packages/schema/walkie-discovery-apply.schema.json. No editar a mano: `pnpm gen:schema`. */

export type Operation = {
  /**
   * create: crea el elemento (api/service/database/resource → catálogo; module → módulo con su lienzo e interfaces; feature → feature con su lienzo inicial y sus pantallas) con el id dado; link: vincula a un elemento existente sin cambiarlo; reject: descarta; reset: quita el vínculo (el elemento creado o vinculado sigue igual)
   */
  op: 'create' | 'link' | 'reject' | 'reset';
  /**
   * Identidad estable entre análisis: sale de lo que define al componente, nunca de líneas ni de la ruta del archivo donde está (ADR-0014). api:<MÉTODO> <ruta normalizada> (parámetros como {}), service:<nombre>, database:<motor>/<nombre>, resource:<subtipo>/<nombre>, screen:<ruta normalizada>, module:<nombre>, feature:<nombre>. DiscoveryKeys (Walkie.Shared) las arma
   */
  entityKey: string;
  /**
   * Solo en create: UUID v7 del cliente para lo que se crea (idempotente)
   */
  id?: string;
  target?: Target;
  /**
   * Versión del vínculo que se espera (0: que no haya ninguno); si no coincide, 409
   */
  bindingVersion?: number;
  note?: string;
} & {
  /**
   * create: crea el elemento (api/service/database/resource → catálogo; module → módulo con su lienzo e interfaces; feature → feature con su lienzo inicial y sus pantallas) con el id dado; link: vincula a un elemento existente sin cambiarlo; reject: descarta; reset: quita el vínculo (el elemento creado o vinculado sigue igual)
   */
  op: 'create' | 'link' | 'reject' | 'reset';
  /**
   * Identidad estable entre análisis: sale de lo que define al componente, nunca de líneas ni de la ruta del archivo donde está (ADR-0014). api:<MÉTODO> <ruta normalizada> (parámetros como {}), service:<nombre>, database:<motor>/<nombre>, resource:<subtipo>/<nombre>, screen:<ruta normalizada>, module:<nombre>, feature:<nombre>. DiscoveryKeys (Walkie.Shared) las arma
   */
  entityKey: string;
  /**
   * Solo en create: UUID v7 del cliente para lo que se crea (idempotente)
   */
  id?: string;
  target?: Target;
  /**
   * Versión del vínculo que se espera (0: que no haya ninguno); si no coincide, 409
   */
  bindingVersion?: number;
  note?: string;
};

/**
 * Operaciones de revisión sobre un análisis (spec walkie-live, ADR-0012 y ADR-0014): el único camino por el que un hallazgo cambia algo en Walkie. Con dryRun es la vista previa. Idempotente por applyId: repetirlo devuelve el mismo resultado. Nunca escribe en lienzos existentes, nunca cambia un elemento vinculado y nunca borra.
 */
export interface WalkieDiscoveryApplyV0 {
  /**
   * UUID v7 del cliente; identifica la aplicación en la bitácora
   */
  applyId: string;
  /**
   * @minItems 1
   * @maxItems 1000
   */
  operations: [Operation, ...Operation[]];
}
/**
 * Solo en link
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
