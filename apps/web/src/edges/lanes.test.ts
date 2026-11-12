import { describe, expect, it } from 'vitest';
import { laneOffsets, laneRoute, PAIR_LANE_GAP } from './lanes';
import { computePorts, type Rect } from './ports';
import { defaultRoute, routeAround, type Point } from './route';

type Seg = [Point, Point];
const segments = (points: Point[]): Seg[] => points.slice(1).map((p, i) => [points[i]!, p]);

/** ¿Dos tramos ortogonales se solapan a lo largo (colineales y con un trozo en común)? */
function overlap([a, b]: Seg, [c, d]: Seg): boolean {
  if (a.x === b.x && c.x === d.x && a.x === c.x) {
    return Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) > 0;
  }
  if (a.y === b.y && c.y === d.y && a.y === c.y) {
    return Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) > 0;
  }
  return false;
}
const shared = (p: Point[], q: Point[]) => segments(p).some((s) => segments(q).some((t) => overlap(s, t)));

/** Distancia mínima entre dos tramos paralelos que se enfrentan (los que corren lado a lado). */
function minParallelGap(p: Point[], q: Point[]): number {
  let min = Infinity;
  for (const [a, b] of segments(p).slice(1, -1)) {
    for (const [c, d] of segments(q).slice(1, -1)) {
      const vertical = a.x === b.x && c.x === d.x;
      const horizontal = a.y === b.y && c.y === d.y;
      if (vertical && Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) > Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y))) {
        min = Math.min(min, Math.abs(a.x - c.x));
      }
      if (horizontal && Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) > Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x))) {
        min = Math.min(min, Math.abs(a.y - c.y));
      }
    }
  }
  return min;
}

/** ¿Dos polilíneas se cruzan (un tramo vertical de una atraviesa uno horizontal de la otra, sin tocar extremos)? */
function crosses(p: Point[], q: Point[]): boolean {
  const cross = ([a, b]: Seg, [c, d]: Seg) => {
    if (a.x === b.x && c.y === d.y) {
      return a.x > Math.min(c.x, d.x) && a.x < Math.max(c.x, d.x) && c.y > Math.min(a.y, b.y) && c.y < Math.max(a.y, b.y);
    }
    if (a.y === b.y && c.x === d.x) return cross([c, d], [a, b]);
    return false;
  };
  return segments(p).some((s) => segments(q).some((t) => cross(s, t)));
}

/**
 * Conexiones de un par en carriles, como en el lienzo: el corredor es el de la primera (en el sentido canónico, de
 * «api» a «home»), y cada una lo sigue desde sus puertos.
 */
function lanesOf(rects: Record<string, Rect>, edges: { id: string; source: string; target: string }[], obstacles: Rect[] = []) {
  const ports = computePorts(edges, rects);
  const lanes = laneOffsets(edges.map((e) => ({ ...e, ports: ports[e.id]! })));
  const canonical = (e: { source: string; target: string }) => e.source < e.target;
  const ends = (e: { id: string; source: string; target: string }) => {
    const p = ports[e.id]!;
    return canonical(e) ? [p.source, p.target] : [p.target, p.source];
  };
  const [a, b] = ends(edges[0]!);
  const base = routeAround(a!, b!, obstacles) ?? defaultRoute(a!, b!);
  const routes: Record<string, Point[]> = {};
  for (const e of edges) {
    const [start, end] = ends(e);
    const r = laneRoute(base, start!, end!, lanes[e.id]!)!;
    routes[e.id] = canonical(e) ? r : [...r].reverse();
  }
  return { routes, ports, lanes };
}

/** Solicitud (home → api) y respuesta (api → home). */
function pair(rects: Record<string, Rect>, obstacles: Rect[] = []) {
  const { routes, ports } = lanesOf(
    rects,
    [
      { id: 'req', source: 'home', target: 'api' },
      { id: 'res', source: 'api', target: 'home' },
    ],
    obstacles,
  );
  return { req: routes.req!, res: routes.res!, ports };
}

const home: Rect = { x: 150, y: 95, w: 565, h: 470 };

