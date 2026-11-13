import type { Edge } from '../schema/walkie-graph';
import type { EdgeKind, NodeType } from '../store/graphStore';
import type { ResourceKind } from '../nodes/resourceMeta';

/**
 * Catálogo de operaciones de una conexión (spec interacciones, ADR-0011): la única definición de qué es cada operación
 * —su nombre, su verbo en el lienzo, a qué familia de componentes apunta, qué patrones admite, si tiene retorno y de qué
 * tipos, y qué secciones muestra el inspector—. Inspector, etiquetas, store, reproducción y export la leen de aquí.
 */

export type OperationId = NonNullable<Edge['operation']>;
export type Pattern = NonNullable<Edge['pattern']>;
export type ResultType = NonNullable<Edge['result']>['type'];
export type Exchange = NonNullable<Edge['exchange']>;

/** Familia de un componente, por su tipo (y subtipo de recurso): decide qué operaciones se sugieren. */
export type Family =
  | 'api'
  | 'service'
  | 'database'
  | 'cache'
  | 'storage'
  | 'messaging'
  | 'screen'
  | 'actor'
  | 'rule'
  | 'portal'
  | 'other';

/** Secciones del inspector que una operación necesita. */
export type Section = 'http' | 'grpc' | 'command' | 'params' | 'entities' | 'result' | 'errors' | 'policy' | 'messaging' | 'correlation';

export interface ReturnProfile {
  /** Acción del inspector: «Añadir resultado», «Añadir respuesta», «Añadir confirmación»… */
  action: string;
  /** Verbo del retorno en el lienzo. */
  verb: string;
  /** Tipos de retorno que tienen sentido (el primero es el de por defecto). */
  types: ResultType[];
}

export interface OperationProfile {
  id: OperationId;
  /** Nombre en el inspector y las sugerencias («Consultar»). */
  name: string;
  /** Verbo en el lienzo («consulta»). */
  verb: string;
  /** Grupo para el selector. */
  group: string;
  /** Patrones que admite; el primero es el de por defecto. */
  patterns: Pattern[];
  /** Retorno, si el intercambio lo tiene (con patrón de solicitud/respuesta o stream). */
  returns: ReturnProfile | null;
  sections: Section[];
  /** Acceso a datos que implica (para detectar contradicciones con el `data.operation` anterior). */
  access?: 'read' | 'write';
}

const RESULT = (types: ResultType[]): ReturnProfile => ({ action: 'Añadir resultado', verb: 'devuelve', types });
const QUERY: Section[] = ['command', 'params', 'entities', 'result', 'errors', 'policy'];
const WRITE: Section[] = ['command', 'params', 'entities', 'errors', 'policy'];

