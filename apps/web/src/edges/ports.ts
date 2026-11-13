/**
 * Puertos de conexión (spec puertos-de-conexion): cada conexión sale del lado de su origen que mira al destino y
 * entra por el lado del destino que mira al origen; las que comparten lado de una caja se reparten a lo largo de él,
 * ordenadas según dónde está su otro extremo para que los trazos no se crucen al salir. Todo se calcula al dibujar:
 * nada se guarda en el grafo.
 */
export type Side = 'top' | 'right' | 'bottom' | 'left';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Port {
  x: number;
  y: number;
  side: Side;
}

export interface PortEdge {
  id: string;
  /** Caja (visible) de cada extremo: el nodo o el grupo plegado que lo representa. */
  source: string;
  target: string;
  /** El origen sale de un punto fijo (la salida de una decisión): solo se reparte la llegada. */
  fixedSource?: Port;
  /** Punto fijo de llegada (la fila de una interfaz en la caja de un módulo, spec modulos-compartidos). */
  fixedTarget?: Port;
}

/** Margen en cada punta de un lado: los puertos no tocan las esquinas. */
const CORNER = 12;

const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

const center = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** Hueco horizontal desde el que una conexión va por los lados (izquierda/derecha) aunque el destino esté más lejos en vertical. */
export const SIDE_GAP = 48;

/**
 * Lado de `from` que mira a `to`. Un lienzo se lee de izquierda a derecha: si hay un hueco horizontal de al menos
 * `SIDE_GAP` entre las cajas, izquierda o derecha; si están apiladas (sin ese hueco), arriba o abajo. Superpuestas,
 * decide la distancia entre centros.
 */
export function sideToward(from: Rect, to: Point | Rect): Side {
  const target: Rect = 'w' in to ? to : { x: to.x, y: to.y, w: 0, h: 0 };
  const gapX = Math.max(target.x - (from.x + from.w), from.x - (target.x + target.w));
  const gapY = Math.max(target.y - (from.y + from.h), from.y - (target.y + target.h));
  const a = center(from);
  const b = center(target);
  const horizontal =
    gapX >= SIDE_GAP || (gapX > 0 && gapX >= gapY) || (gapX <= 0 && gapY <= 0 && Math.abs(b.x - a.x) * from.h >= Math.abs(b.y - a.y) * from.w);
  if (horizontal) return b.x >= a.x ? 'right' : 'left';
  return b.y >= a.y ? 'bottom' : 'top';
}

type Point = { x: number; y: number };

/** Punto a la fracción `t` (0 a 1) de un lado, sin tocar las esquinas. */
function along(rect: Rect, side: Side, t: number): Port {
  const horizontal = side === 'top' || side === 'bottom';
  const length = horizontal ? rect.w : rect.h;
  const margin = Math.min(CORNER, length / 4);
  const offset = margin + (length - 2 * margin) * t;
  if (horizontal) return { x: rect.x + offset, y: side === 'top' ? rect.y : rect.y + rect.h, side };
  return { x: side === 'left' ? rect.x : rect.x + rect.w, y: rect.y + offset, side };
}

/**
 * Puertos de cada conexión. `rects` tiene la caja visible de cada extremo; una conexión sin caja de alguno de sus
 * extremos no recibe puertos (se dibuja como antes). El orden de `edges` desempata: dos conexiones entre el mismo par
 * van paralelas, en el mismo orden en los dos extremos.
 */
