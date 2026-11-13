/* Generado desde packages/schema/walkie-ai-context.schema.json. No editar a mano: `pnpm gen:schema`. */

/**
 * Contexto de una feature para darle a una IA antes de construir (spec exportar-e-importar, tarea 1): lo mismo que el Markdown «Contexto para IA», en estructura. Lo genera la API desde la última versión guardada del lienzo; no se importa (para reconstruir está el archivo .walkie).
 */
export interface WalkieAIContextV0 {
  format: 'walkie-ai-context';
  formatVersion: 0;
  app: {
    name: string;
  };
  feature: {
    id: string;
    name: string;
    /**
     * Propósito de la feature (su descripción en Walkie)
     */
    description?: string;
  };
  exportedAt: string;
  canvasVersion: number;
  /**
   * Nombres que usa el lienzo y qué es cada uno (cajas, grupos, tours y recorridos), en orden alfabético
   */
  glossary: {
    term: string;
    /**
     * Qué es, en palabras: «API», «Cola», «Grupo (backend)», «Recorrido»…
     */
    is: string;
    description?: string;
  }[];
  /**
   * Cada caja del lienzo con su id estable, su tipo efectivo (un componente del catálogo, el de su elemento) y su detalle completo
   */
  components: Component[];
  connections: Connection[];
  /**
   * Tours (guide: el guía presenta cajas) y recorridos (flow: conexiones en orden, de punta a punta)
   */
  flows: Flow[];
  /**
   * Reglas de negocio (nodos rule que no son decisiones) con los inputs que validan
   */
  rules: {
    id: string;
    title: string;
    expression?: string;
    validates: {
      screen: string;
      input: string;
    }[];
  }[];
  decisions: {
    id: string;
    question: string;
    condition?: string;
    branches: {
      label: string;
      /**
       * Títulos de los destinos de esa salida (vacío: sin destino)
       */
      to: string[];
    }[];
  }[];
  relations: {
    /**
     * Desde dónde se pasa a otra feature de la app
     */
    portals: {
      /**
       * Título del portal
       */
      from: string;
      /**
       * Nombre actual de la feature destino; null si no tiene o ya no existe
       */
      toFeature: string | null;
    }[];
    /**
     * Componentes del catálogo de la app que usa este lienzo (su definición es compartida con otros lienzos)
     */
    sharedComponents: {
      catalogId: string;
      title: string;
      type: string;
    }[];
  };
  /**
   * Módulos compartidos que usa el lienzo, a cualquier profundidad (spec modulos-compartidos): qué expone cada uno, qué contiene y cómo se conecta por dentro
   */
  modules?: Module[];
  /**
   * Vacíos detectados: lo que falta documentar, para que la IA pregunte en vez de inventar
   */
  gaps: {
    kind:
      | 'api-without-contract'
      | 'api-without-responses'
      | 'request-without-response'
      | 'operation-conflict'
      | 'response-without-status'
      | 'isolated-node'
      | 'branch-without-target'
      | 'broken-flow-step'
      | 'missing-catalog-item'
      | 'portal-without-target'
      | 'database-without-structure'
      | 'missing-module'
      | 'pending-interface';
    /**
     * Caja o conexión a la que se refiere
     */
    elementId?: string;
    message: string;
  }[];
}
export interface Component {
  id: string;
  /**
   * Tipo efectivo: actor, screen, rule, api, service, database, resource, portal (un ref, el de su elemento)
   */
  type: string;
  /**
   * Qué es, en palabras (en un recurso, su subtipo; en una regla, «Decisión» si lo es)
   */
  is: string;
  title: string;
  description?: string;
  notes?: string;
  /**
   * Ruta del grupo que lo contiene (ej. «AWS › Pagos»)
   */
  group?: string;
  /**
   * Si es un componente compartido del catálogo
   */
  catalogId?: string;
  http?: Http;
  database?: Database;
  resource?: Resource;
  /**
   * Dónde corre un servicio: contenedor, máquina virtual, serverless, servicio gestionado u otro
   */
  runtime?: 'container' | 'vm' | 'serverless' | 'managed' | 'other';
  expression?: string;
  inputs?: {
    name: string;
    type: string;
    required?: boolean;
    options?: string[];
    /**
     * Títulos de las reglas que lo validan
     */
    rules?: string[];
  }[];
  /**
   * Portal: nombre actual de la feature destino
   */
  targetFeature?: string | null;
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
 * Recurso de infraestructura (nodo resource o elemento del catálogo, spec nodos-de-infraestructura, ADR-0007): un subtipo de una lista cerrada o uno personalizado con nombre libre
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
export interface Connection {
  id: string;
  /**
   * Id de la caja de origen
   */
  from: string;
  /**
   * Id de la caja de destino
   */
  to: string;
  kind: string;
  /**
   * La conexión en palabras: «Login → API Auth (llama · POST /sesiones)»
   */
  text: string;
  label?: string;
  when?: string;
  /**
   * Etiqueta de la salida de la decisión de origen
   */
  branch?: string;
  status?: number;
  /**
   * Id de la solicitud a la que responde
   */
  replyTo?: string;
  /**
   * Interfaz del módulo de destino a la que llega (spec modulos-compartidos)
   */
  toInterface?: string;
  /**
   * Interfaz del módulo de origen de la que sale
   */
  fromInterface?: string;
  outcome?: string;
  notes?: string;
  /**
   * Operación de la conexión (spec interacciones): la fuente de verdad del verbo, ej. db.query
   */
  operation?: string;
  /**
   * Nombre de la operación, ej. «Consultar» o el de una personalizada
   */
  operationName?: string;
  pattern?: 'request-response' | 'one-way' | 'pub-sub' | 'stream';
  technology?: string;
  /**
   * Detalle técnico del intercambio, tal como está en el lienzo ($defs/exchange de walkie-graph)
   */
  exchange?: {};
  /**
   * Tipo y código de un retorno ($defs/result de walkie-graph)
   */
  result?: {};
  /**
   * El retorno es un mensaje de un flujo (secuencia), no una alternativa
   */
  stream?: boolean;
  /**
   * Id de la operación original de una respuesta asíncrona
   */
  correlatesWith?: string;
}
export interface Flow {
  id: string;
  name: string;
  kind: 'guide' | 'flow';
  steps: {
    n: number;
    /**
     * El paso en palabras: la caja o «Origen → Destino (tipo)»
     */
    text: string;
    nodeId?: string;
    edgeId?: string;
    note?: string;
    /**
     * La caja o la conexión del paso ya no existe
     */
    broken?: boolean;
    /**
     * Ocurre a la vez que el paso anterior (fan-out)
     */
    parallel?: boolean;
    /**
     * Quien espera no recibe retorno: el paso termina en timeout
     */
    timeout?: boolean;
  }[];
}
export interface Module {
  id: string;
  name: string;
  description?: string;
  interfaces: {
    id: string;
    name: string;
    kind: 'provides' | 'event' | 'requires';
    description?: string;
    /**
     * Título de la caja interna que la implementa
     */
    component?: string;
    method?: string;
    path?: string;
    /**
     * Nombre del recorrido interno que muestra qué pasa dentro
     */
    internalFlow?: string;
  }[];
  /**
   * Cajas del lienzo del módulo
   */
  components: {
    id: string;
    title: string;
    is: string;
  }[];
  /**
   * Conexiones internas en palabras
   */
  connections: string[];
  /**
   * Nombres de los módulos que contiene
   */
  contains: string[];
}
