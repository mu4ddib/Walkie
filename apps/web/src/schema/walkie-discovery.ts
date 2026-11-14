/* Generado desde packages/schema/walkie-discovery.schema.json. No editar a mano: `pnpm gen:schema`. */

export type Entity = {
  key: EntityKey;
  /**
   * api, service, database y resource se proponen como elementos del catálogo; screen como pantalla de una feature; module como módulo compartido (ADR-0010) y feature como feature con su lienzo inicial
   */
  kind: 'api' | 'service' | 'database' | 'resource' | 'screen' | 'module' | 'feature';
  /**
   * Título propuesto (los mismos límites que el catálogo)
   */
  title: string;
  description?: string;
  /**
   * Id de una tecnología del manifest (ej. aspnetcore)
   */
  technology?: string;
  confidence?: Confidence;
  http?: Http;
  database?: Database;
  resource?: Resource;
  /**
   * Dónde corre (solo service)
   */
  runtime?: 'container' | 'vm' | 'serverless' | 'managed' | 'other';
  /**
   * Ruta de la pantalla en el front, ej. /apps/:appId (solo screen)
   */
  route?: string;
  /**
   * Claves de las entidades que agrupa (solo module y feature)
   */
  members?: EntityKey[];
  /**
   * Interfaces propuestas del módulo (solo module; ADR-0010): cada una la implementa una entidad de members
   */
  interfaces?: {
    name: string;
    kind: 'provides' | 'event' | 'requires';
    entity: EntityKey;
  }[];
  /**
   * @minItems 1
   */
  evidence: [EvidenceId, ...EvidenceId[]];
};
/**
 * Clave estable y determinista: el mismo componente da la misma clave en cada análisis de la fuente (ej. api:GET /api/apps/{appId}, service:Walkie.Api, database:postgres/walkie). Los vínculos de ADR-0012 la usan para reconocerlo entre análisis
 */
export type EntityKey = string;
/**
 * high: declarado tal cual (un archivo OpenAPI, un MapGet con ruta literal); medium: deducido de una convención (un controller con [Route]); low: heurística (un nombre parecido). La revisión nunca aplica sola lo que no es high
 */
export type Confidence = 'high' | 'medium' | 'low';
/**
 * Id de una evidencia en este archivo (el CLI lo deriva del contenido, ej. un hash corto)
 */
export type EvidenceId = string;
/**
 * Detector que produjo el hallazgo (ej. openapi, compose, csproj, package-json, aspnetcore-endpoints, efcore, react-router, angular-router)
 */
export type DetectorId = string;
/**
 * Ruta relativa a la raíz del proyecto, con /: nunca absoluta, sin .. ni \
 */
export type RelativePath = string;

/**
 * discovery.json de un .walkiepack (spec walkie-live, ADR-0013): lo que el análisis estático descubrió (entidades y relaciones) y la evidencia que lo respalda. Toda entidad y relación cita al menos una evidencia; ninguna se inventa. Orden estable (por clave o id) y sin fechas: el mismo árbol da el mismo archivo. Lo que el schema no expresa lo valida la API: claves e ids únicos, evidence/from/to/members/interfaces que existen, snippet solo con includeSnippets del manifest y stats que coinciden.
 */
export interface WalkieDiscoveryV0 {
  entities: Entity[];
  relations: Relation[];
  evidence: Evidence[];
}
/**
 * Contrato descubierto (solo api)
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
 * Motor y estructura descubiertos (solo database)
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
 * Subtipo y detalles (solo resource; obligatorio en él)
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
export interface Relation {
  /**
   * Clave estable: <kind>:<from>-><to>
   */
  key: string;
  /**
   * calls: una pantalla o servicio llama a una api; reads/writes: un servicio usa una base; publishes/consumes: mensajería; exposes: un servicio publica una api; depends-on: dependencia declarada (compose, referencia de proyecto); navigates: de una pantalla a otra
   */
  kind: 'calls' | 'reads' | 'writes' | 'publishes' | 'consumes' | 'exposes' | 'depends-on' | 'navigates';
  from: EntityKey;
  to: EntityKey;
  confidence?: Confidence;
  /**
   * @minItems 1
   */
  evidence: [EvidenceId, ...EvidenceId[]];
}
export interface Evidence {
  id: EvidenceId;
  detector: DetectorId;
  path: RelativePath;
  lines?: {
    start: number;
    end: number;
  };
  confidence: Confidence;
  /**
   * Por qué el detector concluye esto (ej. «MapGet con ruta literal»)
   */
  note?: string;
  /**
   * Fragmento del código, solo si el manifest dice includeSnippets
   */
  snippet?: string;
}
