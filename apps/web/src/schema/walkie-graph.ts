/* Generado desde packages/schema/walkie-graph.schema.json. No editar a mano: `pnpm gen:schema`. */

/**
 * UUID v7 generado en el cliente
 */
export type Id = string;

/**
 * Grafo del lienzo de una feature. Fuente de verdad para web y API.
 */
export interface WalkieCanvasGraphV0 {
  schemaVersion: 0;
  /**
   * Versión para concurrencia optimista
   */
  version: number;
  /**
   * Mapa id -> nodo
   */
  nodes: {
    [k: string]: Node;
  };
  /**
   * Mapa id -> conexión
   */
  edges: {
    [k: string]: Edge;
  };
  /**
   * Mapa id de nodo -> posición (separado del contenido)
   */
  layout: {
    [k: string]: {
      x: number;
      y: number;
      w?: number;
      h?: number;
    };
  };
  tours?: {
    [k: string]: Tour;
  };
}
export interface Node {
  id: Id;
  type: 'actor' | 'screen' | 'rule' | 'api' | 'service' | 'database' | 'ref' | 'portal';
  title: string;
  description?: string;
  /**
   * Responsabilidades o notas (actor, pantalla, regla, servicio, portal)
   */
  notes?: string;
  /**
   * Imagen adjunta (solo screen); id de walkie-asset
   */
  assetId?: string;
  inputs?: {
    name: string;
    type: 'string' | 'number' | 'boolean' | 'date' | 'enum' | 'file';
    required?: boolean;
    /**
     * Opciones de un input enum (solo para type enum)
     */
    options?: string[];
    ruleIds?: Id[];
  }[];
  /**
   * Regla en lenguaje natural o pseudo-código (rule)
   */
  expression?: string;
  http?: Http;
  database?: Database;
  /**
   * Elemento del catálogo de la app (ref)
   */
  catalogId?: string;
  /**
   * Feature destino de la misma app (portal); en un portal, title guarda su último nombre conocido
   */
  targetFeatureId?: string;
}
/**
 * Contrato de una API (nodo api o elemento del catálogo)
 */
export interface Http {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path?: string;
  auth?: {
    type: 'none' | 'bearer' | 'apiKey' | 'basic' | 'oauth2' | 'mtls' | 'other';
    description?: string;
  };
  /**
   * Parámetros de ruta, query o header
   *
   * @maxItems 100
   */
  params?: {
    name: string;
    in: 'path' | 'query' | 'header';
    type?: string;
    required?: boolean;
    description?: string;
    example?: string;
  }[];
  request?: Body;
  /**
   * @maxItems 50
   */
  responses?: {
    status: number;
    /**
     * Qué significa; en errores, cuándo ocurre
     */
    description?: string;
    contentType?: string;
    /**
     * @maxItems 100
     */
    fields?: Field[];
    example?: string;
  }[];
}
export interface Body {
  /**
   * Ej. application/json
   */
  contentType?: string;
  /**
   * @maxItems 100
   */
  fields?: Field[];
  /**
   * Ejemplo (JSON u otro) como texto; no se valida contra los campos
   */
  example?: string;
}
/**
 * Campo de un request o response
 */
export interface Field {
  name: string;
  /**
   * Tipo libre: string, number, uuid, Cliente[]…
   */
  type?: string;
  required?: boolean;
  description?: string;
  /**
   * Valor de ejemplo
   */
  example?: string;
}
/**
 * Estructura de una base de datos (nodo database o elemento del catálogo)
 */
export interface Database {
  /**
   * Ej. PostgreSQL, Oracle, MongoDB
   */
  engine?: string;
  name?: string;
  /**
   * @maxItems 50
   */
  schemas?: string[];
  /**
   * @maxItems 200
   */
  tables?: {
    name: string;
    schema?: string;
    kind?: 'table' | 'collection' | 'view';
    description?: string;
    /**
     * @maxItems 200
     */
    fields?: {
      name: string;
      type?: string;
      key?: 'primary' | 'foreign' | 'unique';
      nullable?: boolean;
      description?: string;
    }[];
    /**
     * @maxItems 50
     */
    relations?: {
      field: string;
      /**
       * tabla.campo
       */
      references: string;
      description?: string;
    }[];
  }[];
}
export interface Edge {
  id: Id;
  from: Id;
  to: Id;
  kind: 'navigation' | 'request' | 'response' | 'uses' | 'reads' | 'writes';
  label?: string;
  /**
   * Condición, ej. código de respuesta 200 o 404
   */
  when?: string;
  notes?: string;
  /**
   * Acceso a datos de la interacción
   */
  data?: {
    operation?: 'read' | 'write';
    /**
     * @maxItems 50
     */
    entities?: string[];
  };
  /**
   * Ejemplo de payload de esta interacción; el contrato reutilizable vive en la API
   */
  example?: string;
}
/**
 * Recorrido guiado por pasos sobre los nodos del lienzo (modo tour)
 */
export interface Tour {
  id: Id;
  name: string;
  /**
   * En orden; cada paso centra y resalta su nodo
   */
  steps: {
    nodeId: Id;
    /**
     * Lo que el guía cuenta en el paso
     */
    note?: string;
  }[];
}
