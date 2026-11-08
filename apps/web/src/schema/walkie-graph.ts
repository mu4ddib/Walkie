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
  /**
   * Contrato (api)
   */
  http?: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path?: string;
    request?: {};
    responses?: {
      [k: string]: {};
    };
  };
  /**
   * Elemento del catálogo de la app (ref)
   */
  catalogId?: string;
  /**
   * Feature destino de la misma app (portal); en un portal, title guarda su último nombre conocido
   */
  targetFeatureId?: string;
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
