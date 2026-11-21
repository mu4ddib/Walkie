import { describe, expect, it } from 'vitest';
import { autoLayout, catalogKey } from '../../map/mapLayout';
import { CANVAS_METRICS, planInitialCanvas, type CanvasDraft } from '../initialCanvas';
import { LAYOUT_CASES, pedidos } from './layoutFixtures';
import { draftBoxSize, measure, type Point } from './layoutQuality';

const edgesOf = (d: CanvasDraft) => d.edges.map((e) => ({ from: e.from, to: e.to }));
const sizeOf = (d: CanvasDraft) => {
  const nodes = new Map(d.nodes.map((n) => [n.key, n]));
  return (k: string) => draftBoxSize(nodes.get(k)!);
};

/** La distribución anterior (hasta esta spec): pantallas en columnas y todas las APIs en una grilla de 4 debajo. */
function previousLayout(d: CanvasDraft): Record<string, Point> {
  const screens = d.nodes.filter((n) => n.type === 'screen').map((n) => n.key).sort();
  const others = d.nodes.filter((n) => n.type !== 'screen').map((n) => n.key).sort();
  const depth = new Map(d.nodes.map((n) => [n.key, (n.route ?? '').split('/').filter(Boolean).length]));
  const forward = (a: string, b: string) => depth.get(a)! < depth.get(b)! || (depth.get(a) === depth.get(b) && a < b);
  const users: Record<string, string[]> = Object.fromEntries(others.map((k) => [k, [] as string[]]));
  for (const e of d.edges) if (e.kind === 'request' && users[e.to]) users[e.to]!.push(e.from);
  const auto = autoLayout(screens, d.edges.filter((e) => e.kind === 'navigation' && forward(e.from, e.to)), users, CANVAS_METRICS);
  return Object.fromEntries([...screens.map((k) => [k, auto[k]!]), ...others.map((k) => [k, auto[catalogKey(k)]!])]);
}

const results = Object.entries(LAYOUT_CASES).map(([name, d]) => {
  const t0 = performance.now();
  const after = planInitialCanvas(d).layout;
  const ms = performance.now() - t0;
  return { name, d, ms, after, before: measure(previousLayout(d), edgesOf(d), sizeOf(d)), now: measure(after, edgesOf(d), sizeOf(d)) };
});

describe('calidad del lienzo inicial (spec walkie-live-documentacion, parte 3)', () => {
  it.each(results)('$name: menos cruces que antes, ninguna caja encimada y en la grilla', ({ before, now, after }) => {
    expect(now.crossings).toBeLessThanOrEqual(before.crossings);
    expect(now.boxOverlaps).toBe(0);
    Object.values(after).forEach((p) => expect([p.x % 8, p.y % 8]).toEqual([0, 0]));
  });

  it('los lienzos densos de Walkie bajan los cruces al menos a la mitad y las etiquetas casi no se pisan', () => {
    for (const name of ['Walkie · Catalog', 'Walkie · Apps', '20 APIs', 'Sintético 30', 'Sintético 75']) {
      const r = results.find((x) => x.name === name)!;
      expect(r.now.crossings, name).toBeLessThanOrEqual(r.before.crossings / 2);
      expect(r.now.labelOverLabel, name).toBeLessThan(r.before.labelOverLabel);
    }
  });

  it('Pedidos (pocas APIs) queda tan compacto como antes y sin cruces', () => {
    const r = results.find((x) => x.name === 'Pedidos')!;
    expect(r.now.crossings).toBe(0);
    expect(r.now.width).toBeLessThanOrEqual(r.before.width);
    expect(r.now.height).toBeLessThanOrEqual(r.before.height);
    expect(r.now.fitZoom1280).toBeGreaterThanOrEqual(0.75);
    // Las APIs, debajo de la pantalla que las llama.
    const { layout } = planInitialCanvas(pedidos);
    expect(layout['api:GET /api/pedidos']!.y).toBeGreaterThan(layout['screen:web:/pedidos']!.y);
    expect(layout['api:GET /api/pedidos/{}']!.y).toBeGreaterThan(layout['screen:web:/pedidos/{}']!.y);
  });

  it('es determinista y rápida: 75 cajas en menos de 50 ms', () => {
    for (const r of results) expect(planInitialCanvas(r.d).layout).toEqual(r.after);
    expect(results.find((x) => x.name === 'Sintético 75')!.ms).toBeLessThan(50);
  });
});

