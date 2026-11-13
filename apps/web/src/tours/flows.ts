import type { Edge, Tour } from '../schema/walkie-graph';

export type TourStep = Tour['steps'][number];

/**
 * Recorridos de un flujo (spec recorridos-y-grupos, partes 3 y 4): un tour cuyos pasos recorren conexiones. Un paso
 * referencia una conexión existente por `edgeId` y se reproduce en su sentido real (from → to); si la conexión se
 * borra, el paso queda como `removedEdge` hasta que se reemplace o se quite.
 */
export type TourKind = NonNullable<Tour['kind']>;

/**
 * Tipo de un tour (spec tours-y-recorridos): el declarado en `kind` o, en lienzos anteriores sin él, `flow` si tiene
 * algún paso de conexión y `guide` si no.
 */
export function tourKind(tour: Tour): TourKind {
  if (tour.kind) return tour.kind;
  return tour.steps.some((s) => s.edgeId !== undefined || s.removedEdge !== undefined) ? 'flow' : 'guide';
}

/** ¿Es un recorrido (pasos por conexión) y no un tour guiado? */
export function isFlowTour(tour: Tour | undefined): boolean {
  return !!tour && tourKind(tour) === 'flow';
}

/** Origen y destino de un paso (`null` en un paso de nodo o roto sin datos). */
export function stepEnds(step: TourStep, edges: Record<string, Edge>): { from: string; to: string } | null {
  if (step.edgeId) {
    const edge = edges[step.edgeId];
    return edge ? { from: edge.from, to: edge.to } : null;
  }
  if (step.removedEdge) return { from: step.removedEdge.from, to: step.removedEdge.to };
  return null;
}

/** Nodos que participan en el tour (extremos de sus conexiones y nodos de sus pasos). */
export function tourNodes(tour: Tour | undefined, edges: Record<string, Edge>): Set<string> {
  const ids = new Set<string>();
  for (const step of tour?.steps ?? []) {
    if (step.nodeId) ids.add(step.nodeId);
    const edge = step.edgeId ? edges[step.edgeId] : undefined;
    if (edge) {
      ids.add(edge.from);
      ids.add(edge.to);
    }
  }
  return ids;
}

export type StepIssue =
  /** La conexión del paso se eliminó. */
  | { kind: 'removed' }
  /** El paso anterior termina en `end` y este empieza en `start`: hay un salto. */
  | { kind: 'jump'; end: string; start: string }
  /** Es una respuesta y su solicitud no aparece antes en el recorrido. */
  | { kind: 'response-first'; requestId: string };

/**
 * Problemas de cada paso (mismo índice que `steps`): conexión eliminada, salto entre pasos desconectados (solo entre
 * dos pasos de conexión) o respuesta antes de su solicitud. Se calcula siempre sobre el grafo actual: si una conexión
 * cambia de sentido o de extremos, la continuidad se vuelve a validar sola.
 */
export function stepIssues(tour: Tour, edges: Record<string, Edge>): StepIssue[][] {
  const played = new Set<string>();
  let previousEnd: string | null = null;
  // Un grupo de pasos simultáneos (fan-out, spec interacciones) sale del mismo lugar; el paso siguiente puede seguir
  // desde el destino de cualquiera de ellos.
  let groupStart: string | null = null;
  let groupEnds: string[] = [];
  return tour.steps.map((step) => {
    const issues: StepIssue[] = [];
    if (step.removedEdge) issues.push({ kind: 'removed' });
    const ends = stepEnds(step, edges);
    const fanOut = step.parallel && ends && (ends.from === groupStart || groupEnds.includes(ends.from));
    const continues = ends && (ends.from === previousEnd || groupEnds.includes(ends.from));
    if (ends && previousEnd && !continues && !fanOut) issues.push({ kind: 'jump', end: previousEnd, start: ends.from });
    if (ends && step.parallel) groupEnds.push(ends.to);
    else if (ends) {
      groupStart = ends.from;
      groupEnds = [ends.to];
    } else if (step.nodeId) groupEnds = [];
    const edge = step.edgeId ? edges[step.edgeId] : undefined;
    if (edge?.kind === 'response' && edge.replyTo && edges[edge.replyTo] && !played.has(edge.replyTo)) {
      issues.push({ kind: 'response-first', requestId: edge.replyTo });
    }
    if (step.edgeId) played.add(step.edgeId);
    if (step.parallel && ends) return issues;
    previousEnd = ends?.to ?? (step.nodeId ? null : previousEnd);
    return issues;
  });
}

