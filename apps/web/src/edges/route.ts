import type { Port, Rect, Side } from './ports';

/**
 * Conexiones que esquivan cajas (spec puertos-de-conexion, tarea 4). Si el trazo de siempre (en escalones, con un
 * doblez a mitad de camino o donde lo pidan `bendX`/`bendY`) atraviesa una caja, se busca un camino ortogonal que la
 * rodee: el más corto con menos dobleces (A* sobre las líneas que bordean los obstáculos). Si no atraviesa nada, no se
 * toca: el lienzo se ve como siempre.
 */
export type Point = { x: number; y: number };

/** Aire alrededor de cada caja que el trazo respeta (px). */
export const ROUTE_PADDING = 16;
/** Tramo recto con el que el trazo sale de su lado antes de doblar (px). */
const STUB = 16;
/** Cuánto "cuesta" un doblez frente a un px de largo: prefiere caminos con pocos dobleces. */
const BEND_COST = 40;
/** Obstáculos más allá de este margen alrededor de los extremos no se consideran (px). */
const SEARCH_MARGIN = 400;

const DIR: Record<Side, Point> = { right: { x: 1, y: 0 }, left: { x: -1, y: 0 }, bottom: { x: 0, y: 1 }, top: { x: 0, y: -1 } };
const horizontalSide = (side: Side) => side === 'left' || side === 'right';

/** Trazo de siempre como polilínea (lo que dibuja el escalón de React Flow, aproximado). */
export function defaultRoute(source: Port, target: Port, bend?: { x?: number; y?: number }): Point[] {
  const s = { x: source.x, y: source.y };
  const t = { x: target.x, y: target.y };
  const sh = horizontalSide(source.side);
  const th = horizontalSide(target.side);
  if (sh && th) {
    const x = bend?.x ?? (s.x + t.x) / 2;
    return [s, { x, y: s.y }, { x, y: t.y }, t];
  }
  if (!sh && !th) {
    const y = bend?.y ?? (s.y + t.y) / 2;
    return [s, { x: s.x, y }, { x: t.x, y }, t];
  }
  return sh ? [s, { x: t.x, y: s.y }, t] : [s, { x: s.x, y: t.y }, t];
}

const pad = (r: Rect, p: number): Rect => ({ x: r.x - p, y: r.y - p, w: r.w + 2 * p, h: r.h + 2 * p });

/** ¿El tramo recto a→b pasa por dentro de `r` (no solo por su borde)? */
export function segmentHits(a: Point, b: Point, r: Rect): boolean {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  return maxX > r.x && minX < r.x + r.w && maxY > r.y && minY < r.y + r.h;
}

const pathHits = (points: Point[], rects: Rect[]) =>
  points.some((p, i) => i > 0 && rects.some((r) => segmentHits(points[i - 1]!, p, r)));

/** Quita puntos repetidos y los del medio de tramos rectos. */
export function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    const prev = out[out.length - 2];
    if (prev && last && ((prev.x === last.x && last.x === p.x) || (prev.y === last.y && last.y === p.y))) out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}

/**
 * Camino que esquiva `obstacles` (cajas ajenas a la conexión), o `null` si el trazo de siempre ya no choca con nada o
 * no hay forma de rodearlas (entonces se dibuja el de siempre).
 */
export function routeAround(
  source: Port,
  target: Port,
  obstacles: readonly Rect[],
  bend?: { x?: number; y?: number },
  /** Más aire alrededor de las cajas y al salir de los lados (px), para un corredor con varios carriles. */
  extra = 0,
): Point[] | null {
  // Solo importan las cajas cerca de los extremos.
  const close = obstacles.filter(
    (r) =>
      r.x < Math.max(source.x, target.x) + SEARCH_MARGIN &&
      r.x + r.w > Math.min(source.x, target.x) - SEARCH_MARGIN &&
      r.y < Math.max(source.y, target.y) + SEARCH_MARGIN &&
      r.y + r.h > Math.min(source.y, target.y) - SEARCH_MARGIN,
  );
  // Mismos extremos y mismas cajas cerca → mismo camino: se reutiliza (editar el inspector o mover una caja lejana no
  // vuelve a buscar el rodeo de cada conexión). Se entrega una copia: quien la usa puede invertirla.
  const key = routeKey(source, target, close, bend, extra);
  const cached = ROUTE_CACHE.get(key);
  if (cached !== undefined) {
    ROUTE_CACHE.delete(key);
    ROUTE_CACHE.set(key, cached);
    return cached && cached.map((p) => ({ ...p }));
  }
  const found = searchRoute(source, target, close, bend, extra);
  ROUTE_CACHE.set(key, found);
  if (ROUTE_CACHE.size > ROUTE_CACHE_SIZE) ROUTE_CACHE.delete(ROUTE_CACHE.keys().next().value!);
  return found && found.map((p) => ({ ...p }));
}

/** Caminos ya calculados (los más recientes; spec interacciones: el lienzo no repite el A* en cada edición). */
const ROUTE_CACHE = new Map<string, Point[] | null>();
const ROUTE_CACHE_SIZE = 4000;

function routeKey(source: Port, target: Port, close: Rect[], bend: { x?: number; y?: number } | undefined, extra: number) {
  const r = (v: number) => Math.round(v * 10) / 10;
  const boxes = close.map((b) => `${r(b.x)},${r(b.y)},${r(b.w)},${r(b.h)}`).join(';');
  return `${r(source.x)},${r(source.y)},${source.side}|${r(target.x)},${r(target.y)},${target.side}|${bend?.x ?? ''},${bend?.y ?? ''}|${extra}|${boxes}`;
}

