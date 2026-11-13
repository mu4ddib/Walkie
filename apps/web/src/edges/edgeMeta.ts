import type { Edge, Http } from '../schema/walkie-graph';
import type { EdgeKind } from '../store/graphStore';
import { RESULT_LABELS, operationVerb, receivesCalls, returnVerb, type Family } from '../interactions/operations';

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


/**
 * ¿Hay que invertir el sentido al cambiar el tipo? Una respuesta sale de quien fue llamado y una solicitud llega a
 * él: si los tipos de los extremos lo contradicen, se invierte (pantalla → API marcada como "responde" pasa a
 * API → pantalla). Si los tipos no deciden (API ↔ servicio), solicitud ↔ respuesta se invierten entre sí.
 */
export function shouldReverse(prev: EdgeKind, next: EdgeKind, fromFamily: Family, toFamily: Family): boolean {
  if (prev === next || (next !== 'request' && next !== 'response')) return false;
  // Quien recibe llamadas (API, servicio, base, caché, almacenamiento, broker): de él sale el retorno.
  const from = receivesCalls(fromFamily);
  const to = receivesCalls(toFamily);
  if (from !== to) return next === 'response' ? to : from;
  return (prev === 'request' || prev === 'response') && prev !== next;
}

type EdgeLike = Pick<Edge, 'kind' | 'label' | 'when' | 'status' | 'request'> &
  Partial<Pick<Edge, 'operation' | 'customOperation' | 'result' | 'exchange' | 'stream'>>;

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
  // Con operación explícita: el endpoint solo en HTTP; en gRPC, servicio/método.
  if (edge.operation && edge.operation !== 'http.request') {
    const grpc = edge.exchange?.grpc;
    return grpc?.service || grpc?.method ? [grpc.service, grpc.method].filter(Boolean).join('/') : '';
  }
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
  /** Retorno de error (se distingue en el lienzo). */
  error?: boolean;
}

