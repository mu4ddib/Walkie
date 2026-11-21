import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '../schema/walkie-graph';
import { compactPositions, focusOf, hiddenCalls, summaryHidden } from './viewModes';

const nodes: Record<string, Node> = {
  s1: { id: 's1', type: 'screen', title: 'Lista' },
  s2: { id: 's2', type: 'screen', title: 'Detalle' },
  a1: { id: 'a1', type: 'api', title: 'GET /a' },
  r1: { id: 'r1', type: 'ref', title: 'GET /b', catalogId: 'c1' },
  db: { id: 'db', type: 'database', title: 'BD' },
  p1: { id: 'p1', type: 'portal', title: 'Otra' },
};
const edges: Record<string, Edge> = {
  n: { id: 'n', from: 's1', to: 's2', kind: 'navigation' },
  c1: { id: 'c1', from: 's1', to: 'a1', kind: 'request' },
  c2: { id: 'c2', from: 's1', to: 'r1', kind: 'request' },
  c3: { id: 'c3', from: 's2', to: 'r1', kind: 'request' },
  back: { id: 'back', from: 'r1', to: 's2', kind: 'response' },
  q: { id: 'q', from: 'a1', to: 'db', kind: 'reads' },
  pp: { id: 'pp', from: 's2', to: 'p1', kind: 'navigation' },
};
const typeOf = (n: Node) => (n.type === 'ref' ? 'api' : n.type);

describe('modos de presentación del lienzo', () => {
  it('el resumen oculta lo técnico (también un componente del catálogo) y cuenta a qué llama cada caja', () => {
    const hidden = summaryHidden(nodes, typeOf);
    expect([...hidden].sort()).toEqual(['a1', 'db', 'r1']);
    // Una respuesta no cuenta; la base que consulta la API tampoco (la API ya está oculta).
    expect(hiddenCalls(edges, hidden)).toEqual({ s1: 2, s2: 1 });
  });

  it('al explorar, lo elegido trae a sus vecinas y sus conexiones; sin selección no se atenúa nada', () => {
    expect(focusOf(edges, new Set(), new Set())).toBeNull();
    const focus = focusOf(edges, new Set(['s2']), new Set())!;
    expect([...focus.nodes].sort()).toEqual(['p1', 'r1', 's1', 's2']);
    expect([...focus.edges].sort()).toEqual(['back', 'c3', 'n', 'pp']);
    const byEdge = focusOf(edges, new Set(), new Set(['q']))!;
    expect([...byEdge.nodes].sort()).toEqual(['a1', 'db']);
  });

  it('no cambia el grafo', () => {
    const before = JSON.stringify({ nodes, edges });
    focusOf(edges, new Set(['s1']), new Set());
    hiddenCalls(edges, summaryHidden(nodes, typeOf));
    expect(JSON.stringify({ nodes, edges })).toBe(before);
  });
});

describe('Resumen compacto', () => {
  const overlap = (a: { x: number; y: number }, b: { x: number; y: number }, w = 184, h = 100) =>
    a.x < b.x + w && b.x < a.x + w && a.y < b.y + h && b.y < a.y + h;

  it('junta las pantallas sin los huecos de las APIs ocultas, en el mismo orden', () => {
    // Tres pantallas en fila con dos bloques de APIs (ocultas) entre ellas: 1200 px de ancho que sobran.
    const boxes = [
      { id: 'a', x: 0, y: 0, w: 184, h: 100 },
      { id: 'b', x: 800, y: 0, w: 184, h: 100 },
      { id: 'c', x: 1800, y: 0, w: 184, h: 100 },
      { id: 'd', x: 800, y: 600, w: 184, h: 100 },
    ];
    const p = compactPositions(boxes);
    expect(p.a).toEqual({ x: 0, y: 0 });
    expect(p.b!.x).toBe(304);
    expect(p.c!.x).toBe(608);
    // La de abajo sigue debajo de su compañera de columna, sin el hueco.
    expect(p.d).toEqual({ x: 304, y: 176 });
    // El orden de izquierda a derecha y de arriba abajo se conserva.
    expect(p.a!.x < p.b!.x && p.b!.x < p.c!.x && p.b!.y < p.d!.y).toBe(true);
  });

  it('no encima lo que no estaba encimado y es determinista', () => {
    const boxes = Array.from({ length: 30 }, (_, i) => ({ id: `n${i}`, x: (i % 6) * 413 + (i % 2) * 37, y: Math.floor(i / 6) * 291, w: 184 + (i % 3) * 40, h: 90 }));
    const p = compactPositions(boxes);
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) expect(overlap(p[boxes[i]!.id]!, p[boxes[j]!.id]!, 184, 90)).toBe(false);
    expect(compactPositions(boxes)).toEqual(p);
  });
});
