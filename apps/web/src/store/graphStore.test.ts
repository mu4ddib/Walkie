import { beforeEach, describe, expect, it } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';
import type { WalkieCanvasGraphV0 } from '../schema/walkie-graph';
import { createGraphStore, defaultEdgeKind, snap, toGraph, type GraphStore } from './graphStore';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let store: StoreApi<GraphStore>;
const s = () => store.getState();

beforeEach(() => {
  store = createGraphStore();
});

describe('addNode', () => {
  it('crea el nodo con id UUID v7, título por defecto y posición en la grilla', () => {
    const id = s().addNode('database', { x: 13, y: 21 });

    expect(id).toMatch(UUID_V7);
    expect(s().nodes[id]).toEqual({ id, type: 'database', title: 'Base de datos' });
    expect(s().layout[id]).toEqual({ x: 16, y: 24 });
    expect(s().dirty).toBe(true);
  });

  it('usa los títulos de la spec para screen y api', () => {
    const screen = s().addNode('screen', { x: 0, y: 0 });
    const api = s().addNode('api', { x: 0, y: 0 });

    expect(s().nodes[screen]?.title).toBe('Pantalla');
    expect(s().nodes[api]?.title).toBe('API');
  });
});

describe('moveNode', () => {
  it('ajusta la posición a múltiplos de 8', () => {
    const id = s().addNode('screen', { x: 0, y: 0 });
    s().markSaved(1);

    s().moveNode(id, { x: 101, y: -3 });

    expect(s().layout[id]).toEqual({ x: 104, y: 0 });
    expect(s().dirty).toBe(true);
  });

  it('no marca cambios si la posición ajustada es la misma', () => {
    const id = s().addNode('screen', { x: 8, y: 8 });
    s().markSaved(1);

    s().moveNode(id, { x: 9, y: 7 });

    expect(s().dirty).toBe(false);
  });

  it('ignora nodos inexistentes', () => {
    s().moveNode('nada', { x: 8, y: 8 });

    expect(s().layout).toEqual({});
  });
});

describe('renameNode', () => {
  it('recorta espacios y limita a 120 caracteres', () => {
    const id = s().addNode('screen', { x: 0, y: 0 });

    s().renameNode(id, `  ${'a'.repeat(130)}  `);

    expect(s().nodes[id]?.title).toBe('a'.repeat(120));
  });

  it('ignora títulos vacíos', () => {
    const id = s().addNode('screen', { x: 0, y: 0 });

    s().renameNode(id, '   ');

    expect(s().nodes[id]?.title).toBe('Pantalla');
  });
});

describe('connect', () => {
  it.each([
    ['screen', 'screen', 'navigation'],
    ['screen', 'api', 'request'],
    ['api', 'screen', 'response'],
    ['api', 'database', 'reads'],
    ['database', 'screen', 'uses'],
  ] as const)('%s → %s usa %s por defecto', (from, to, kind) => {
    expect(defaultEdgeKind(from, to)).toBe(kind);
  });

  it('crea la conexión con el tipo por defecto según el par', () => {
    const screen = s().addNode('screen', { x: 0, y: 0 });
    const api = s().addNode('api', { x: 0, y: 0 });

    const id = s().connect(screen, api);

    expect(id).toMatch(UUID_V7);
    expect(s().edges[id!]).toEqual({ id, from: screen, to: api, kind: 'request' });
  });

  it('respeta un tipo explícito', () => {
    const api = s().addNode('api', { x: 0, y: 0 });
    const db = s().addNode('database', { x: 0, y: 0 });

    const id = s().connect(api, db, 'writes');

    expect(s().edges[id!]?.kind).toBe('writes');
  });

  it('rechaza conexiones a sí mismo o a nodos inexistentes', () => {
    const screen = s().addNode('screen', { x: 0, y: 0 });

    expect(s().connect(screen, screen)).toBeNull();
    expect(s().connect(screen, 'nada')).toBeNull();
    expect(s().edges).toEqual({});
  });
});

describe('setEdgeKind y removeEdge', () => {
  it('cambia el tipo y borra la conexión', () => {
    const api = s().addNode('api', { x: 0, y: 0 });
    const db = s().addNode('database', { x: 0, y: 0 });
    const id = s().connect(api, db)!;

    s().setEdgeKind(id, 'writes');
    expect(s().edges[id]?.kind).toBe('writes');

    s().removeEdge(id);
    expect(s().edges).toEqual({});
  });
});

describe('removeNode', () => {
  it('borra el nodo, su layout y sus conexiones, sin tocar las demás', () => {
    const a = s().addNode('screen', { x: 0, y: 0 });
    const b = s().addNode('api', { x: 0, y: 0 });
    const c = s().addNode('database', { x: 0, y: 0 });
    s().connect(a, b);
    const keep = s().connect(b, c)!;
    s().connect(c, a);

    s().removeNode(a);

    expect(Object.keys(s().nodes).sort()).toEqual([b, c].sort());
    expect(s().layout[a]).toBeUndefined();
    expect(Object.keys(s().edges)).toEqual([keep]);
  });
});

describe('loadGraph, markSaved y toGraph', () => {
  const graph: WalkieCanvasGraphV0 = {
    schemaVersion: 0,
    version: 3,
    nodes: { n1: { id: 'n1', type: 'screen', title: 'Login' } },
    edges: {},
    layout: { n1: { x: 8, y: 16 } },
  };

  it('cargar deja el estado sin cambios pendientes y toGraph lo devuelve igual', () => {
    s().addNode('api', { x: 0, y: 0 });

    s().loadGraph(graph);

    expect(s().dirty).toBe(false);
    expect(toGraph(s())).toEqual(graph);
  });

  it('markSaved adopta la versión del servidor y limpia dirty', () => {
    s().loadGraph(graph);
    s().renameNode('n1', 'Login v2');
    expect(s().dirty).toBe(true);

    s().markSaved(4);

    expect(s().dirty).toBe(false);
    expect(toGraph(s()).version).toBe(4);
  });

  it('las acciones no mutan el objeto cargado', () => {
    const copy = structuredClone(graph);
    s().loadGraph(copy);

    s().moveNode('n1', { x: 80, y: 80 });
    s().renameNode('n1', 'Otro');
    s().removeNode('n1');

    expect(copy).toEqual(graph);
  });
});

describe('snap', () => {
  it('redondea al múltiplo de 8 más cercano', () => {
    expect([0, 3, 4, 12, -5].map(snap)).toEqual([0, 0, 8, 16, -8]);
  });
});