/** Conexiones que continúan desde `nodeId` (las que salen de él), para elegir el siguiente paso. */
export function continuations(edges: Record<string, Edge>, nodeId: string | null): Edge[] {
  if (!nodeId) return [];
  return Object.values(edges).filter((e) => e.from === nodeId);
}

/** Último nodo al que llega el recorrido (destino del último paso de conexión). */
export function lastEnd(tour: Tour | undefined, edges: Record<string, Edge>): string | null {
  const steps = tour?.steps ?? [];
  for (let i = steps.length - 1; i >= 0; i--) {
    const ends = stepEnds(steps[i]!, edges);
    if (ends) return ends.to;
    if (steps[i]!.nodeId) return steps[i]!.nodeId!;
  }
  return null;
}

/** Límite de la búsqueda de órdenes: con más combinaciones no se sugiere nada (el usuario ordena). */
const SEARCH_LIMIT = 20000;

/**
 * Orden sugerido para un conjunto de conexiones (puede repetir una): la única secuencia que las usa todas, encadenada
 * (cada una sale de donde llegó la anterior), con cada respuesta después de su solicitud. `null` si no hay ninguna o
 * hay más de una (bifurcaciones, ciclos o varias continuaciones): ahí decide el usuario.
 */
export function suggestOrder(edgeIds: readonly string[], edges: Record<string, Edge>): string[] | null {
  const list = edgeIds.filter((id) => edges[id]);
  if (list.length !== edgeIds.length || list.length === 0) return null;
  if (list.length === 1) return [...list];
  const first = searchOrders(list, edges, () => true);
  if (first === 'too-many') return null;
  if (first.length === 1) return first[0]!;
  if (first.length === 0) return null;
  // Un ciclo cerrado (Pantalla → … → Pantalla) admite empezar por cualquier conexión: se descartan los arranques
  // con una respuesta, que siempre van después de quien llamó.
  const second = searchOrders(list, edges, (edge) => edge.kind !== 'response');
  return second !== 'too-many' && second.length === 1 ? second[0]! : null;
}

/** Hasta dos órdenes válidos distintos (con uno basta para saber que no es único); `too-many` si la búsqueda no cabe. */
function searchOrders(
  list: readonly string[],
  edges: Record<string, Edge>,
  canStart: (edge: Edge) => boolean,
): string[][] | 'too-many' {
  const solutions = new Map<string, string[]>();
  let budget = SEARCH_LIMIT;
  const used = list.map(() => false);
  const path: string[] = [];

  const visit = (at: string | null): boolean => {
    if (--budget < 0) return false;
    if (path.length === list.length) {
      solutions.set(path.join(','), [...path]);
      return solutions.size < 2;
    }
    const tried = new Set<string>();
    for (let i = 0; i < list.length; i++) {
      const id = list[i]!;
      // Copias de la misma conexión son intercambiables: probar una basta.
      if (used[i] || tried.has(id)) continue;
      const edge = edges[id]!;
      if (at === null ? !canStart(edge) : edge.from !== at) continue;
      if (edge.kind === 'response' && edge.replyTo && list.includes(edge.replyTo) && !path.includes(edge.replyTo)) continue;
      tried.add(id);
      used[i] = true;
      path.push(id);
      const keepGoing = visit(edge.to);
      path.pop();
      used[i] = false;
      if (!keepGoing) return false;
    }
    return true;
  };

  visit(null);
  return budget < 0 ? 'too-many' : [...solutions.values()];
}
