/* Generado desde packages/schema/walkie-app-map.schema.json. No editar a mano: `pnpm gen:schema`. */

/**
 * Mapa de una app (spec mapa-de-la-app): sus features, cómo se conectan por portales, qué elementos del catálogo usa cada una y la distribución guardada. Se arma con el último lienzo guardado de cada feature; los nombres y descripciones vienen de la lista de features.
 */
export interface WalkieAppMapV0 {
  appId: string;
  /**
   * Todas las features de la app, tengan o no lienzo guardado
   */
  features: {
    id: string;
    /**
     * Pantallas del lienzo
     */
    screens: number;
    /**
     * APIs del lienzo (propias o del catálogo)
     */
    apis: number;
    /**
     * Tours guiados
     */
    tours: number;
    /**
     * Recorridos
     */
    flows: number;
    /**
     * Portales sin destino o con un destino que ya no es de la app
     */
    unresolvedPortals: number;
  }[];
  /**
   * Un elemento por par de features (origen → destino) con los portales que lo forman
   */
  links: {
    from: string;
    to: string;
    /**
     * @minItems 1
     */
    portals: [
      {
        /**
         * Nodo portal en el lienzo de la feature de origen
         */
        nodeId: string;
        /**
         * Títulos de las cajas que se conectan al portal (desde dónde se llega)
         */
        sources: string[];
      },
      ...{
        /**
         * Nodo portal en el lienzo de la feature de origen
         */
        nodeId: string;
        /**
         * Títulos de las cajas que se conectan al portal (desde dónde se llega)
         */
        sources: string[];
      }[]
    ];
  }[];
  /**
   * Elementos del catálogo usados en lienzos de la app y por qué features
   */
  catalog: {
    itemId: string;
    type: 'api' | 'service' | 'database';
    title: string;
    /**
     * @minItems 1
     */
    features: [string, ...string[]];
  }[];
  layout: Layout;
}
/**
 * Distribución guardada del mapa. version 0 y sin posiciones: nunca se guardó (se distribuye sola)
 */
export interface Layout {
  /**
   * Concurrencia optimista: un guardado con versión vieja responde 409
   */
  version: number;
  /**
   * Clave: id de feature, o catalog:<id> para un elemento del catálogo -> posición en el mapa
   */
  positions: {
    [k: string]: {
      x: number;
      y: number;
    };
  };
}
