import type { Edge } from '../schema/walkie-graph';
import type { EdgeKind, NodeType } from '../store/graphStore';
import type { ResourceKind } from '../nodes/resourceMeta';
import { WALKIE_OPERATIONS } from '../schema/walkie-operations';

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
  /** Admite retorno aunque el patrón sea unidireccional (confirmaciones de mensajería). */
  oneWayReturns?: boolean;
}

/**
 * Los perfiles salen de `packages/schema/walkie-operations.json` (generado en `src/schema/walkie-operations.ts`): la
 * misma fuente que usa la API para el export. Aquí solo se tipan.
 */
const PROFILES = WALKIE_OPERATIONS.operations as unknown as OperationProfile[];

export const OPERATIONS: Record<OperationId, OperationProfile> = Object.fromEntries(PROFILES.map((p) => [p.id, p])) as Record<
  OperationId,
  OperationProfile
>;
export const OPERATION_IDS = PROFILES.map((p) => p.id);
export const OPERATION_GROUPS = [...new Set(PROFILES.map((p) => p.group))];

export const PATTERN_LABELS = WALKIE_OPERATIONS.patterns as Record<Pattern, string>;

export const RESULT_LABELS = WALKIE_OPERATIONS.results as Record<ResultType, string>;

/** Tecnologías habituales por familia (sugerencias del campo; se puede escribir cualquiera). */
export const TECHNOLOGIES = WALKIE_OPERATIONS.technologies as Record<Family, string[]>;

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

/**
 * Operación inequívoca de una conexión anterior (sin `operation`), para migrarla al abrir el lienzo conservando su
 * significado: solo cuando el tipo y el destino dicen una sola cosa (un `reads` a una base es «Consultar»). Si el par
 * admite varias lecturas (un `request` a una base: ¿consulta o escritura?), si su acceso a datos contradice al tipo, si
 * es un retorno o una rama de decisión, `null`: queda como está, a la vista para revisar.
 */
export function legacyOperation(
  edge: Pick<Edge, 'kind' | 'operation' | 'data' | 'branch'>,
  from: Family,
  to: Family,
  /** Sus retornos llevan código HTTP: entonces es una solicitud HTTP aunque el destino sea un servicio. */
  httpReturns = false,
): OperationId | null {
  if (edge.operation || edge.kind === 'response' || edge.branch) return null;
  if (operationConflict(edge, from, to)) return null;
  const store = (read: OperationId, write: OperationId) => (edge.kind === 'reads' ? read : write);
  switch (edge.kind) {
    case 'navigation':
      return 'navigation';
    case 'uses':
      return 'relation.uses';
    case 'reads':
    case 'writes':
      if (to === 'database') return store('db.query', 'db.write');
      if (to === 'cache') return store('cache.get', 'cache.set');
      if (to === 'storage') return store('storage.read', 'storage.write');
      return null;
    case 'request':
      if (to === 'api' || httpReturns) return 'http.request';
      if (to === 'service') return 'service.invoke';
      return null;
    case 'event':
      if (to === 'messaging' && from !== 'messaging') return 'message.publish';
      if (from === 'messaging' && to !== 'messaging') return 'message.deliver';
      return null;
    default:
      return null;
  }
}

export function patternOf(edge: Pick<Edge, 'pattern'>, operation: OperationId): Pattern {
  return edge.pattern ?? OPERATIONS[operation].patterns[0]!;
}

/** ¿Admite retornos? Según la operación y su patrón: un envío unidireccional no espera respuesta (las confirmaciones de mensajería sí). */
export function returnsOf(operation: OperationId, pattern: Pattern): ReturnProfile | null {
  const profile = OPERATIONS[operation];
  if (!profile.returns) return null;
  if (pattern === 'one-way' && !profile.oneWayReturns) return null;
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

