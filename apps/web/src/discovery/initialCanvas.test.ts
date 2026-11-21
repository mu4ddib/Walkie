import { describe, expect, it } from 'vitest';
import { planAttachCanvas, planInitialCanvas, type CanvasDraft } from './initialCanvas';
import { boxSize, draftBoxSize, lines } from './layout/layoutQuality';

const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BOX = { w: 184, h: 72 }; // la caja de Canvas.tsx; la API rechaza dos así encimadas (con 8 px de aire)

const feature: CanvasDraft = {
  nodes: [
    { key: 'screen:web:/pedidos', type: 'screen', title: 'Pedidos', route: '/pedidos' },
    { key: 'screen:web:/pedidos/{}', type: 'screen', title: 'Pedido', route: '/pedidos/:id' },
    { key: 'screen:web:/', type: 'screen', title: 'Inicio', route: '/' },
    { key: 'api:GET /api/pedidos', type: 'ref', title: 'Lista', catalogId: '0198f0c0-1111-7000-8000-000000000001' },
    { key: 'api:GET /api/pedidos/{}', type: 'ref', title: 'Detalle', catalogId: '0198f0c0-1111-7000-8000-000000000002' },
  ],
  edges: [
    { key: 'navigates:screen:web:/->screen:web:/pedidos', from: 'screen:web:/', to: 'screen:web:/pedidos', kind: 'navigation', operation: 'navigation' },
    { key: 'navigates:screen:web:/pedidos->screen:web:/pedidos/{}', from: 'screen:web:/pedidos', to: 'screen:web:/pedidos/{}', kind: 'navigation', operation: 'navigation' },
    { key: 'calls:a', from: 'screen:web:/pedidos', to: 'api:GET /api/pedidos', kind: 'request', operation: 'http.request' },
    { key: 'calls:b', from: 'screen:web:/pedidos/{}', to: 'api:GET /api/pedidos/{}', kind: 'request', operation: 'http.request' },
  ],
  interfaces: [],
  omitted: [],
};

const overlaps = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  a.x < b.x + BOX.w + 8 && b.x < a.x + BOX.w + 8 && a.y < b.y + BOX.h + 8 && b.y < a.y + BOX.h + 8;

describe('lienzo inicial de Walkie Live', () => {
  it('da un UUID v7 a cada clave y una posición a cada caja, en la grilla y sin encimarse', () => {
    const plan = planInitialCanvas(feature);
    const ids = [...Object.values(plan.nodes), ...Object.values(plan.edges)];
    expect(ids).toHaveLength(9);
    expect(new Set(ids).size).toBe(9);
    ids.forEach((id) => expect(id).toMatch(V7));
    const boxes = Object.values(plan.layout);
    expect(boxes).toHaveLength(5);
    boxes.forEach((p) => expect([p.x % 8, p.y % 8]).toEqual([0, 0]));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i]!, boxes[j]!)).toBe(false);
  });

  it('sigue la navegación de izquierda a derecha y pone las APIs debajo de las pantallas que las llaman', () => {
    const { layout } = planInitialCanvas(feature);
    expect(layout['screen:web:/']!.x).toBeLessThan(layout['screen:web:/pedidos']!.x);
    expect(layout['screen:web:/pedidos']!.x).toBeLessThan(layout['screen:web:/pedidos/{}']!.x);
    const lowestScreen = Math.max(...['screen:web:/', 'screen:web:/pedidos', 'screen:web:/pedidos/{}'].map((k) => layout[k]!.y));
    expect(layout['api:GET /api/pedidos']!.y).toBeGreaterThan(lowestScreen);
    expect(layout['api:GET /api/pedidos/{}']!.x).toBeGreaterThan(layout['api:GET /api/pedidos']!.x);
  });

  it('un enlace de vuelta (detalle → lista) no apila la lista y su detalle en una columna', () => {
    const cycle: CanvasDraft = {
      ...feature,
      edges: [
        ...feature.edges,
        { key: 'navigates:back', from: 'screen:web:/pedidos/{}', to: 'screen:web:/pedidos', kind: 'navigation', operation: 'navigation' },
      ],
    };
    const { layout } = planInitialCanvas(cycle);
    expect(layout['screen:web:/pedidos']!.x).toBeLessThan(layout['screen:web:/pedidos/{}']!.x);
    expect(layout['screen:web:/pedidos']!.y).toBe(layout['screen:web:/pedidos/{}']!.y);
  });

  it('es determinista y conserva los ids de un plan anterior del mismo borrador', () => {
    const first = planInitialCanvas(feature);
    const again = planInitialCanvas(feature, first);
    expect(again).toEqual(first);
    expect(planInitialCanvas(feature).layout).toEqual(first.layout);
  });

  it('un módulo pone sus APIs en una columna y da un id a cada interfaz', () => {
    const module: CanvasDraft = {
      nodes: feature.nodes.filter((n) => n.type === 'ref'),
      edges: [],
      interfaces: [{ key: 'api:GET /api/pedidos', name: 'Lista', kind: 'provides', node: 'api:GET /api/pedidos' }],
      omitted: [],
    };
    const plan = planInitialCanvas(module);
    expect(plan.interfaces?.['api:GET /api/pedidos']).toMatch(V7);
    const [a, b] = Object.values(plan.layout);
    expect(a!.x).toBe(b!.x);
    expect(overlaps(a!, b!)).toBe(false);
  });

  // Cambio de comportamiento esperado (spec walkie-live-documentacion, parte 3): antes, todas las APIs iban en una
  // grilla de 4 debajo de las pantallas (spec walkie-live-arquitectura) y las llamadas cruzaban el lienzo; ahora cada
  // API va junto a la pantalla que la llama, en columnas, con el corredor de la navegación libre.
  it('con muchas APIs pone cada una junto a la pantalla que la llama, sin encimarse ni tapar la navegación', () => {
    const apis = Array.from({ length: 11 }, (_, i) => `api:GET /api/recurso/${i}`);
    const draft: CanvasDraft = {
      ...feature,
      nodes: [...feature.nodes.filter((n) => n.type === 'screen'), ...apis.map((key, i) => ({ key, type: 'ref' as const, title: key, catalogId: `0198f0c0-1111-7000-8000-0000000001${String(i).padStart(2, '0')}` }))],
      edges: [
        ...feature.edges.filter((e) => e.kind === 'navigation'),
        ...apis.map((to, i) => ({ key: `calls:${i}`, from: i % 2 ? 'screen:web:/pedidos' : 'screen:web:/pedidos/{}', to, kind: 'request' as const, operation: 'http.request' as const })),
      ],
    };
    const { layout } = planInitialCanvas(draft);

    const list = layout['screen:web:/pedidos']!;
    const detail = layout['screen:web:/pedidos/{}']!;
    expect(list.x).toBeLessThan(detail.x);
    apis.forEach((key, i) => {
      const p = layout[key]!;
      // Las de la lista, entre la lista y su detalle; las del detalle, a su derecha.
      if (i % 2) expect(p.x > list.x && p.x < detail.x).toBe(true);
      else expect(p.x).toBeGreaterThan(detail.x);
      // La navegación lista → detalle va por la fila de las pantallas: ninguna API se cruza en ese corredor.
      if (i % 2) expect(p.y).toBeGreaterThan(list.y + BOX.h);
    });
    const all = Object.values(layout);
    all.forEach((a, i) => all.slice(i + 1).forEach((b) => expect(overlaps(a, b)).toBe(false)));
  });
});