const PROFILES: OperationProfile[] = [
  {
    id: 'http.request',
    name: 'Enviar solicitud HTTP',
    verb: 'llama',
    group: 'API',
    patterns: ['request-response', 'one-way'],
    returns: { action: 'Añadir respuesta', verb: 'responde', types: ['success', 'error'] },
    sections: ['http', 'result', 'errors', 'policy'],
  },
  {
    id: 'service.invoke',
    name: 'Invocar',
    verb: 'invoca',
    group: 'Servicio o función',
    patterns: ['request-response', 'one-way'],
    returns: RESULT(['success', 'error']),
    sections: ['grpc', 'params', 'result', 'errors', 'policy'],
  },
  { id: 'db.query', name: 'Consultar', verb: 'consulta', group: 'Base de datos', patterns: ['request-response'], returns: RESULT(['success', 'empty', 'error']), sections: QUERY, access: 'read' },
  { id: 'db.write', name: 'Escribir', verb: 'escribe', group: 'Base de datos', patterns: ['request-response'], returns: RESULT(['affected', 'ack', 'error']), sections: WRITE, access: 'write' },
  { id: 'db.insert', name: 'Insertar', verb: 'inserta', group: 'Base de datos', patterns: ['request-response'], returns: RESULT(['affected', 'ack', 'error']), sections: WRITE, access: 'write' },
  { id: 'db.update', name: 'Actualizar', verb: 'actualiza', group: 'Base de datos', patterns: ['request-response'], returns: RESULT(['affected', 'error']), sections: WRITE, access: 'write' },
  { id: 'db.delete', name: 'Eliminar registros', verb: 'elimina', group: 'Base de datos', patterns: ['request-response'], returns: RESULT(['affected', 'error']), sections: WRITE, access: 'write' },
  {
    id: 'db.procedure',
    name: 'Ejecutar procedimiento',
    verb: 'ejecuta',
    group: 'Base de datos',
    patterns: ['request-response'],
    returns: RESULT(['success', 'empty', 'affected', 'error']),
    sections: QUERY,
  },
  { id: 'cache.get', name: 'Obtener de caché', verb: 'obtiene', group: 'Caché', patterns: ['request-response'], returns: RESULT(['hit', 'miss', 'error']), sections: ['command', 'params', 'result', 'errors', 'policy'], access: 'read' },
  { id: 'cache.set', name: 'Guardar en caché', verb: 'guarda', group: 'Caché', patterns: ['request-response', 'one-way'], returns: RESULT(['ack', 'error']), sections: ['command', 'params', 'errors', 'policy'], access: 'write' },
  { id: 'cache.delete', name: 'Eliminar de caché', verb: 'invalida', group: 'Caché', patterns: ['request-response', 'one-way'], returns: RESULT(['ack', 'error']), sections: ['command', 'params', 'errors', 'policy'], access: 'write' },
  { id: 'storage.read', name: 'Leer objeto', verb: 'lee', group: 'Almacenamiento', patterns: ['request-response'], returns: RESULT(['content', 'miss', 'error']), sections: ['params', 'result', 'errors', 'policy'], access: 'read' },
  { id: 'storage.write', name: 'Escribir objeto', verb: 'escribe', group: 'Almacenamiento', patterns: ['request-response', 'one-way'], returns: RESULT(['ack', 'error']), sections: ['params', 'errors', 'policy'], access: 'write' },
  { id: 'storage.list', name: 'Listar objetos', verb: 'lista', group: 'Almacenamiento', patterns: ['request-response'], returns: RESULT(['success', 'empty', 'error']), sections: ['params', 'result', 'errors', 'policy'], access: 'read' },
  { id: 'storage.delete', name: 'Eliminar objeto', verb: 'elimina', group: 'Almacenamiento', patterns: ['request-response', 'one-way'], returns: RESULT(['ack', 'error']), sections: ['params', 'errors', 'policy'], access: 'write' },
  {
    id: 'message.publish',
    name: 'Publicar',
    verb: 'publica',
    group: 'Mensajería',
    patterns: ['pub-sub', 'one-way'],
    returns: { action: 'Añadir confirmación del broker', verb: 'confirma', types: ['ack', 'nack'] },
    sections: ['messaging', 'errors'],
  },
  {
    id: 'message.deliver',
    name: 'Entregar',
    verb: 'entrega',
    group: 'Mensajería',
    patterns: ['pub-sub', 'one-way'],
    returns: { action: 'Añadir reconocimiento del consumidor', verb: 'reconoce', types: ['ack', 'nack'] },
    sections: ['messaging'],
  },
  {
    id: 'message.consume',
    name: 'Consumir',
    verb: 'consume',
    group: 'Mensajería',
    patterns: ['pub-sub', 'one-way'],
    returns: { action: 'Añadir reconocimiento', verb: 'reconoce', types: ['ack', 'nack'] },
    sections: ['messaging'],
  },
  {
    id: 'message.reply',
    name: 'Responder (asíncrono)',
    verb: 'responde',
    group: 'Mensajería',
    patterns: ['one-way'],
    returns: null,
    sections: ['messaging', 'correlation'],
  },
  {
    id: 'stream.open',
    name: 'Abrir flujo',
    verb: 'abre flujo',
    group: 'Streaming',
    patterns: ['stream'],
    returns: { action: 'Añadir mensaje del flujo', verb: 'emite', types: ['message', 'end', 'error'] },
    sections: ['grpc', 'messaging', 'params', 'errors', 'policy'],
  },
  { id: 'stream.send', name: 'Enviar mensaje al flujo', verb: 'envía', group: 'Streaming', patterns: ['stream'], returns: null, sections: ['messaging'] },
  { id: 'stream.receive', name: 'Recibir mensaje del flujo', verb: 'recibe', group: 'Streaming', patterns: ['stream'], returns: null, sections: ['messaging'] },
  { id: 'stream.close', name: 'Finalizar flujo', verb: 'cierra', group: 'Streaming', patterns: ['stream'], returns: null, sections: [] },
  { id: 'relation.uses', name: 'Usa', verb: 'usa', group: 'Relación general', patterns: ['one-way'], returns: null, sections: [] },
  { id: 'relation.depends', name: 'Depende de', verb: 'depende de', group: 'Relación general', patterns: ['one-way'], returns: null, sections: [] },
  { id: 'navigation', name: 'Navegar', verb: 'navega', group: 'Interfaz', patterns: ['one-way'], returns: null, sections: [] },
  {
    id: 'custom',
    name: 'Operación personalizada…',
    verb: 'opera',
    group: 'Otra',
    patterns: ['request-response', 'one-way', 'pub-sub', 'stream'],
    returns: { action: 'Añadir retorno', verb: 'devuelve', types: ['success', 'empty', 'affected', 'ack', 'nack', 'hit', 'miss', 'content', 'error', 'message', 'end'] },
    sections: ['command', 'params', 'entities', 'result', 'errors', 'policy', 'messaging', 'correlation'],
  },
];

