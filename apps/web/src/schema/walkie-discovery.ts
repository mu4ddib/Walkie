/* Generado desde packages/schema/walkie-discovery.schema.json. No editar a mano: `pnpm gen:schema`. */

export type Entity = {
  key: EntityKey;
  kind: EntityKind;
  /**
   * Título propuesto (los mismos límites que el catálogo)
   */
  title: string;
  description?: string;
  /**
   * Id de una tecnología del manifest
   */
  technology?: string;
  basis: Basis;
  confidence: Confidence;
  fingerprint: Fingerprint;
  /**
   * Solo en lo inferido: claves de las entidades de las que se dedujo
   *
   * @minItems 1
   */
  derivedFrom?: [EntityKey, ...EntityKey[]];
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
   * App del front a la que pertenece (solo screen y feature; obligatorio en ellas): es parte de su clave
   */
  app?: string;
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
 * Identidad estable entre análisis: sale de lo que define al componente, nunca de líneas ni de la ruta del archivo donde está (ADR-0014). api:<MÉTODO> <ruta normalizada> (parámetros como {}), service:<nombre>, database:<motor>/<nombre>, resource:<subtipo>/<nombre>, screen:<ámbito de la app>:<ruta normalizada>, module:<nombre>, feature:<ámbito de la app>:<nombre> (formatVersion 1; en la 0, screen:<ruta> y feature:<nombre>, que siguen siendo válidas en los registros de la API: un vínculo decidido antes conserva su clave). DiscoveryKeys (Walkie.Shared) las arma
 */
export type EntityKey = string;
/**
 * api, service, database y resource se proponen como elementos del catálogo; screen como pantalla de una feature; module como módulo compartido (ADR-0010) y feature como feature con su lienzo inicial
 */
export type EntityKind = 'api' | 'service' | 'database' | 'resource' | 'screen' | 'module' | 'feature';
/**
 * observed: declarado tal cual en el código o la configuración (un archivo OpenAPI, un MapGet con ruta literal, un servicio de compose); inferred: deducido por convención o heurística (un módulo por proyecto, una feature por pantalla). Ninguno es una confirmación
 */
export type Basis = 'observed' | 'inferred';
/**
 * high: sin ambigüedad (solo en lo observado); medium: convención clara; low: heurística. La revisión nunca aplica sola lo que no es high
 */
export type Confidence = 'high' | 'medium' | 'low';
/**
 * SHA-256 del contenido de la entidad en JSON canónico (claves ordenadas, sin espacios), sin key, fingerprint, basis, confidence, derivedFrom ni evidence: cambia si cambia lo que describe, no si se mueve de línea (ADR-0014, DiscoveryFingerprint)
 */
export type Fingerprint = string;
/**
 * Id de una evidencia en este archivo (el analizador lo deriva de detector, ruta y ancla)
 */
export type EvidenceId = string;
/**
 * <kind>:<from>-><to>
 */
export type RelationKey = string;
/**
 * calls: una pantalla o servicio llama a una api; reads/writes: un servicio usa una base, o una api lee o escribe la base de su DbContext (ADR-0016); publishes/consumes: mensajería; exposes: un servicio publica una api; depends-on: dependencia declarada (compose, referencia de proyecto); navigates: de una pantalla a otra; contains: un servicio contiene un módulo, o una app de front contiene sus pantallas (ADR-0016)
 */
export type RelationKind =
  'calls' | 'reads' | 'writes' | 'publishes' | 'consumes' | 'exposes' | 'depends-on' | 'navigates' | 'contains';
/**
 * Detector que produjo el hallazgo (ej. openapi, compose, csproj, package-json, aspnetcore-endpoints, efcore, react-router, angular-router)
 */
export type DetectorId = string;
/**
 * Ruta relativa a la raíz del proyecto, con /: nunca absoluta, sin .. ni \
 */
export type RelativePath = string;

/**
 * discovery.json de un .walkiepack (spec walkie-live, ADR-0013 y ADR-0014): lo que el análisis estático observó o infirió (entidades y relaciones) y la evidencia que lo respalda. Toda entidad y relación cita al menos una evidencia. No hay confirmaciones: las decide una persona en Walkie (walkie-discovery-binding). Orden estable por clave (entidades, relaciones) e id (evidencia) y sin fechas: el mismo árbol da el mismo archivo. Lo que el schema no expresa (claves e ids únicos, referencias que existen, fingerprints, orden, claves normalizadas) lo valida DiscoveryPackValidator (Walkie.Shared).
 */
export interface WalkieDiscoveryV1 {
  entities: Entity[];
  relations: Relation[];
  evidence: Evidence[];
}
/**
 * Contrato descubierto (solo api; el mismo $defs que el catálogo y el lienzo)
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
  key: RelationKey;
  kind: RelationKind;
  from: EntityKey;
  to: EntityKey;
  basis: Basis;
  confidence: Confidence;
  /**
   * @minItems 1
   */
  evidence: [EvidenceId, ...EvidenceId[]];
}
export interface Evidence {
  id: EvidenceId;
  detector: DetectorId;
  path: RelativePath;
  /**
   * Ancla estable dentro del archivo (ej. PedidosEndpoints.MapPedidos, services.db, paths./api/pedidos/{pedidoId}.get): sobrevive a que cambien las líneas
   */
  symbol?: string;
  /**
   * Informativas: cambian con cualquier edición y no forman parte de ninguna identidad
   */
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
   * Fragmento del código, solo si el manifest dice includeSnippets; nunca un archivo completo
   */
  snippet?: string;
}