export function computePorts(
  edges: readonly PortEdge[],
  rects: Record<string, Rect>,
): Record<string, { source: Port; target: Port }> {
  type Slot = { edge: string; end: 'source' | 'target'; toward: Point; order: number };
  const slots = new Map<string, Slot[]>();
  const sides: Record<string, { source: Side; target: Side }> = {};
  const add = (box: string, side: Side, slot: Slot) => {
    const key = `${box}|${side}`;
    slots.set(key, [...(slots.get(key) ?? []), slot]);
  };

  edges.forEach((edge, order) => {
    const from = rects[edge.source];
    const to = rects[edge.target];
    if (!from || !to) return;
    if (edge.fixedSource && edge.fixedTarget) {
      sides[edge.id] = { source: edge.fixedSource.side, target: edge.fixedTarget.side };
      return;
    }
    if (edge.fixedTarget) {
      const source = sideToward(from, edge.fixedTarget);
      sides[edge.id] = { source, target: edge.fixedTarget.side };
      add(edge.source, source, { edge: edge.id, end: 'source', toward: edge.fixedTarget, order });
      return;
    }
    if (edge.fixedSource) {
      const target = sideToward(to, edge.fixedSource);
      sides[edge.id] = { source: edge.fixedSource.side, target };
      add(edge.target, target, { edge: edge.id, end: 'target', toward: edge.fixedSource, order });
      return;
    }
    const source = sideToward(from, to);
    const target = OPPOSITE[source];
    sides[edge.id] = { source, target };
    add(edge.source, source, { edge: edge.id, end: 'source', toward: center(to), order });
    add(edge.target, target, { edge: edge.id, end: 'target', toward: center(from), order });
  });

  const result: Record<string, { source: Port; target: Port }> = {};
  const ports: Record<string, Partial<{ source: Port; target: Port }>> = {};
  for (const [key, list] of slots) {
    const [box, side] = key.split('|') as [string, Side];
    const rect = rects[box]!;
    const horizontal = side === 'top' || side === 'bottom';
    // Ordenados por la posición del otro extremo a lo largo del lado: así los trazos salen sin cruzarse.
    const sorted = [...list].sort((a, b) => {
      const d = horizontal ? a.toward.x - b.toward.x : a.toward.y - b.toward.y;
      return Math.abs(d) > 0.5 ? d : a.order - b.order;
    });
    sorted.forEach((slot, i) => {
      (ports[slot.edge] ??= {})[slot.end] = along(rect, side, (i + 1) / (sorted.length + 1));
    });
  }
  for (const edge of edges) {
    const p = ports[edge.id];
    const source = edge.fixedSource ?? p?.source;
    const target = edge.fixedTarget ?? p?.target;
    if (source && target) result[edge.id] = { source, target };
  }
  return result;
}

/** Distancia del primer doblez al lado de salida, y entre dobleces de conexiones vecinas (px). */
const BEND_START = 24;
const BEND_STEP = 16;

/**
 * Dónde dobla cada conexión que comparte lado de salida con otras: cada una en su propia línea, para que sus tramos
 * no se pisen. Las que suben (o van a la izquierda, en un lado de arriba o abajo) doblan más cerca cuanto más arriba
 * salen; las que bajan, al revés: así no se cruzan. Las que van derechas o no tienen lugar para doblar antes de
 * llegar se dejan como están (doblan a mitad de camino).
 */
export function staggerBends(
  edges: readonly { id: string; box: string; source: Port; target: Port }[],
): Record<string, { x?: number; y?: number }> {
  const groups = new Map<string, typeof edges>();
  for (const edge of edges) {
    const key = `${edge.box}|${edge.source.side}`;
    groups.set(key, [...(groups.get(key) ?? []), edge]);
  }
  const result: Record<string, { x?: number; y?: number }> = {};
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const side = list[0]!.source.side;
    const horizontal = side === 'left' || side === 'right';
    const dir = side === 'right' || side === 'bottom' ? 1 : -1;
    // A lo largo del lado (la coordenada que reparte los puertos) y hacia afuera de él.
    const along = (p: Port) => (horizontal ? p.y : p.x);
    const out = (p: Port) => (horizontal ? p.x : p.y);
    const before = list.filter((e) => along(e.target) < along(e.source) - 1).sort((a, b) => along(a.source) - along(b.source));
    const after = list.filter((e) => along(e.target) > along(e.source) + 1).sort((a, b) => along(b.source) - along(a.source));
    for (const ordered of [before, after]) {
      ordered.forEach((edge, i) => {
        const distance = BEND_START + i * BEND_STEP;
        // Sin lugar para doblar antes de llegar al destino: mejor a mitad de camino.
        if ((out(edge.target) - out(edge.source)) * dir < distance + BEND_STEP) return;
        const at = out(edge.source) + dir * distance;
        result[edge.id] = horizontal ? { x: at } : { y: at };
      });
    }
  }
  return result;
}