export const OPERATIONS: Record<OperationId, OperationProfile> = Object.fromEntries(PROFILES.map((p) => [p.id, p])) as Record<
  OperationId,
  OperationProfile
>;
export const OPERATION_IDS = PROFILES.map((p) => p.id);
export const OPERATION_GROUPS = [...new Set(PROFILES.map((p) => p.group))];

export const PATTERN_LABELS: Record<Pattern, string> = {
  'request-response': 'Solicitud y respuesta',
  'one-way': 'Envío unidireccional',
  'pub-sub': 'Publicación / suscripción',
  stream: 'Streaming',
};

export const RESULT_LABELS: Record<ResultType, string> = {
  success: 'resultado',
  empty: 'resultado vacío',
  affected: 'filas afectadas',
  ack: 'confirmación',
  nack: 'rechazo',
  hit: 'hit',
  miss: 'miss',
  content: 'contenido',
  error: 'error',
  message: 'mensaje',
  end: 'fin del flujo',
};

/** Tecnologías habituales por familia (sugerencias del campo; se puede escribir cualquiera). */
export const TECHNOLOGIES: Record<Family, string[]> = {
  api: ['HTTP', 'HTTPS', 'GraphQL', 'gRPC', 'SOAP'],
  service: ['gRPC', 'HTTP', 'AWS Lambda', 'Azure Functions'],
  database: ['PostgreSQL', 'Oracle', 'SQL Server', 'MySQL', 'MongoDB', 'DynamoDB'],
  cache: ['Redis', 'Memcached'],
  storage: ['S3', 'Azure Blob', 'GCS'],
  messaging: ['AMQP', 'Kafka', 'SQS', 'SNS', 'Service Bus', 'Pub/Sub'],
  screen: [],
  actor: [],
  rule: [],
  portal: [],
  other: [],
};

/** Familia de un componente por su tipo efectivo y, en un recurso, su subtipo. */
export function familyOf(type: NodeType | undefined, resource?: ResourceKind): Family {
  switch (type) {
    case 'api':
      return 'api';
    case 'service':
      return 'service';
    case 'database':
      return 'database';
    case 'screen':
      return 'screen';
    case 'actor':
      return 'actor';
    case 'rule':
      return 'rule';
    case 'portal':
      return 'portal';
    case 'resource':
      switch (resource) {
        case 'cache':
          return 'cache';
        case 'storage':
        case 'cdn':
        case 'secret':
          return 'storage';
        case 'queue':
        case 'topic':
          return 'messaging';
        case 'function':
        case 'scheduler':
          return 'service';
        case 'gateway':
          return 'api';
        default:
          return 'other';
      }
    default:
      return 'other';
  }
}

/**
 * Operaciones sugeridas al conectar `from` con `to`, en orden (la primera es la más probable). Siempre se puede elegir
 * cualquier otra en el inspector.
 */
export function suggestOperations(from: Family, to: Family): OperationId[] {
  if ((from === 'screen' || from === 'actor') && (to === 'screen' || to === 'portal')) return ['navigation', 'relation.uses'];
  if (from === 'messaging' && to !== 'messaging') return ['message.deliver', 'message.reply', 'relation.uses'];
  switch (to) {
    case 'api':
      return ['http.request', 'relation.uses'];
    case 'service':
      return ['service.invoke', 'stream.open', 'message.reply', 'relation.depends'];
    case 'database':
      return ['db.query', 'db.write', 'db.procedure', 'db.insert', 'db.update', 'db.delete'];
    case 'cache':
      return ['cache.get', 'cache.set', 'cache.delete'];
    case 'storage':
      return ['storage.read', 'storage.write', 'storage.list', 'storage.delete'];
    case 'messaging':
      return ['message.publish', 'message.consume'];
    default:
      return ['relation.uses', 'relation.depends'];
  }
}

/** Trazo (`kind`) que corresponde a una operación con su patrón: síncrona, asíncrona, estructural o navegación. */
export function kindFor(operation: OperationId, pattern?: Pattern): EdgeKind {
  if (operation === 'navigation') return 'navigation';
  if (operation === 'relation.uses' || operation === 'relation.depends') return 'uses';
  const effective = pattern ?? OPERATIONS[operation].patterns[0];
  if (operation.startsWith('message.') || effective === 'pub-sub' || effective === 'one-way') return 'event';
  return 'request';
}

/**
 * Operación con la que se comporta una conexión: la explícita (`operation`) o, en una conexión anterior sin ella, la que
 * corresponde a su tipo y al destino (sugerida, no guardada). `null` en un retorno.
 */
