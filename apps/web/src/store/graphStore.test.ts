import { beforeEach, describe, expect, it } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';
import type { WalkieCanvasGraphV0 } from '../schema/walkie-graph';
import { createGraphStore, defaultEdgeKind, inputNameError, snap, toGraph, type GraphStore } from './graphStore';

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

describe('addRef', () => {
  it('crea un nodo ref con catalogId, el título del elemento y posición en la grilla', () => {
    const id = s().addRef({ id: 'item-1', title: '  Consultar cliente ' }, { x: 13, y: 21 });

    expect(s().nodes[id]).toEqual({ id, type: 'ref', title: 'Consultar cliente', catalogId: 'item-1' });
    expect(s().layout[id]).toEqual({ x: 16, y: 24 });
    expect(s().dirty).toBe(true);
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
    ['actor', 'screen', 'navigation'],
    ['api', 'service', 'request'],
    ['service', 'database', 'reads'],
    ['screen', 'rule', 'uses'],
    ['database', 'screen', 'uses'],
    ['rule', 'service', 'uses'],
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

describe('removeNode de una regla', () => {
  it('quita la regla de los ruleIds de los inputs, sin tocar las demás', () => {
    const screen = s().addNode('screen', { x: 0, y: 0 });
    const r1 = s().addNode('rule', { x: 0, y: 0 });
    const r2 = s().addNode('rule', { x: 0, y: 0 });
    s().addInput(screen, { name: 'documento', ruleIds: [r1, r2] });
    s().addInput(screen, { name: 'clave', ruleIds: [r1] });

    s().removeNode(r1);

    expect(s().nodes[screen]?.inputs).toEqual([
      { name: 'documento', type: 'string', ruleIds: [r2] },
      { name: 'clave', type: 'string' },
    ]);
  });
});

describe('updateNode', () => {
  it('cambia título, descripción y expresión, recortados', () => {
    const id = s().addNode('rule', { x: 0, y: 0 });
    s().markSaved(1);

    s().updateNode(id, { title: '  Documento válido ', description: ' Valida la cc ', expression: 'cc: solo dígitos' });

    expect(s().nodes[id]).toEqual({
      id,
      type: 'rule',
      title: 'Documento válido',
      description: 'Valida la cc',
      expression: 'cc: solo dígitos',
    });
    expect(s().dirty).toBe(true);
  });

  it('un texto vacío quita el campo; un título vacío se ignora', () => {
    const id = s().addNode('screen', { x: 0, y: 0 });
    s().updateNode(id, { description: 'algo' });

    s().updateNode(id, { title: '  ', description: '' });

    expect(s().nodes[id]).toEqual({ id, type: 'screen', title: 'Pantalla' });
  });

  it('respeta los límites del schema', () => {
    const id = s().addNode('rule', { x: 0, y: 0 });

    s().updateNode(id, { title: 'x'.repeat(200), expression: 'y'.repeat(3000) });

    expect(s().nodes[id]?.title).toHaveLength(120);
    expect(s().nodes[id]?.expression).toHaveLength(2000);
  });

  it('guarda método y ruta de una API y los quita al vaciarlos', () => {
    const id = s().addNode('api', { x: 0, y: 0 });

    s().updateNode(id, { http: { method: 'POST', path: ' /clientes/{id} ' } });
    expect(s().nodes[id]?.http).toEqual({ method: 'POST', path: '/clientes/{id}' });

    s().updateNode(id, { http: { path: '' } });
    expect(s().nodes[id]?.http).toEqual({ method: 'POST' });

    s().updateNode(id, { http: { method: null } });
    expect(s().nodes[id]?.http).toBeUndefined();
  });

  it('no marca cambios si nada cambia', () => {
    const id = s().addNode('screen', { x: 0, y: 0 });
    s().markSaved(1);

    s().updateNode(id, { title: 'Pantalla', description: '' });

    expect(s().dirty).toBe(false);
  });
});

describe('inputs', () => {
  it('addInput agrega al final con un nombre libre y tipo string', () => {
    const id = s().addNode('screen', { x: 0, y: 0 });

    const first = s().addInput(id);
    const second = s().addInput(id);

    expect([first, second]).toEqual([0, 1]);
    expect(s().nodes[id]?.inputs).toEqual([
      { name: 'campo', type: 'string' },
      { name: 'campo 2', type: 'string' },
    ]);
  });

  it('addInput rechaza nombres repetidos o vacíos y nodos inexistentes', () => {
    const id = s().addNode('screen', { x: 0, y: 0 });
    s().addInput(id, { name: 'cc' });

    expect(s().addInput(id, { name: ' cc ' })).toBeNull();
    expect(s().addInput(id, { name: ' ' })).toBeNull();
    expect(s().addInput('nada')).toBeNull();
    expect(s().nodes[id]?.inputs).toHaveLength(1);
  });

  it('updateInput cambia nombre, tipo y obligatorio', () => {
    const id = s().addNode('screen', { x: 0, y: 0 });
    s().addInput(id);

    expect(s().updateInput(id, 0, { name: 'fecha', type: 'date', required: true })).toBe(true);

    expect(s().nodes[id]?.inputs).toEqual([{ name: 'fecha', type: 'date', required: true }]);
  });

  it('updateInput no permite nombres repetidos ni vacíos', () => {
    const id = s().addNode('screen', { x: 0, y: 0 });
    s().addInput(id, { name: 'cc' });
    s().addInput(id, { name: 'clave' });
    s().markSaved(1);

    expect(s().updateInput(id, 1, { name: 'cc' })).toBe(false);
    expect(s().updateInput(id, 1, { name: '' })).toBe(false);
    expect(s().updateInput(id, 0, { name: 'cc' })).toBe(true);
    expect(s().nodes[id]?.inputs?.map((i) => i.name)).toEqual(['cc', 'clave']);
    expect(s().dirty).toBe(false);
  });

  it('inputNameError explica por qué un nombre no sirve', () => {
    const id = s().addNode('screen', { x: 0, y: 0 });
    s().addInput(id, { name: 'cc' });
    const node = s().nodes[id]!;

    expect(inputNameError(node, 'cc')).toBe('Ya hay un input con ese nombre.');
    expect(inputNameError(node, '  ')).toBe('El nombre no puede quedar vacío.');
    expect(inputNameError(node, 'cc', 0)).toBeNull();
    expect(inputNameError(node, 'clave')).toBeNull();
  });

  it('options solo en enum: se limpian y se descartan al cambiar de tipo', () => {
    const id = s().addNode('screen', { x: 0, y: 0 });
    s().addInput(id, { name: 'cuenta', type: 'enum' });

    s().updateInput(id, 0, { options: [' Ahorros ', '', 'Corriente', 'Ahorros'] });
    expect(s().nodes[id]?.inputs?.[0]?.options).toEqual(['Ahorros', 'Corriente']);

    s().updateInput(id, 0, { type: 'string' });
    expect(s().nodes[id]?.inputs?.[0]).toEqual({ name: 'cuenta', type: 'string' });

    s().addInput(id, { name: 'otro', options: ['A'] });
    expect(s().nodes[id]?.inputs?.[1]).toEqual({ name: 'otro', type: 'string' });
  });

  it('ruleIds solo acepta reglas existentes, sin repetidos', () => {
    const screen = s().addNode('screen', { x: 0, y: 0 });
    const rule = s().addNode('rule', { x: 0, y: 0 });
    const api = s().addNode('api', { x: 0, y: 0 });
    s().addInput(screen);

    s().updateInput(screen, 0, { ruleIds: [rule, api, 'nada', rule] });

    expect(s().nodes[screen]?.inputs?.[0]?.ruleIds).toEqual([rule]);

    s().updateInput(screen, 0, { ruleIds: [] });
    expect(s().nodes[screen]?.inputs?.[0]).toEqual({ name: 'campo', type: 'string' });
  });

  it('removeInput quita el input y, si era el último, el campo inputs', () => {
    const id = s().addNode('screen', { x: 0, y: 0 });
    s().addInput(id, { name: 'a' });
    s().addInput(id, { name: 'b' });

    s().removeInput(id, 0);
    expect(s().nodes[id]?.inputs).toEqual([{ name: 'b', type: 'string' }]);

    s().removeInput(id, 0);
    expect(s().nodes[id]).toEqual({ id, type: 'screen', title: 'Pantalla' });
  });
});

describe('updateEdge', () => {
  it('cambia tipo, etiqueta y condición, recortados al límite', () => {
    const api = s().addNode('api', { x: 0, y: 0 });
    const screen = s().addNode('screen', { x: 0, y: 0 });
    const id = s().connect(api, screen)!;

    s().updateEdge(id, { kind: 'navigation', label: ' Ver detalle ', when: '200' });
    expect(s().edges[id]).toEqual({ id, from: api, to: screen, kind: 'navigation', label: 'Ver detalle', when: '200' });

    s().updateEdge(id, { label: 'x'.repeat(80), when: '' });
    expect(s().edges[id]?.label).toHaveLength(60);
    expect(s().edges[id]?.when).toBeUndefined();
  });

  it('no marca cambios si nada cambia', () => {
    const api = s().addNode('api', { x: 0, y: 0 });
    const db = s().addNode('database', { x: 0, y: 0 });
    const id = s().connect(api, db)!;
    s().markSaved(1);

    s().updateEdge(id, { kind: 'reads', label: '' });

    expect(s().dirty).toBe(false);
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

  it('markSaved mantiene dirty si el grafo cambió mientras se guardaba', () => {
    s().loadGraph(graph);
    s().renameNode('n1', 'Enviado');
    const sent = s();

    s().renameNode('n1', 'Cambio posterior');
    s().markSaved(4, sent);

    expect(s().version).toBe(4);
    expect(s().dirty).toBe(true);
  });

  it('markSaved limpia dirty si el grafo es el enviado', () => {
    s().loadGraph(graph);
    s().renameNode('n1', 'Enviado');

    s().markSaved(4, s());

    expect(s().dirty).toBe(false);
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
