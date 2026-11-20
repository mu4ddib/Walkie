/* Generado desde packages/schema/walkie-discovery-apply-result.schema.json. No editar a mano: `pnpm gen:schema`. */

export type Node = {
  /**
   * UUID v7 generado en el cliente
   */
  id: string;
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
    /**
     * Items: UUID v7 generado en el cliente
     */
    ruleIds?: string[];
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
    /**
     * UUID v7 generado en el cliente
     */
    id: string;
    label: string;
  }[];
  http?: Http1;
  database?: Database1;
  resource?: Resource1;
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
 * Resultado de walkie-discovery-apply (spec walkie-live, ADR-0012): con dryRun, la vista previa (status planned, nada escrito); sin él, lo que quedó escrito. unchanged lista lo que las operaciones no tocan a propósito, para que la vista previa diga también qué no cambia.
 */
export interface WalkieDiscoveryApplyResultV0 {
  applyId: string;
  dryRun: boolean;
  /**
   * planned: vista previa; completed: todo escrito; compensated: falló a mitad y se deshizo lo creado que nadie había tocado (bitácora, ADR-0012); lo que no se pudo deshacer sin perder un cambio queda y lo dice un aviso compensation-kept
   */
  status: 'planned' | 'completed' | 'compensated';
  created: {
    /**
     * Identidad estable entre análisis: sale de lo que define al componente, nunca de líneas ni de la ruta del archivo donde está (ADR-0014). api:<MÉTODO> <ruta normalizada> (parámetros como {}), service:<nombre>, database:<motor>/<nombre>, resource:<subtipo>/<nombre>, screen:<ámbito de la app>:<ruta normalizada>, module:<nombre>, feature:<ámbito de la app>:<nombre> (formatVersion 1; en la 0, screen:<ruta> y feature:<nombre>, que siguen siendo válidas en los registros de la API: un vínculo decidido antes conserva su clave). DiscoveryKeys (Walkie.Shared) las arma
     */
    entityKey: string;
    target: Target;
    /**
     * En un módulo o una feature: las claves de las cajas de su lienzo inicial (pantallas, APIs y módulos)
     *
     * Items: Identidad estable entre análisis: sale de lo que define al componente, nunca de líneas ni de la ruta del archivo donde está (ADR-0014). api:<MÉTODO> <ruta normalizada> (parámetros como {}), service:<nombre>, database:<motor>/<nombre>, resource:<subtipo>/<nombre>, screen:<ámbito de la app>:<ruta normalizada>, module:<nombre>, feature:<ámbito de la app>:<nombre> (formatVersion 1; en la 0, screen:<ruta> y feature:<nombre>, que siguen siendo válidas en los registros de la API: un vínculo decidido antes conserva su clave). DiscoveryKeys (Walkie.Shared) las arma
     */
    includes?: string[];
    item?: WalkieCatalogItemV0;
    canvas?: Canvas;
  }[];
  linked: {
    /**
     * Identidad estable entre análisis: sale de lo que define al componente, nunca de líneas ni de la ruta del archivo donde está (ADR-0014). api:<MÉTODO> <ruta normalizada> (parámetros como {}), service:<nombre>, database:<motor>/<nombre>, resource:<subtipo>/<nombre>, screen:<ámbito de la app>:<ruta normalizada>, module:<nombre>, feature:<ámbito de la app>:<nombre> (formatVersion 1; en la 0, screen:<ruta> y feature:<nombre>, que siguen siendo válidas en los registros de la API: un vínculo decidido antes conserva su clave). DiscoveryKeys (Walkie.Shared) las arma
     */
    entityKey: string;
    target: Target;
  }[];
  /**
   * Items: Identidad estable entre análisis: sale de lo que define al componente, nunca de líneas ni de la ruta del archivo donde está (ADR-0014). api:<MÉTODO> <ruta normalizada> (parámetros como {}), service:<nombre>, database:<motor>/<nombre>, resource:<subtipo>/<nombre>, screen:<ámbito de la app>:<ruta normalizada>, module:<nombre>, feature:<ámbito de la app>:<nombre> (formatVersion 1; en la 0, screen:<ruta> y feature:<nombre>, que siguen siendo válidas en los registros de la API: un vínculo decidido antes conserva su clave). DiscoveryKeys (Walkie.Shared) las arma
   */
  rejected: string[];
  /**
   * Items: Identidad estable entre análisis: sale de lo que define al componente, nunca de líneas ni de la ruta del archivo donde está (ADR-0014). api:<MÉTODO> <ruta normalizada> (parámetros como {}), service:<nombre>, database:<motor>/<nombre>, resource:<subtipo>/<nombre>, screen:<ámbito de la app>:<ruta normalizada>, module:<nombre>, feature:<ámbito de la app>:<nombre> (formatVersion 1; en la 0, screen:<ruta> y feature:<nombre>, que siguen siendo válidas en los registros de la API: un vínculo decidido antes conserva su clave). DiscoveryKeys (Walkie.Shared) las arma
   */
  reset: string[];
  /**
   * Elementos de Walkie que las operaciones no modifican (lienzos existentes que usan lo vinculado, elementos vinculados)
   */
  unchanged: Target[];
  /**
   * Avisos para la persona, ej. inferred (Walkie lo dedujo), logical-database (un modelo de EF, no una base física confirmada), to-complete (campos sin evidencia que quedan vacíos), same-title (ya hay uno con el mismo nombre), target-kept (restablecer no cambia el elemento), compensated, compensation-kept, ambiguous-api (una llamada a una API que publican varios servicios no se conecta) y omitted (partes del hallazgo que no entran al lienzo)
   */
  warnings: {
    code: string;
    message: string;
    /**
     * Identidad estable entre análisis: sale de lo que define al componente, nunca de líneas ni de la ruta del archivo donde está (ADR-0014). api:<MÉTODO> <ruta normalizada> (parámetros como {}), service:<nombre>, database:<motor>/<nombre>, resource:<subtipo>/<nombre>, screen:<ámbito de la app>:<ruta normalizada>, module:<nombre>, feature:<ámbito de la app>:<nombre> (formatVersion 1; en la 0, screen:<ruta> y feature:<nombre>, que siguen siendo válidas en los registros de la API: un vínculo decidido antes conserva su clave). DiscoveryKeys (Walkie.Shared) las arma
     */
    entityKey?: string;
  }[];
  /**
   * Pantallas que se incorporan a una feature existente (attach, ADR-0018): lo que ya tiene su lienzo y lo que se agrega. Sin attach, no viene
   */
  attached?: {
    /**
     * Identidad estable entre análisis: sale de lo que define al componente, nunca de líneas ni de la ruta del archivo donde está (ADR-0014). api:<MÉTODO> <ruta normalizada> (parámetros como {}), service:<nombre>, database:<motor>/<nombre>, resource:<subtipo>/<nombre>, screen:<ámbito de la app>:<ruta normalizada>, module:<nombre>, feature:<ámbito de la app>:<nombre> (formatVersion 1; en la 0, screen:<ruta> y feature:<nombre>, que siguen siendo válidas en los registros de la API: un vínculo decidido antes conserva su clave). DiscoveryKeys (Walkie.Shared) las arma
     */
    entityKey: string;
    target: Target;
    /**
     * La versión del lienzo que se vio: confirmar la manda; si cambió, 409
     */
    canvasVersion: number;
    /**
     * Lo que el lienzo ya tiene y no cambia
     */
    existing: {
      nodes: number;
      edges: number;
      tours?: number;
    };
    canvas: Canvas1;
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
/**
 * Solo en un elemento del catálogo (tarea 6): el elemento tal como queda —o quedaría, en la vista previa— con el id que dio el cliente y version 1. Sale del hallazgo sin agregar nada que el análisis no vio
 */
export interface WalkieCatalogItemV0 {
  /**
   * Generado por la API
   */
  id: string;
  appId: string;
  type: 'api' | 'service' | 'database' | 'resource';
  title: string;
  description?: string;
  http?: Http;
  database?: Database;
  resource?: Resource;
  /**
   * Dónde corre (solo type service)
   */
  runtime?: 'container' | 'vm' | 'serverless' | 'managed' | 'other';
  /**
   * Versión para concurrencia optimista
   */
  version: number;
}
/**
 * Contrato (solo type api)
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
 * Estructura (solo type database)
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
 * Subtipo y detalles (solo type resource; obligatorio en él)
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
/**
 * Solo en un módulo o una feature (tarea 9): su lienzo inicial
 */
export interface Canvas {
  nodes: {
    key: string;
    type: 'screen' | 'ref' | 'module' | 'portal';
    title: string;
    /**
     * Solo screen: su ruta (va en la descripción de la caja)
     */
    route?: string;
    /**
     * Solo ref: el elemento del catálogo (decidido o creado en esta solicitud)
     */
    catalogId?: string;
    /**
     * Solo module: el módulo existente que ofrece la interfaz
     */
    moduleId?: string;
    /**
     * Solo portal: la feature donde ya está la pantalla a la que navega (ADR-0018)
     */
    targetFeatureId?: string;
    /**
     * Solo en attach: la caja que ya está en el lienzo y se reutiliza (no se agrega ni se mueve)
     */
    existing?: string;
  }[];
  edges: {
    key: string;
    from: string;
    to: string;
    kind: 'navigation' | 'request';
    operation: 'navigation' | 'http.request';
    toInterface?: InterfaceRef;
  }[];
  interfaces: {
    key: string;
    name: string;
    kind: 'provides' | 'event' | 'requires';
    node: string;
  }[];
  /**
   * Lo que no entra y por qué: screen-rejected, screen-decided, api-undecided, api-rejected, api-target-missing, ambiguous-api
   */
  omitted: {
    key: string;
    code: string;
    message: string;
  }[];
  graph?: WalkieCanvasGraphV0;
}
/**
 * Interfaz del módulo de destino que ofrece esa API
 */
export interface InterfaceRef {
  /**
   * UUID v7 generado en el cliente
   */
  id: string;
  name: string;
}
/**
 * Con los ids y las posiciones de la solicitud: el grafo tal como se guarda (versión 0 antes de guardar)
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
export interface Http1 {
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
/**
 * Estructura de una base de datos (nodo database o elemento del catálogo)
 */
export interface Database1 {
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
export interface Resource1 {
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
  /**
   * UUID v7 generado en el cliente
   */
  id: string;
  /**
   * UUID v7 generado en el cliente
   */
  from: string;
  /**
   * UUID v7 generado en el cliente
   */
  to: string;
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
  fromInterface?: InterfaceRef1;
  toInterface?: InterfaceRef2;
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
export interface InterfaceRef1 {
  /**
   * UUID v7 generado en el cliente
   */
  id: string;
  name: string;
}
/**
 * Interfaz del módulo de destino (solo si to es un nodo module); sin ella, llega al módulo completo
 */
export interface InterfaceRef2 {
  /**
   * UUID v7 generado en el cliente
   */
  id: string;
  name: string;
}
/**
 * Recorrido guiado por pasos: sobre nodos (modo tour) o sobre conexiones (recorrido de un flujo)
 */
export interface Tour {
  /**
   * UUID v7 generado en el cliente
   */
  id: string;
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
      /**
       * UUID v7 generado en el cliente
       */
      from: string;
      /**
       * UUID v7 generado en el cliente
       */
      to: string;
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
  /**
   * UUID v7 generado en el cliente
   */
  id: string;
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
  /**
   * UUID v7 generado en el cliente
   */
  id: string;
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
/**
 * Borrador del lienzo inicial de un módulo o una feature (spec walkie-live, tarea 9): solo lo que el análisis observó y una persona ya decidió. Las claves son de este borrador (de hallazgos, de relaciones walkie-module:<id> para la caja de un módulo existente o walkie-feature:<id> para un portal a una feature); la solicitud les da ids y posiciones. Sin respuestas, códigos ni pasos internos que el análisis no vio
 */
export interface Canvas1 {
  nodes: {
    key: string;
    type: 'screen' | 'ref' | 'module' | 'portal';
    title: string;
    /**
     * Solo screen: su ruta (va en la descripción de la caja)
     */
    route?: string;
    /**
     * Solo ref: el elemento del catálogo (decidido o creado en esta solicitud)
     */
    catalogId?: string;
    /**
     * Solo module: el módulo existente que ofrece la interfaz
     */
    moduleId?: string;
    /**
     * Solo portal: la feature donde ya está la pantalla a la que navega (ADR-0018)
     */
    targetFeatureId?: string;
    /**
     * Solo en attach: la caja que ya está en el lienzo y se reutiliza (no se agrega ni se mueve)
     */
    existing?: string;
  }[];
  edges: {
    key: string;
    from: string;
    to: string;
    kind: 'navigation' | 'request';
    operation: 'navigation' | 'http.request';
    toInterface?: InterfaceRef;
  }[];
  interfaces: {
    key: string;
    name: string;
    kind: 'provides' | 'event' | 'requires';
    node: string;
  }[];
  /**
   * Lo que no entra y por qué: screen-rejected, screen-decided, api-undecided, api-rejected, api-target-missing, ambiguous-api
   */
  omitted: {
    key: string;
    code: string;
    message: string;
  }[];
  graph?: WalkieCanvasGraphV0;
}
