/* Generado desde packages/schema/walkie-discovery-apply.schema.json. No editar a mano: `pnpm gen:schema`. */

export type Operation = {
  /**
   * create: crea el elemento (api/service/database/resource → catálogo; module → módulo con su lienzo e interfaces; feature → feature con su lienzo inicial y sus pantallas) con el id dado; link: vincula a un elemento existente sin cambiarlo; reject: descarta; reset: quita el vínculo (el elemento creado o vinculado sigue igual)
   */
  op: 'create' | 'link' | 'reject' | 'reset';
  /**
   * Identidad estable entre análisis: sale de lo que define al componente, nunca de líneas ni de la ruta del archivo donde está (ADR-0014). api:<MÉTODO> <ruta normalizada> (parámetros como {}), service:<nombre>, database:<motor>/<nombre>, resource:<subtipo>/<nombre>, screen:<ámbito de la app>:<ruta normalizada>, module:<nombre>, feature:<ámbito de la app>:<nombre> (formatVersion 1; en la 0, screen:<ruta> y feature:<nombre>, que siguen siendo válidas en los registros de la API: un vínculo decidido antes conserva su clave). DiscoveryKeys (Walkie.Shared) las arma
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
  /**
   * Solo en create de module o feature: el nombre con que se crea (sin él, el del hallazgo; si ya hay uno igual, con su app técnica entre paréntesis)
   */
  name?: string;
  canvas?: Canvas;
} & {
  /**
   * create: crea el elemento (api/service/database/resource → catálogo; module → módulo con su lienzo e interfaces; feature → feature con su lienzo inicial y sus pantallas) con el id dado; link: vincula a un elemento existente sin cambiarlo; reject: descarta; reset: quita el vínculo (el elemento creado o vinculado sigue igual)
   */
  op: 'create' | 'link' | 'reject' | 'reset';
  /**
   * Identidad estable entre análisis: sale de lo que define al componente, nunca de líneas ni de la ruta del archivo donde está (ADR-0014). api:<MÉTODO> <ruta normalizada> (parámetros como {}), service:<nombre>, database:<motor>/<nombre>, resource:<subtipo>/<nombre>, screen:<ámbito de la app>:<ruta normalizada>, module:<nombre>, feature:<ámbito de la app>:<nombre> (formatVersion 1; en la 0, screen:<ruta> y feature:<nombre>, que siguen siendo válidas en los registros de la API: un vínculo decidido antes conserva su clave). DiscoveryKeys (Walkie.Shared) las arma
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
  /**
   * Solo en create de module o feature: el nombre con que se crea (sin él, el del hallazgo; si ya hay uno igual, con su app técnica entre paréntesis)
   */
  name?: string;
  canvas?: Canvas;
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
/**
 * Solo en create de module o feature (tarea 9): los ids (UUID v7 del cliente) y las posiciones de cada clave del borrador del lienzo que devolvió la vista previa (created[].canvas). Obligatorio al aplicar; en la vista previa, sin él se devuelve el borrador y con él, también el grafo validado. Tiene que cubrir exactamente las claves del borrador, sin ids repetidos ni cajas encimadas
 */
export interface Canvas {
  nodes: Ids;
  edges: Ids1;
  interfaces?: Ids2;
  /**
   * Clave de cada caja → posición
   */
  layout: {
    [k: string]: {
      x: number;
      y: number;
    };
  };
}
/**
 * Clave de cada caja del borrador → id del nodo
 */
export interface Ids {
  [k: string]: string;
}
/**
 * Clave de cada conexión → id de la conexión
 */
export interface Ids1 {
  [k: string]: string;
}
/**
 * Clave de cada interfaz (solo module) → id de la interfaz
 */
export interface Ids2 {
  [k: string]: string;
}
