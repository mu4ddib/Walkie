/* Generado desde packages/schema/walkie-graph.schema.json. No editar a mano: `pnpm gen:schema`. */

export type Node = {
  id: Id;
  type: 'actor' | 'screen' | 'rule' | 'api' | 'service' | 'database' | 'resource' | 'ref' | 'portal' | 'module';
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
  resource?: Resource;
  /**
   * Dónde corre (solo service)
   */
  runtime?: 'container' | 'vm' | 'serverless' | 'managed' | 'other';
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
  /**
   * Módulo compartido de la misma app (module, ADR-0010); en él, title guarda su último nombre conocido
   */
  moduleId?: string;
  /**
   * Presentación local de la caja de un módulo (solo module): false oculta esa parte en este lienzo
   */
  display?: {
    description?: boolean;
    interfaces?: boolean;
  };
};
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
   * Solo en el lienzo de un módulo (spec modulos-compartidos, ADR-0010): mapa id -> interfaz expuesta, el punto por el que las features se conectan al módulo
   */
  interfaces?: {
    [k: string]: ModuleInterface;
  };
  /**
   * Solo en el lienzo de un módulo: interfaces quitadas -> a qué interfaz pasan sus conexiones (to) o, sin to, al módulo completo. Las features no se reescriben: resuelven sus conexiones con esto al leer el módulo. Una interfaz quitada sin entrada deja sus conexiones pendientes
   */
  interfaceRedirects?: {
    [k: string]: {
      /**
       * UUID v7 generado en el cliente
       */
      to?: string;
    };
  };
  /**
   * Los grupos guardan su grupo padre en parentId y las notas su grupo en groupId. Sin este campo (lienzos anteriores) la jerarquía se infiere por contención al abrir el lienzo
   */
  groupNesting?: 'explicit';
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
  /**
   * Modelo de datos: relacional (tablas), documental (colecciones), clave-valor, columnar, grafo, búsqueda o series de tiempo
   */
  model?: 'relational' | 'document' | 'key-value' | 'wide-column' | 'graph' | 'search' | 'time-series';
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
/**
 * Qué recurso de infraestructura es (solo resource)
 */