export function edgeDisplay(
  edge: EdgeLike,
  context: {
    branchLabel?: string;
    targetHttp?: Http;
    interfaceName?: string;
    /** Operación a la que responde un retorno (su verbo sale de ella). */
    parent?: Pick<Edge, 'operation' | 'pattern'>;
  } = {},
): EdgeDisplay {
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
  // El verbo sale de la operación (spec interacciones, ADR-0011); sin ella, del tipo de siempre.
  const main =
    operationVerb(edge) ??
    (edge.kind === 'response' ? returnVerb(context.parent, edge.result?.type) : undefined) ??
    KIND_LABELS[edge.kind];
  // Un retorno sin código HTTP dice qué es: resultado vacío, filas afectadas, confirmación, miss…
  const result =
    edge.kind === 'response' && edge.result && code === undefined && edge.result.type !== 'error'
      ? [RESULT_LABELS[edge.result.type], edge.result.code].filter(Boolean).join(' ')
      : edge.kind === 'response' && edge.result?.type === 'error'
        ? edge.result.code
        : undefined;
  return {
    main: edge.stream ? `${main} ⋯` : main,
    // A la interfaz de un módulo sin endpoint (un evento, una dependencia), su nombre (spec modulos-compartidos).
    detail: edge.label ?? (endpoint || context.interfaceName || result || undefined),
    mono: !edge.label && !!endpoint,
    code,
    when,
    marker: style.marker,
    error: edge.result?.type === 'error' || undefined,
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

/** Escenario de una interacción: un retorno alternativo o el timeout de quien espera. */
export interface Scenario {
  /** Id del retorno, o `TIMEOUT_SCENARIO`. */
  id: string;
  label: string;
}

export const TIMEOUT_SCENARIO = 'timeout';

function returnLabel(r: Edge): string {
  const code = responseStatus(r);
  const head = code !== undefined ? String(code) : r.result ? `${RESULT_LABELS[r.result.type]}${r.result.code ? ` ${r.result.code}` : ''}` : 'retorno';
  const text = r.label ?? r.result?.description ?? r.outcome;
  return text ? `${head} · ${text}` : head;
}

/**
 * Escenarios que se pueden elegir al previsualizar una operación (spec interacciones, criterio 12): cada retorno
 * alternativo (los mensajes de un stream no son alternativas: van siempre, en orden) y, si espera respuesta, el timeout.
 */
export function scenariosOf(edges: Record<string, Edge>, edgeId: string): Scenario[] {
  const edge = edges[edgeId];
  if (!edge || edge.kind === 'response') return [];
  const returns = Object.values(edges).filter((e) => e.kind === 'response' && e.replyTo === edgeId);
  const alternatives = returns.filter((r) => !r.stream);
  if (returns.length === 0) return [];
  return [
    ...alternatives.map((r) => ({ id: r.id, label: returnLabel(r) })),
    ...(alternatives.length === 0 ? [{ id: '', label: 'Flujo completo' }] : []),
    { id: TIMEOUT_SCENARIO, label: 'Timeout (no llega respuesta)' },
  ];
}

/** Un tramo de «Previsualizar interacción»: recorrer una conexión, esperar un retorno o terminar por timeout. */
export interface PreviewStep {
  edgeId: string;
  /** Espera de un retorno (ms del `timeoutMs` de la operación, o `undefined` sin esperar). */
  wait?: number;
  /** Intento (desde 1) y total de intentos de una operación que termina en timeout. */
  attempt?: number;
  attempts?: number;
  /** Último tramo: quien espera termina por timeout. */
  timeout?: boolean;
}

/** Hasta qué profundidad se siguen las llamadas internas (Pantalla → API → Servicio → BD…). */
const CHAIN_DEPTH = 4;

/**
 * Llamadas síncronas que hace el destino de una operación mientras quien llamó espera (spec interacciones): las
 * operaciones `request` que salen de él, en su orden, sin volver por donde se vino.
 */
export function innerCalls(edges: Record<string, Edge>, edgeId: string): Edge[] {
  const edge = edges[edgeId];
  if (!edge || edge.kind !== 'request') return [];
  return Object.values(edges).filter((e) => e.from === edge.to && e.kind === 'request' && e.id !== edgeId && e.to !== edge.from);
}

/**
 * Tramos de «Previsualizar interacción» a partir de `edgeId`, en orden: la operación, lo que ocurre dentro de su destino
 * (con `chain`, cada llamada interna con su primer escenario, Pantalla → API → BD → API → Pantalla), los mensajes de
 * su stream, el retorno del escenario elegido y las respuestas correlacionadas. Con el escenario «timeout», cada
 * intento (1 + `exchange.retries`) espera su `timeoutMs` y el último termina por timeout. Desde un retorno, su
 * operación con ese escenario.
 */
export function previewSteps(
  edges: Record<string, Edge>,
  edgeId: string,
  scenario?: string,
  options: { chain?: boolean } = {},
): PreviewStep[] {
  const edge = edges[edgeId];
  if (!edge) return [];
  if (edge.kind === 'response') {
    return edge.replyTo && edges[edge.replyTo]
      ? previewSteps(edges, edge.replyTo, edgeId, options)
      : [{ edgeId }];
  }
  const visited = new Set<string>();
  const expand = (id: string, chosenScenario: string | undefined, depth: number): PreviewStep[] => {
    visited.add(id);
    const op = edges[id]!;
    const inner =
      options.chain && depth < CHAIN_DEPTH
        ? innerCalls(edges, id)
            .filter((e) => !visited.has(e.id))
            .flatMap((e) => expand(e.id, undefined, depth + 1))
        : [];
    const returns = Object.values(edges).filter((e) => e.kind === 'response' && e.replyTo === id);
    const replies = Object.values(edges)
      .filter((e) => e.correlatesWith === id && e.id !== id)
      .map((e): PreviewStep => ({ edgeId: e.id }));
    if (chosenScenario === TIMEOUT_SCENARIO) {
      const retries = op.exchange?.retries ?? 0;
      const attempts = retries + 1;
      const wait = op.exchange?.timeoutMs;
      return Array.from({ length: attempts }, (_, i): PreviewStep[] => [
        { edgeId: id, attempt: i + 1, attempts },
        ...(i === 0 ? inner : []),
        { edgeId: id, wait: wait ?? 0, attempt: i + 1, attempts, timeout: i === attempts - 1 || undefined },
      ]).flat();
    }
    const stream = returns.filter((r) => r.stream).map((r): PreviewStep => ({ edgeId: r.id }));
    const alternatives = returns.filter((r) => !r.stream);
    const chosen = alternatives.find((r) => r.id === chosenScenario) ?? alternatives[0];
    return [{ edgeId: id }, ...inner, ...stream, ...(chosen ? [{ edgeId: chosen.id }] : []), ...replies];
  };
  return expand(edgeId, scenario, 0);
}

/** Texto de la pista durante una previsualización: el tramo, la espera de un retorno o el timeout. */
export function previewHint(index: number, steps: PreviewStep[], from: string, to: string, text: string): string {
  const step = steps[index]!;
  const count = steps.length > 1 ? ` · ${index + 1} de ${steps.length}` : '';
  const attempt = step.attempts && step.attempts > 1 ? ` (intento ${step.attempt} de ${step.attempts})` : '';
  if (step.wait !== undefined) {
    const time = step.wait > 0 ? ` · ${step.wait.toLocaleString('es')} ms` : '';
    return step.timeout
      ? `Previsualizando${count}: «${from}» no recibe respuesta de «${to}»${time}${attempt}: termina por timeout · Esc termina`
      : `Previsualizando${count}: «${from}» espera respuesta de «${to}»${time}${attempt}: no llega, reintenta · Esc termina`;
  }
  return `Previsualizando${count}: ${from} → ${to} (${text})${attempt} · Esc termina`;
}

/** Conexiones distintas que recorre una previsualización, en el orden en que aparecen por primera vez. */
export function interactionEdges(
  edges: Record<string, Edge>,
  edgeId: string,
  scenario?: string,
  options: { chain?: boolean } = {},
): string[] {
  return [...new Set(previewSteps(edges, edgeId, scenario, options).map((step) => step.edgeId))];
}
