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
   * Mapa id de nodo, grupo o nota adhesiva -> posición (separado del contenido)
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
  /**
   * Mapa id -> grupo de infraestructura; su caja (x, y, w, h) va en layout con el mismo id
   */
  groups?: {
    [k: string]: Group;
  };
  /**
   * Mapa id -> nota adhesiva (anotación del lienzo, no es un nodo del flujo); su posición va en layout con el mismo id
   */
  stickyNotes?: {
    [k: string]: StickyNote;
  };
  /**
   * Los grupos guardan su grupo padre en parentId y las notas su grupo en groupId. Sin este campo (lienzos anteriores) la jerarquía se infiere por contención al abrir el lienzo
   */
  groupNesting?: 'explicit';
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
   * Regla en lenguaje natural o pseudo-código (rule); en una decisión, la condición que se evalúa
   */
  expression?: string;
  /**
   * Modo de un nodo rule: ausente documenta una validación o restricción; decision es una bifurcación con salidas (branches)
   */
  mode?: 'decision';
  /**
   * Salidas de una decisión (solo rule con mode decision); una conexión las referencia con branch
   *
   * @maxItems 24
   */
  branches?: {
    id: Id;
    label: string;
  }[];
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
  /**
   * UUID v7 generado en el cliente
   */
  groupId?: string;
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
  /**
   * event: mensaje o evento asíncrono (cola, webhook)
   */
  kind: 'navigation' | 'request' | 'response' | 'event' | 'uses' | 'reads' | 'writes';
  label?: string;
  /**
   * Condición que activa la conexión (ej. la de una rama de decisión). El código de una respuesta va en status
   */
  when?: string;
  /**
   * UUID v7 generado en el cliente
   */
  branch?: string;
  /**
   * Código HTTP de una respuesta (kind response)
   */
  status?: number;
  /**
   * UUID v7 generado en el cliente
   */
  replyTo?: string;
  /**
   * Qué ocurre después de una respuesta
   */
  outcome?: string;
  /**
   * Datos propios de una solicitud (kind request): endpoint y parámetros de este paso. Sin method ni path, vale el contrato de la API destino
   */
  request?: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path?: string;
    /**
     * Parámetros o headers con el valor que lleva este paso
     *
     * @maxItems 50
     */
    params?: {
      name: string;
      in: 'path' | 'query' | 'header';
      value?: string;
    }[];
  };
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
 * Recorrido guiado por pasos: sobre nodos (modo tour) o sobre conexiones (recorrido de un flujo)
 */
export interface Tour {
  id: Id;
  name: string;
  /**
   * guide: tour (el guía presenta nodos; solo pasos nodeId). flow: recorrido (reproduce conexiones; pasos edgeId o removedEdge). Ausente en lienzos anteriores: flow si tiene algún paso de conexión
   */
  kind?: 'guide' | 'flow';
  /**
   * En orden; un paso centra y resalta su nodo, o recorre su conexión (origen, conexión, destino). Una conexión puede repetirse (reintento)
   */
  steps: ({
    [k: string]: unknown;
  } & {
    /**
     * UUID v7 generado en el cliente
     */
    id?: string;
    /**
     * UUID v7 generado en el cliente
     */
    nodeId?: string;
    /**
     * UUID v7 generado en el cliente
     */
    edgeId?: string;
    /**
     * Paso cuya conexión se eliminó: lo que se sabía de ella, para reemplazarla o quitar el paso
     */
    removedEdge?: {
      from: Id;
      to: Id;
      /**
       * event: mensaje o evento asíncrono (cola, webhook)
       */
      kind: 'navigation' | 'request' | 'response' | 'event' | 'uses' | 'reads' | 'writes';
      label?: string;
    };
    /**
     * Lo que el guía cuenta en el paso (descripción del paso)
     */
    note?: string;
  })[];
}
/**
 * Grupo de infraestructura del lienzo (frontend, backend…); no es una app ni una feature. Puede estar dentro de otro grupo (parentId)
 */
export interface Group {
  id: Id;
  title: string;
  kind: 'frontend' | 'backend' | 'external' | 'data' | 'network' | 'environment' | 'cloud' | 'custom';
  /**
   * Plegado; se conserva aunque un grupo padre se pliegue y despliegue
   */
  collapsed?: boolean;
  /**
   * UUID v7 generado en el cliente
   */
  parentId?: string;
}
/**
 * Nota adhesiva: texto libre sobre el lienzo, sin conexiones
 */
export interface StickyNote {
  id: Id;
  text: string;
  /**
   * UUID v7 generado en el cliente
   */
  groupId?: string;
}