describe('carriles de un par (spec conexiones-ida-y-vuelta)', () => {
  it('pantalla arriba a la izquierda y API abajo a la derecha (el caso reportado): nada compartido', () => {
    const { req, res, ports } = pair({ home, api: { x: 1250, y: 955, w: 395, h: 135 } });
    expect(shared(req, res)).toBe(false);
    expect(crosses(req, res)).toBe(false);
    expect(minParallelGap(req, res)).toBeGreaterThanOrEqual(12);
    // Los puertos no se mueven.
    expect(req[0]).toEqual({ x: ports.req!.source.x, y: ports.req!.source.y });
    expect(res[res.length - 1]).toEqual({ x: ports.res!.target.x, y: ports.res!.target.y });
  });

  it('en línea, apiladas y en diagonal hacia arriba', () => {
    const cases: Rect[] = [
      { x: 1000, y: 200, w: 200, h: 100 }, // a la derecha, a la misma altura
      { x: 300, y: 900, w: 200, h: 100 }, // debajo
      { x: 1100, y: -500, w: 200, h: 100 }, // arriba a la derecha
      { x: -600, y: 900, w: 200, h: 100 }, // abajo a la izquierda
    ];
    for (const api of cases) {
      const { req, res } = pair({ home, api });
      expect(shared(req, res)).toBe(false);
      expect(crosses(req, res)).toBe(false);
    }
  });

  it('rodeando una caja que está en medio: los tramos del rodeo van en paralelo', () => {
    const api: Rect = { x: 1400, y: 200, w: 200, h: 100 };
    const wall: Rect = { x: 950, y: 0, w: 120, h: 700 };
    const { req, res } = pair({ home, api }, [wall]);
    expect(req.length).toBeGreaterThan(4);
    expect(shared(req, res)).toBe(false);
    expect(minParallelGap(req, res)).toBeGreaterThanOrEqual(12);
  });

  it('una solicitud con dos respuestas: tres carriles, ninguno compartido', () => {
    const { routes, lanes } = lanesOf({ home, api: { x: 1250, y: 955, w: 395, h: 135 } }, [
      { id: 'req', source: 'home', target: 'api' },
      { id: 'ok', source: 'api', target: 'home' },
      { id: 'error', source: 'api', target: 'home' },
    ]);
    expect(Object.values(lanes).sort((x, y) => x - y)).toEqual([-PAIR_LANE_GAP, 0, PAIR_LANE_GAP]);
    const all = Object.values(routes);
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        expect(shared(all[i]!, all[j]!)).toBe(false);
        expect(crosses(all[i]!, all[j]!)).toBe(false);
      }
    }
  });

  it('una conexión sola no tiene carril; un corredor sin tramos interiores no se usa', () => {
    const ports = computePorts([{ id: 'a', source: 'home', target: 'api' }], { home, api: { x: 1000, y: 200, w: 200, h: 100 } });
    expect(laneOffsets([{ id: 'a', source: 'home', target: 'api', ports: ports.a! }])).toEqual({});
    const straight = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    expect(laneRoute(straight, straight[0]!, straight[1]!, 16)).toBeNull();
  });

  it('corre solo los tramos interiores, va a sus propios puertos y quita escalones de redondeo', () => {
    const base = [
      { x: 0, y: 0 },
      { x: 16, y: 0 },
      { x: 16, y: 0.4 }, // escalón de redondeo
      { x: 50, y: 0.4 },
      { x: 50, y: 100 },
      { x: 100, y: 100 },
    ];
    // Hacia abajo, la izquierda del sentido es x menor; los extremos son los de esta conexión.
    expect(laneRoute(base, { x: 0, y: 10 }, { x: 100, y: 90 }, 8)).toEqual([
      { x: 0, y: 10 },
      { x: 42, y: 10 },
      { x: 42, y: 90 },
      { x: 100, y: 90 },
    ]);
    expect(laneRoute(base, { x: 0, y: 0 }, { x: 100, y: 100 }, -8)![1]).toEqual({ x: 58, y: 0 });
  });
});
