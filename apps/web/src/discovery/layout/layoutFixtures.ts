/**
 * Borradores de lienzo para medir la distribución (spec walkie-live-documentacion, parte 3): los reales del análisis
 * de Walkie (`walkieDrafts.ts`: las propuestas «Apps» y «Catalog», con ids de catálogo ficticios), la tienda ficticia
 * de Pedidos, una feature de 20 APIs y lienzos sintéticos de 10, 30 y 75 cajas (generados con una semilla fija).
 */
import type { CanvasDraft } from '../initialCanvas';
import { WALKIE_DRAFTS as walkie } from './walkieDrafts';

type DraftNode = CanvasDraft['nodes'][number];
type DraftEdge = CanvasDraft['edges'][number];

const draft = (nodes: DraftNode[], edges: DraftEdge[]): CanvasDraft => ({ nodes, edges, interfaces: [], omitted: [] });
const id = (n: number) => `0198f0c0-1111-7000-8000-${String(n).padStart(12, '0')}`;
const screen = (route: string, title: string): DraftNode => ({ key: `screen:web:${route}`, type: 'screen', title, route });
const api = (sig: string, n: number): DraftNode => ({ key: `api:${sig}`, type: 'ref', title: sig, catalogId: id(n) });
const nav = (from: string, to: string): DraftEdge => ({ key: `navigates:${from}->${to}`, from, to, kind: 'navigation', operation: 'navigation' });
const call = (from: string, to: string): DraftEdge => ({ key: `calls:${from}->${to}`, from, to, kind: 'request', operation: 'http.request' });

export const pedidos: CanvasDraft = draft(
  [
    screen('/', 'Inicio'),
    screen('/pedidos', 'Pedidos'),
    screen('/pedidos/{}', 'Pedido'),
    api('GET /api/pedidos', 1),
    api('GET /api/pedidos/{}', 2),
    api('POST /api/pedidos', 3),
  ],
  [
    nav('screen:web:/', 'screen:web:/pedidos'),
    nav('screen:web:/pedidos', 'screen:web:/pedidos/{}'),
    nav('screen:web:/pedidos/{}', 'screen:web:/pedidos'),
    call('screen:web:/pedidos', 'api:GET /api/pedidos'),
    call('screen:web:/pedidos', 'api:POST /api/pedidos'),
    call('screen:web:/pedidos/{}', 'api:GET /api/pedidos/{}'),
  ],
);

/** Una lista y su detalle con 20 APIs: 8 de la lista, 8 del detalle y 4 compartidas. */
export const twentyApis: CanvasDraft = (() => {
  const list = screen('/cuentas', 'Cuentas');
  const detail = screen('/cuentas/{}', 'Cuenta');
  const apis = Array.from({ length: 20 }, (_, i) => api(`GET /api/cuentas/recurso-${String(i).padStart(2, '0')}`, i));
  const edges = [nav(list.key, detail.key), nav(detail.key, list.key)];
  apis.forEach((a, i) => {
    if (i < 8 || i >= 16) edges.push(call(list.key, a.key));
    if (i >= 8) edges.push(call(detail.key, a.key));
  });
  return draft([list, detail, ...apis], edges);
})();

/** Generador con semilla (mulberry32): el mismo borrador en cada corrida. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `total` cajas: un cuarto pantallas (navegación en árbol desde la primera), el resto APIs llamadas por 1 o 2. */
export function synthetic(total: number, seed = total): CanvasDraft {
  const next = random(seed);
  const count = Math.max(2, Math.round(total / 4));
  const screens = Array.from({ length: count }, (_, i) => screen(`/s${i}${i > 0 ? `/${'{}/'.repeat(Math.floor(Math.log2(i + 1)))}` : ''}`, `Pantalla ${i}`));
  const apis = Array.from({ length: total - count }, (_, i) => api(`GET /api/r${String(i).padStart(3, '0')}`, i));
  const edges: DraftEdge[] = [];
  screens.forEach((s, i) => {
    if (i > 0) edges.push(nav(screens[Math.floor((i - 1) / 2)]!.key, s.key));
  });
  apis.forEach((a) => {
    const first = Math.floor(next() * count);
    edges.push(call(screens[first]!.key, a.key));
    if (next() < 0.3) {
      const second = Math.min(count - 1, first + 1);
      if (second !== first) edges.push(call(screens[second]!.key, a.key));
    }
  });
  return draft([...screens, ...apis], edges);
}

export const walkieApps: CanvasDraft = { ...walkie.Apps, interfaces: [], omitted: [] };
export const walkieCatalog: CanvasDraft = { ...walkie.Catalog, interfaces: [], omitted: [] };

export const LAYOUT_CASES: Record<string, CanvasDraft> = {
  'Walkie · Catalog': walkieCatalog,
  'Walkie · Apps': walkieApps,
  Pedidos: pedidos,
  '20 APIs': twentyApis,
  'Sintético 10': synthetic(10),
  'Sintético 30': synthetic(30),
  'Sintético 75': synthetic(75),
};