export interface Resource {
  /**
   * storage: almacenamiento de objetos (bucket); function: función serverless; queue: cola; topic: tópico o bus de eventos; cache; cdn; gateway: balanceador o API gateway; secret: secreto o configuración; scheduler: programador (cron); custom: label dice qué es
   */
  kind: 'storage' | 'function' | 'queue' | 'topic' | 'cache' | 'cdn' | 'gateway' | 'secret' | 'scheduler' | 'custom';
  /**
   * Nombre del subtipo personalizado (solo con kind custom), ej. Step Functions
   */
  label?: string;
  provider?: 'aws' | 'azure' | 'gcp' | 'on-premise' | 'other';
  /**
   * Nombre del recurso en su plataforma (ej. el del bucket o la cola)
   */
  name?: string;
  /**
   * Configuración relevante como pares clave/valor (ej. retención: 7 días, runtime: node20)
   *
   * @maxItems 30
   */
  details?: {
    key: string;
    value: string;
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
  /**
   * Operación de la interacción (spec interacciones, ADR-0011): fuente de verdad del verbo, los retornos y los campos. Sin ella, la conexión se interpreta por su kind (lienzos anteriores). En un retorno no va: lo define la operación a la que responde
   */
  operation?:
    | 'http.request'
    | 'service.invoke'
    | 'db.query'
    | 'db.insert'
    | 'db.update'
    | 'db.delete'
    | 'db.write'
    | 'db.procedure'
    | 'cache.get'
    | 'cache.set'
    | 'cache.delete'
    | 'storage.read'
    | 'storage.write'
    | 'storage.list'
    | 'storage.delete'
    | 'message.publish'
    | 'message.deliver'
    | 'message.consume'
    | 'message.reply'
    | 'stream.open'
    | 'stream.send'
    | 'stream.receive'
    | 'stream.close'
    | 'relation.uses'
    | 'relation.depends'
    | 'navigation'
    | 'custom';
  /**
   * Nombre de la operación personalizada (solo con operation custom)
   */
  customOperation?: string;
  /**
   * Patrón de intercambio: solicitud/respuesta, envío unidireccional, publicación/suscripción o streaming. Sin él, el de la operación
   */
  pattern?: 'request-response' | 'one-way' | 'pub-sub' | 'stream';
  /**
   * Tecnología o protocolo, ej. HTTP, gRPC, PostgreSQL, Redis, AMQP
   */
  technology?: string;
  exchange?: Exchange;
  result?: Result;
  /**
   * Retorno que es un mensaje de una secuencia (stream) y no un escenario alternativo
   */
  stream?: boolean;
  /**
   * UUID v7 generado en el cliente
   */
  correlatesWith?: string;
  fromInterface?: InterfaceRef;
  toInterface?: InterfaceRef1;
}
/**
 * Detalle técnico de una interacción (spec interacciones): lo que corresponda según su operación
 */
export interface Exchange {
  description?: string;
  /**
   * Query, procedimiento, comando o descripción del acceso (ej. vía ORM)
   */
  command?: {
    language: 'sql' | 'procedure' | 'command' | 'orm' | 'text';
    text: string;
  };
  /**
   * @maxItems 50
   */
  params?: {
    name: string;
    type?: string;
    example?: string;
  }[];
  /**
   * @maxItems 50
   */
  entities?: string[];
  /**
   * Contrato del resultado esperado
   */
  result?: {
    description?: string;
    /**
     * @maxItems 100
     */
    fields?: Field[];
    example?: string;
  };
  /**
   * @maxItems 50
   */
  errors?: {
    code: string;
    description?: string;
  }[];
  /**
   * Cuánto espera quien llama antes de darlo por perdido
   */
  timeoutMs?: number;
  /**
   * Cuántas veces reintenta quien llama tras un timeout (la previsualización simula cada intento)
   */
  retries?: number;
  /**
   * Política de reintentos documentada
   */
  retry?: string;
  /**
   * Cola, tópico o canal
   */
  channel?: string;
  /**
   * Tipo o nombre del mensaje
   */
  message?: string;
  /**
   * Clave que asocia una respuesta asíncrona
   */
  correlationKey?: string;
  /**
   * Canal por el que llega la respuesta asíncrona
   */
  replyChannel?: string;
  /**
   * Confirmaciones configuradas: del broker al productor y del consumidor al broker
   *
   * @maxItems 2
   */
  acks?: [] | ['broker' | 'consumer'] | ['broker' | 'consumer', 'broker' | 'consumer'];
  grpc?: {
    service?: string;
    method?: string;
  };
}
/**
 * Qué es un retorno (solo en una conexión que responde a otra): éxito, resultado vacío, filas afectadas, confirmación, hit o miss de caché, contenido, error, mensaje de un stream o fin
 */
export interface Result {
  type: 'success' | 'empty' | 'affected' | 'ack' | 'nack' | 'hit' | 'miss' | 'content' | 'error' | 'message' | 'end';
  /**
   * Código del retorno fuera de HTTP (ej. SQLSTATE, estado gRPC); el HTTP va en status
   */
  code?: string;
  description?: string;
  /**
   * @maxItems 100
   */
  fields?: Field[];
}
/**
 * Interfaz del módulo de origen (solo si from es un nodo module); sin ella, sale del módulo completo
 */
export interface InterfaceRef {
  id: Id;
  name: string;
}
/**
 * Interfaz del módulo de destino (solo si to es un nodo module); sin ella, llega al módulo completo
 */
export interface InterfaceRef1 {
  id: Id;
  name: string;
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
    /**
     * Ocurre a la vez que el paso anterior (ej. entregas a varios consumidores); sin él, en orden
     */
    parallel?: boolean;
    /**
     * Quien espera no recibe retorno: el paso termina en timeout (solo en pasos de conexión)
     */
    timeout?: boolean;
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
/**
 * Interfaz de un módulo: punto de conexión vinculado a una caja de su lienzo; su contrato es el de esa caja
 */
export interface ModuleInterface {
  /**
   * UUID v7 generado en el cliente
   */
  id: string;
  name: string;
  description?: string;
  /**
   * provides: API u operación que el módulo ofrece; event: evento que emite o recibe; requires: dependencia que necesita de fuera
   */
  kind: 'provides' | 'event' | 'requires';
  /**
   * UUID v7 generado en el cliente
   */
  nodeId: string;
  /**
   * UUID v7 generado en el cliente
   */
  tourId?: string;
}