/** Cuántos caminos guarda la caché (para las pruebas). */
export function routeCacheSize(): number {
  return ROUTE_CACHE.size;
}

function searchRoute(
  source: Port,
  target: Port,
  close: Rect[],
  bend: { x?: number; y?: number } | undefined,
  extra: number,
): Point[] | null {
  // Si el trazo de siempre no atraviesa ninguna caja (sin contar el margen), se deja como está.
  if (!pathHits(defaultRoute(source, target, bend), close)) return null;
  const near = close.map((r) => pad(r, ROUTE_PADDING + extra));

  const stub = STUB + extra;
  const start = { x: source.x + DIR[source.side].x * stub, y: source.y + DIR[source.side].y * stub };
  const end = { x: target.x + DIR[target.side].x * stub, y: target.y + DIR[target.side].y * stub };
  const inside = (p: Point) => near.some((r) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h);
  if (inside(start) || inside(end)) return null;

  // Líneas candidatas: las de los extremos, los bordes de cada caja (con su margen) y el medio entre extremos.
  const uniq = (values: number[]) => [...new Set(values.map((v) => Math.round(v)))].sort((a, b) => a - b);
  const xs = uniq([start.x, end.x, (start.x + end.x) / 2, ...near.flatMap((r) => [r.x, r.x + r.w])]);
  const ys = uniq([start.y, end.y, (start.y + end.y) / 2, ...near.flatMap((r) => [r.y, r.y + r.h])]);
  const xi = new Map(xs.map((x, i) => [x, i]));
  const yi = new Map(ys.map((y, i) => [y, i]));
  const blockedSeg = (a: Point, b: Point) => near.some((r) => segmentHits(a, b, r));

  // A* con estado (columna, fila, dirección de llegada): un doblez suma BEND_COST.
  type State = { i: number; j: number; d: number };
  const key = (s: State) => `${s.i},${s.j},${s.d}`;
  const DIRS = [
    { di: 1, dj: 0 },
    { di: -1, dj: 0 },
    { di: 0, dj: 1 },
    { di: 0, dj: -1 },
  ];
  const startDir = DIRS.findIndex((d) => d.di === Math.sign(DIR[source.side].x) && d.dj === Math.sign(DIR[source.side].y));
  // Llegar al destino moviéndose hacia la caja (sentido contrario al de su lado).
  const endDir = DIRS.findIndex((d) => d.di === -Math.sign(DIR[target.side].x) && d.dj === -Math.sign(DIR[target.side].y));
  const si = xi.get(Math.round(start.x))!;
  const sj = yi.get(Math.round(start.y))!;
  const ei = xi.get(Math.round(end.x))!;
  const ej = yi.get(Math.round(end.y))!;
  const h = (i: number, j: number) => Math.abs(xs[i]! - xs[ei]!) + Math.abs(ys[j]! - ys[ej]!);

  const best = new Map<string, number>();
  const from = new Map<string, State>();
  const open: { s: State; g: number; f: number }[] = [{ s: { i: si, j: sj, d: startDir }, g: 0, f: h(si, sj) }];
  best.set(key(open[0]!.s), 0);
  let found: State | null = null;
  let budget = 20000;
  while (open.length && budget-- > 0) {
    let k = 0;
    for (let n = 1; n < open.length; n++) if (open[n]!.f < open[k]!.f) k = n;
    const { s, g } = open.splice(k, 1)[0]!;
    if (g > (best.get(key(s)) ?? Infinity)) continue;
    if (s.i === ei && s.j === ej) {
      found = s;
      break;
    }
    DIRS.forEach((d, dir) => {
      // No dar media vuelta.
      if (DIRS[s.d] && DIRS[s.d]!.di === -d.di && DIRS[s.d]!.dj === -d.dj) return;
      const i = s.i + d.di;
      const j = s.j + d.dj;
      if (i < 0 || j < 0 || i >= xs.length || j >= ys.length) return;
      const a = { x: xs[s.i]!, y: ys[s.j]! };
      const b = { x: xs[i]!, y: ys[j]! };
      if (inside(b) || blockedSeg(a, b)) return;
      const turn = dir !== s.d ? BEND_COST : 0;
      const arriving = i === ei && j === ej && dir !== endDir ? BEND_COST : 0;
      const next = { i, j, d: dir };
      const cost = g + Math.abs(b.x - a.x) + Math.abs(b.y - a.y) + turn + arriving;
      if (cost >= (best.get(key(next)) ?? Infinity)) return;
      best.set(key(next), cost);
      from.set(key(next), s);
      open.push({ s: next, g: cost, f: cost + h(i, j) });
    });
  }
  if (!found) return null;

  const cells: Point[] = [];
  for (let s: State | undefined = found; s; s = from.get(key(s))) cells.unshift({ x: xs[s.i]!, y: ys[s.j]! });
  return simplify([{ x: source.x, y: source.y }, start, ...cells, end, { x: target.x, y: target.y }]);
}

/** `d` de un `<path>` por la polilínea, y el punto a mitad de su largo (para la etiqueta). */
export function polylinePath(points: Point[]): { d: string; labelX: number; labelY: number } {
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');
  const lengths = points.slice(1).map((p, i) => Math.abs(p.x - points[i]!.x) + Math.abs(p.y - points[i]!.y));
  let half = lengths.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < lengths.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (half <= lengths[i]!) {
      const t = lengths[i]! === 0 ? 0 : half / lengths[i]!;
      return { d, labelX: a.x + (b.x - a.x) * t, labelY: a.y + (b.y - a.y) * t };
    }
    half -= lengths[i]!;
  }
  const last = points[points.length - 1]!;
  return { d, labelX: last.x, labelY: last.y };
}
