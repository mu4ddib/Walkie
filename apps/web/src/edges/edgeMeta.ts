import type { Edge, Http } from '../schema/walkie-graph';
import type { EdgeKind, NodeType } from '../store/graphStore';

/** Tipos que el usuario puede elegir (spec, criterio 5). `uses` solo aparece como valor por defecto. */
export const SELECTABLE_KINDS: EdgeKind[] = ['navigation', 'request', 'response', 'event', 'reads', 'writes'];

export const KIND_LABELS: Record<EdgeKind, string> = {
  navigation: 'navega',
  request: 'llama',
  response: 'responde',
  event: 'emite',
  reads: 'lee',
  writes: 'escribe',
  uses: 'usa',
};

/**
 * Trazo y punta por tipo (spec espacio-de-trabajo, criterio 22): solicitudes, respuestas, eventos y accesos a
 * datos se distinguen sin depender del color. La animación sigue el sentido de la conexión.
 */
export const KIND_STYLES: Record<EdgeKind, { marker: 'closed' | 'open' | 'none'; description: string }> = {
  navigation: { marker: 'open', description: 'línea continua fina, punta abierta' },
  request: { marker: 'closed', description: 'línea continua, punta cerrada' },
  response: { marker: 'open', description: 'línea discontinua, punta abierta' },
  event: { marker: 'closed', description: 'línea de raya y punto, punta cerrada' },
  reads: { marker: 'closed', description: 'línea punteada, punta cerrada' },
  writes: { marker: 'closed', description: 'línea gruesa, punta cerrada' },
  uses: { marker: 'none', description: 'línea continua clara, sin punta' },
};

/** Tipos que reciben llamadas (API, servicio, base de datos): de ellos sale una respuesta, a ellos llega una solicitud. */
const CALLEE_TYPES: readonly NodeType[] = ['api', 'service', 'database'];
const isCallee = (type: NodeType | undefined) => !!type && CALLEE_TYPES.includes(type);

/**
 * ¿Hay que invertir el sentido al cambiar el tipo? Una respuesta sale de quien fue llamado y una solicitud llega a
 * él: si los tipos de los extremos lo contradicen, se invierte (pantalla → API marcada como "responde" pasa a
 * API → pantalla). Si los tipos no deciden (API ↔ servicio), solicitud ↔ respuesta se invierten entre sí.
 */
export function shouldReverse(
  prev: EdgeKind,
  next: EdgeKind,
  fromType: NodeType | undefined,
  toType: NodeType | undefined,
): boolean {
  if (prev === next || (next !== 'request' && next !== 'response')) return false;
  const from = isCallee(fromType);
  const to = isCallee(toType);
  if (from !== to) return next === 'response' ? to : from;
  return (prev === 'request' || prev === 'response') && prev !== next;
}

type EdgeLike = Pick<Edge, 'kind' | 'label' | 'when' | 'status' | 'request'>;

/**
 * Código HTTP de una respuesta: `status`, o un `when` que solo es un código (así se documentaba antes de tener
 * el campo propio). `undefined` si no es una respuesta o no hay código.
 */
export function responseStatus(edge: EdgeLike): number | undefined {
  if (edge.kind !== 'response') return undefined;
  if (edge.status !== undefined) return edge.status;
  const legacy = edge.when?.trim();
  if (legacy && /^[1-5]\d\d$/.test(legacy)) return Number(legacy);
  return undefined;
}

/** `POST /ruta` de una solicitud: lo propio del paso (`edge.request`) o, si falta, el contrato de la API destino. */
export function endpointText(edge: EdgeLike, targetHttp?: Http): string {
  if (edge.kind !== 'request') return '';
  const method = edge.request?.method ?? targetHttp?.method;
  const path = edge.request?.path ?? targetHttp?.path;
  return [method, path].filter(Boolean).join(' ');
}

/** Lo que una conexión muestra en el lienzo y en el resumen del inspector. */
export interface EdgeDisplay {
  /** Verbo del tipo ("llama") o, en una rama de decisión, la etiqueta de la salida ("Sí"). */
  main: string;
  /** Etiqueta personalizada, o el endpoint de una solicitud sin etiqueta. */
  detail?: string;
  /** `detail` es un endpoint (va en monoespaciada). */
  mono?: boolean;
  /** Código HTTP de una respuesta. */
  code?: number;
  /** Condición (`[when]`), salvo cuando era solo el código de una respuesta. */
  when?: string;
  marker: 'closed' | 'open' | 'none';
  /** Rama de una decisión. */
  branch?: boolean;
}

export function edgeDisplay(edge: EdgeLike, context: { branchLabel?: string; targetHttp?: Http } = {}): EdgeDisplay {
  const style = KIND_STYLES[edge.kind];
  if (context.branchLabel) {
    // La salida sustituye al genérico "usa"; otro tipo (navega, llama…) se conserva detrás.
    const parts = [edge.kind === 'uses' ? undefined : KIND_LABELS[edge.kind], edge.label].filter(Boolean);
    return {
      main: context.branchLabel,
      detail: parts.length ? parts.join(' · ') : undefined,
      when: edge.when,
      marker: style.marker === 'none' ? 'open' : style.marker,
      branch: true,
    };
  }
  const code = responseStatus(edge);
  const when = code !== undefined && edge.status === undefined ? undefined : edge.when;
  const endpoint = edge.label ? '' : endpointText(edge, context.targetHttp);
  return {
    main: KIND_LABELS[edge.kind],
    detail: edge.label ?? (endpoint || undefined),
    mono: !edge.label && !!endpoint,
    code,
    when,
    marker: style.marker,
  };
}

/** Texto plano de una conexión, ej. "llama · POST /usuarios", "responde 201 · Creado", "Sí [saldo > 0]". */
export function edgeDisplayText(d: EdgeDisplay): string {
  return [d.code !== undefined ? `${d.main} ${d.code}` : d.main, d.detail].filter(Boolean).join(' · ') + (d.when ? ` [${d.when}]` : '');
}

/** Clase de un código HTTP para el color del distintivo: éxito, redirección o error. */
export function statusTone(code: number): 'ok' | 'info' | 'error' {
  return code >= 400 ? 'error' : code >= 300 || code < 200 ? 'info' : 'ok';
}

/**
 * Conexiones que recorre "Previsualizar interacción" a partir de `edgeId`, en orden: una solicitud y luego sus
 * respuestas (la ida y la vuelta); desde una respuesta, su solicitud y ella; cualquier otra, sola.
 */
export function interactionEdges(edges: Record<string, Edge>, edgeId: string): string[] {
  const edge = edges[edgeId];
  if (!edge) return [];
  if (edge.kind === 'request') {
    return [edgeId, ...Object.values(edges).filter((e) => e.kind === 'response' && e.replyTo === edgeId).map((e) => e.id)];
  }
  if (edge.kind === 'response' && edge.replyTo && edges[edge.replyTo]) return [edge.replyTo, edgeId];
  return [edgeId];
}