export function effectiveOperation(edge: Pick<Edge, 'kind' | 'operation'>, from: Family, to: Family): { id: OperationId; explicit: boolean } | null {
  if (edge.kind === 'response') return null;
  if (edge.operation) return { id: edge.operation, explicit: true };
  const legacy = ((): OperationId => {
    switch (edge.kind) {
      case 'navigation':
        return 'navigation';
      case 'uses':
        return 'relation.uses';
      case 'reads':
        return to === 'cache' ? 'cache.get' : to === 'storage' ? 'storage.read' : 'db.query';
      case 'writes':
        return to === 'cache' ? 'cache.set' : to === 'storage' ? 'storage.write' : 'db.write';
      case 'event':
        return from === 'messaging' ? 'message.deliver' : 'message.publish';
      default:
        return to === 'service'
          ? 'service.invoke'
          : to === 'database'
            ? 'db.query'
            : to === 'cache'
              ? 'cache.get'
              : to === 'storage'
                ? 'storage.read'
                : to === 'messaging'
                  ? 'message.publish'
                  : 'http.request';
    }
  })();
  return { id: legacy, explicit: false };
}

export function patternOf(edge: Pick<Edge, 'pattern'>, operation: OperationId): Pattern {
  return edge.pattern ?? OPERATIONS[operation].patterns[0]!;
}

/** ¿Admite retornos? Según la operación y su patrón: un envío unidireccional no espera respuesta (las confirmaciones de mensajería sí). */
export function returnsOf(operation: OperationId, pattern: Pattern): ReturnProfile | null {
  const profile = OPERATIONS[operation];
  if (!profile.returns) return null;
  if (pattern === 'one-way' && !operation.startsWith('message.')) return null;
  return profile.returns;
}

/** Nombre visible de una operación (la personalizada, con su nombre). */
export function operationName(edge: Pick<Edge, 'operation' | 'customOperation'>): string | undefined {
  if (!edge.operation) return undefined;
  return edge.operation === 'custom' ? (edge.customOperation ?? OPERATIONS.custom.name) : OPERATIONS[edge.operation].name;
}

/** Verbo de una conexión con operación explícita (la personalizada usa su nombre). `undefined` sin operación. */
export function operationVerb(edge: Pick<Edge, 'operation' | 'customOperation'>): string | undefined {
  if (!edge.operation) return undefined;
  return edge.operation === 'custom' ? (edge.customOperation?.toLowerCase() ?? OPERATIONS.custom.verb) : OPERATIONS[edge.operation].verb;
}

/** Verbo de un retorno según la operación a la que responde (con operación explícita); si no, `undefined`. */
export function returnVerb(parent: Pick<Edge, 'operation' | 'pattern'> | undefined, result?: ResultType): string | undefined {
  if (!parent?.operation) return undefined;
  if (result === 'error') return 'error';
  return OPERATIONS[parent.operation].returns?.verb;
}

/**
 * Contradicción en una conexión anterior: su tipo (o su operación explícita) dice una cosa y el campo de acceso a datos
 * (`data.operation`) otra. No se deduce cuál era la intención: se muestran las dos para elegir.
 */
export function operationConflict(
  edge: Pick<Edge, 'kind' | 'operation' | 'data'>,
  from: Family,
  to: Family,
): { kindSays: 'read' | 'write'; dataSays: 'read' | 'write' } | null {
  const data = edge.data?.operation;
  if (!data) return null;
  const effective = effectiveOperation(edge, from, to);
  const access = effective ? OPERATIONS[effective.id].access : undefined;
  return access && access !== data ? { kindSays: access, dataSays: data } : null;
}

/** La operación equivalente a «leer» o «escribir» hacia una familia (para resolver una contradicción). */
export function accessOperation(access: 'read' | 'write', to: Family): OperationId {
  if (to === 'cache') return access === 'read' ? 'cache.get' : 'cache.set';
  if (to === 'storage') return access === 'read' ? 'storage.read' : 'storage.write';
  return access === 'read' ? 'db.query' : 'db.write';
}

/** ¿El nodo es de una familia que recibe operaciones con retorno? (decide el sentido al cambiar a «retorno»). */
export function receivesCalls(family: Family): boolean {
  return family === 'api' || family === 'service' || family === 'database' || family === 'cache' || family === 'storage' || family === 'messaging';
}

/** Retornos de una operación en el grafo, en su orden. */
export function returnsOfEdge(edges: Record<string, Edge>, edgeId: string): Edge[] {
  return Object.values(edges).filter((e) => e.kind === 'response' && e.replyTo === edgeId);
}

/** Respuestas asíncronas correlacionadas con una operación. */
export function correlatedWith(edges: Record<string, Edge>, edgeId: string): Edge[] {
  return Object.values(edges).filter((e) => e.correlatesWith === edgeId);
}