describe('tamaño real de las cajas (spec walkie-live-documentacion, revisión final)', () => {
  it('la web reserva lo mismo que valida la API (BoxSizes.Estimate, CanvasGeometryTests)', () => {
    expect(boxSize('GET /api/apps', 'GET /api/apps')).toEqual({ w: 184, h: 89 });
    expect(boxSize('PUT /api/apps/{appId}/members/{userId}', 'PUT /api/apps/{appId}/members/{userId}')).toEqual({ w: 264, h: 167 });
    expect(boxSize('Inicio', undefined, 'Ruta: /')).toEqual({ w: 184, h: 87 });
    expect(lines('PUT /api/apps/{appId}/members/{userId}', 29)).toBe(3);
  });

  it('incorporar ubica lo nuevo a la derecha de la caja más ancha y sin encimar las nuevas entre sí', () => {
    const draft: CanvasDraft = {
      nodes: [
        { key: 'screen:web:/', type: 'screen', title: 'Inicio', route: '/' },
        { key: 'api:a', type: 'ref', title: 'PUT /api/apps/{appId}/members/{userId}', catalogId: '0198f0c0-1111-7000-8000-000000000001' },
        { key: 'api:b', type: 'ref', title: 'POST /api/apps/{appId}/sources/snapshots', catalogId: '0198f0c0-1111-7000-8000-000000000002' },
      ],
      edges: [],
      interfaces: [],
      omitted: [],
    };
    const existing = {
      nodes: { big: { type: 'api', title: 'GET /api/x/y/z/una-ruta-bastante-larga', http: { method: 'GET', path: '/api/x/y/z/una-ruta-bastante-larga' } } },
      layout: { big: { x: 0, y: 40 }, g: { x: 300, y: 0, w: 500, h: 300 } },
    };
    const plan = planAttachCanvas(draft, existing);
    const placed = Object.entries(plan.layout).map(([key, p]) => ({ ...p, ...draftBoxSize(draft.nodes.find((n) => n.key === key)!) }));
    // A la derecha del grupo (su ancho guardado manda), con aire.
    placed.forEach((p) => expect(p.x).toBeGreaterThanOrEqual(800 + 8));
    const sorted = [...placed].sort((a, b) => a.y - b.y);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i]!.y).toBeGreaterThanOrEqual(sorted[i - 1]!.y + sorted[i - 1]!.h + 8);
    expect(Object.keys(plan.layout)).not.toContain('big');
  });
});
