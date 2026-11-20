import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '../schema/walkie-graph';
import { focusOf, hiddenCalls, summaryHidden } from './viewModes';

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
