import type { Port, Side } from './ports';
import type { Point } from './route';

/**
 * Carriles de las conexiones entre un mismo par de cajas (spec conexiones-ida-y-vuelta): una solicitud y su respuesta
 * (o cualquier par de conexiones entre las mismas cajas) van en paralelo, cada una en su carril, en todo el recorrido:
 * en el doblez del trazo de siempre y en los tramos que rodean cajas. Los puertos no se mueven (ya están repartidos a
 * lo largo de su lado); se desplazan solo los tramos interiores.
 */

/** Separación entre carriles vecinos (px). */
export const PAIR_LANE_GAP = 16;

const DIR: Record<Side, Point> = { right: { x: 1, y: 0 }, left: { x: -1, y: 0 }, bottom: { x: 0, y: 1 }, top: { x: 0, y: -1 } };

/** Normal a la izquierda de una dirección (en coordenadas de pantalla, con y hacia abajo). */
const normal = (d: Point): Point => ({ x: -d.y, y: d.x });

export interface LaneEdge {
  id: string;
  /** Cajas visibles de cada extremo. */
  source: string;
  target: string;
  ports: { source: Port; target: Port };
}

/**
 * Desplazamiento de cada conexión respecto del eje del par, en el sentido canónico del par (de la caja con id menor a
 * la otra): así una solicitud y su respuesta, que van en sentidos opuestos, quedan a un lado y otro del eje. El orden de
 * los carriles sigue el de los puertos en la caja de partida, para que los trazos no se crucen al salir.
 */
export function laneOffsets(edges: readonly LaneEdge[], gap = PAIR_LANE_GAP): Record<string, number> {
  const pairs = new Map<string, LaneEdge[]>();
  for (const edge of edges) {
    const key = edge.source < edge.target ? `${edge.source}|${edge.target}` : `${edge.target}|${edge.source}`;
    pairs.set(key, [...(pairs.get(key) ?? []), edge]);
  }
  const result: Record<string, number> = {};
  for (const [key, list] of pairs) {
    if (list.length < 2) continue;
    const first = key.split('|')[0]!;
    // Posición de cada conexión en la caja de partida, medida hacia la normal del primer tramo.
    const rank = (edge: LaneEdge) => {
      const port = edge.source === first ? edge.ports.source : edge.ports.target;
      const n = normal(DIR[port.side]);
      return port.x * n.x + port.y * n.y;
    };
    const sorted = [...list].sort((a, b) => rank(a) - rank(b));
    sorted.forEach((edge, i) => {
      result[edge.id] = (i - (sorted.length - 1) / 2) * gap;
    });
  }
  return result;
}

/** Quita escalones de menos de 1 px (redondeos del rodeo) y vértices en medio de tramos rectos. */
function clean(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) + Math.abs(last.y - p.y) < 1) {
      // El último punto (un puerto) manda sobre el que estaba casi en el mismo lugar.
      if (p === points[points.length - 1]) out[out.length - 1] = p;
      continue;
    }
    out.push(p);
  }
  const straight: Point[] = [];
  for (const p of out) {
    const a = straight[straight.length - 2];
    const b = straight[straight.length - 1];
    const along = (u: Point, v: Point, w: Point, k: 'x' | 'y') => Math.abs(u[k] - v[k]) < 0.5 && Math.abs(v[k] - w[k]) < 0.5;
    if (a && b && (along(a, b, p, 'x') || along(a, b, p, 'y'))) straight[straight.length - 1] = p;
    else straight.push(p);
  }
  return straight;
}

/**
 * El trazo de una conexión del par siguiendo el corredor `base` (en el sentido canónico del par), desde su puerto
 * `start` hasta `end`, corrido `offset` px a la izquierda del sentido. El primer y el último tramo van a los puertos
 * (no se corren); cada tramo interior se corre en perpendicular y los vértices se recalculan, así el trazo sigue
 * siendo ortogonal y continuo. `null` si el corredor no tiene tramos interiores (cajas enfrentadas en línea recta).
 */
export function laneRoute(base: readonly Point[], start: Point, end: Point, offset: number): Point[] | null {
  const path = clean(base);
  if (path.length < 4) return null;
  const firstVertical = Math.abs(path[1]!.x - path[0]!.x) < 0.5;
  const count = path.length - 1;
  // Cada tramo: si es vertical, su x; si es horizontal, su y (los tramos alternan).
  const at = path.slice(0, count).map((a, i) => {
    const b = path[i + 1]!;
    const vertical = (i % 2 === 0) === firstVertical;
    if (i === 0) return { vertical, at: vertical ? start.x : start.y };
    if (i === count - 1) return { vertical, at: vertical ? end.x : end.y };
    // Izquierda del sentido (y hacia abajo): bajando, x menor; yendo a la derecha, y mayor.
    const sign = Math.sign(vertical ? b.y - a.y : b.x - a.x);
    return { vertical, at: vertical ? a.x - sign * offset : a.y + sign * offset };
  });
  const out: Point[] = [{ x: start.x, y: start.y }];
  for (let i = 0; i < count - 1; i++) {
    const s = at[i]!;
    const next = at[i + 1]!;
    out.push(s.vertical ? { x: s.at, y: next.at } : { x: next.at, y: s.at });
  }
  out.push({ x: end.x, y: end.y });
  return out;
}
