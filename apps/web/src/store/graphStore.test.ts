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

describe('convertToRef', () => {
  it('convierte una API en ref conservando id, posición y conexiones', () => {
    const screen = s().addNode('screen', { x: 0, y: 0 });
    const api = s().addNode('api', { x: 240, y: 0 });
    s().updateNode(api, { title: 'Consultar cliente', description: 'Por documento' });
    const edge = s().connect(screen, api)!;
    s().markSaved(1);

    s().convertToRef(api, 'item-1');

    expect(s().nodes[api]).toEqual({ id: api, type: 'ref', title: 'Consultar cliente', catalogId: 'item-1' });
    expect(s().layout[api]).toEqual({ x: 240, y: 0 });
    expect(s().edges[edge]).toMatchObject({ from: screen, to: api });
    expect(s().dirty).toBe(true);
  });

  it('ignora nodos que no van al catálogo', () => {
    const screen = s().addNode('screen', { x: 0, y: 0 });

    s().convertToRef(screen, 'item-1');

    expect(s().nodes[screen]?.type).toBe('screen');
  });
});

describe('convertToLocal', () => {
  it('convierte un ref en un nodo propio con los datos del elemento, sin perder conexiones', () => {
    const screen = s().addNode('screen', { x: 0, y: 0 });
    const ref = s().addRef({ id: 'item-1', title: 'Viejo' }, { x: 240, y: 0 });
    const edge = s().connect(screen, ref)!;
    s().markSaved(1);

    s().convertToLocal(ref, {
      type: 'api',
      title: ' Consultar cliente ',
      description: 'Por documento',
      http: { method: 'GET', path: '/clientes/{id}' },
    });

    expect(s().nodes[ref]).toEqual({
      id: ref,
      type: 'api',
      title: 'Consultar cliente',
      description: 'Por documento',
      http: { method: 'GET', path: '/clientes/{id}' },
    });
    expect(s().layout[ref]).toEqual({ x: 240, y: 0 });
    expect(s().edges[edge]).toMatchObject({ from: screen, to: ref });
    expect(s().dirty).toBe(true);
  });

  it('no deja http en un servicio ni convierte lo que no es ref', () => {
    const ref = s().addRef({ id: 'item-1', title: 'Pagos' }, { x: 0, y: 0 });
    const screen = s().addNode('screen', { x: 0, y: 0 });

    s().convertToLocal(ref, { type: 'service', title: 'Pagos', http: { path: '/x' } });
    s().convertToLocal(screen, { type: 'api', title: 'Otra' });

    expect(s().nodes[ref]).toEqual({ id: ref, type: 'service', title: 'Pagos' });
    expect(s().nodes[screen]?.type).toBe('screen');
  });
});

describe('detalle técnico', () => {
  it('setHttp guarda el contrato normalizado solo en una API y lo quita si queda vacío', () => {
    const api = s().addNode('api', { x: 0, y: 0 });
    const screen = s().addNode('screen', { x: 0, y: 0 });
    s().markSaved(1);

    s().setHttp(api, { method: 'GET', params: [{ name: ' id ', in: 'path' }], responses: [{ status: 200 }] });
    s().setHttp(screen, { method: 'GET' });

    expect(s().nodes[api]?.http).toEqual({ method: 'GET', params: [{ name: 'id', in: 'path' }], responses: [{ status: 200 }] });
    expect(s().nodes[screen]?.http).toBeUndefined();
    expect(s().dirty).toBe(true);
    s().setHttp(api, { params: [] });
    expect(s().nodes[api]).not.toHaveProperty('http');
  });

  it('updateNode con método y ruta conserva el resto del contrato', () => {
    const api = s().addNode('api', { x: 0, y: 0 });
    s().setHttp(api, { auth: { type: 'bearer' }, responses: [{ status: 200 }] });

    s().updateNode(api, { http: { method: 'POST', path: '/x' } });

    expect(s().nodes[api]?.http).toEqual({ auth: { type: 'bearer' }, responses: [{ status: 200 }], method: 'POST', path: '/x' });
  });

  it('setDatabase solo en bases de datos; notas en cualquier nodo propio', () => {
    const db = s().addNode('database', { x: 0, y: 0 });
    const actor = s().addNode('actor', { x: 0, y: 0 });

    s().setDatabase(db, { engine: 'Oracle', tables: [{ name: 'cuentas' }] });
    s().setDatabase(actor, { engine: 'Oracle' });
    s().updateNode(actor, { notes: '  Inicia la transferencia ' });

    expect(s().nodes[db]?.database).toEqual({ engine: 'Oracle', tables: [{ name: 'cuentas' }] });
    expect(s().nodes[actor]).toEqual({ id: actor, type: 'actor', title: 'Actor', notes: 'Inicia la transferencia' });
  });

  it('updateEdge guarda notas, ejemplo y acceso a datos; vacíos los quita', () => {
    const api = s().addNode('api', { x: 0, y: 0 });
    const db = s().addNode('database', { x: 0, y: 0 });
    const edge = s().connect(api, db)!;

    s().updateEdge(edge, { notes: 'En una transacción', example: '{ "id": 1 }', data: { operation: 'write', entities: ['cuentas', ' '] } });
    expect(s().edges[edge]).toMatchObject({
      notes: 'En una transacción',
      example: '{ "id": 1 }',
      data: { operation: 'write', entities: ['cuentas'] },
    });

    s().updateEdge(edge, { notes: '', example: '', data: null });
    expect(s().edges[edge]).toEqual({ id: edge, from: api, to: db, kind: s().edges[edge]!.kind });
  });

  it('convertToLocal copia el contrato o la estructura del elemento', () => {
    const ref = s().addRef({ id: 'item-1', title: 'Core' }, { x: 0, y: 0 });

    s().convertToLocal(ref, { type: 'database', title: 'Core', database: { engine: 'PostgreSQL' } });

    expect(s().nodes[ref]).toEqual({ id: ref, type: 'database', title: 'Core', database: { engine: 'PostgreSQL' } });
  });
});

describe('grupos de infraestructura', () => {
  it('addGroup crea el grupo con su caja en la grilla y mete a sus miembros', () => {
    const api = s().addNode('api', { x: 40, y: 40 });
    s().markSaved(1);

    const g = s().addGroup({ x: 3, y: 5, w: 100, h: 90 }, { title: ' Backend ', kind: 'backend', members: [api, 'nada'] });

    expect(s().groups[g]).toEqual({ id: g, title: 'Backend', kind: 'backend' });
    expect(s().layout[g]).toEqual({ x: 0, y: 8, w: 240, h: 160 });
    expect(s().nodes[api]?.groupId).toBe(g);
    expect(toGraph(s()).groups).toEqual({ [g]: s().groups[g] });
    expect(s().dirty).toBe(true);
  });

  it('moveGroup mueve también sus nodos; resizeGroup no', () => {
    const inside = s().addNode('api', { x: 40, y: 40 });
    const outside = s().addNode('screen', { x: 600, y: 40 });
    const g = s().addGroup({ x: 0, y: 0, w: 400, h: 240 }, { members: [inside] });

    s().moveGroup(g, { x: 80, y: 16 });
    expect(s().layout[g]).toMatchObject({ x: 80, y: 16 });
    expect(s().layout[inside]).toEqual({ x: 120, y: 56 });
    expect(s().layout[outside]).toEqual({ x: 600, y: 40 });

    s().resizeGroup(g, { x: 80, y: 16, w: 600, h: 320 });
    expect(s().layout[g]).toEqual({ x: 80, y: 16, w: 600, h: 320 });
    expect(s().layout[inside]).toEqual({ x: 120, y: 56 });
  });

  it('setNodeGroup mete y saca; updateGroup pliega; removeGroup deja los nodos', () => {
    const api = s().addNode('api', { x: 40, y: 40 });
    const g = s().addGroup({ x: 0, y: 0, w: 400, h: 240 });

    s().setNodeGroup(api, g);
    s().updateGroup(g, { collapsed: true, title: '  ' });
    expect(s().nodes[api]?.groupId).toBe(g);
    expect(s().groups[g]).toEqual({ id: g, title: 'Grupo', kind: 'custom', collapsed: true });

    s().setNodeGroup(api, null);
    expect(s().nodes[api]).not.toHaveProperty('groupId');
    s().setNodeGroup(api, g);

    s().removeGroup(g);
    expect(s().groups).toEqual({});
    expect(s().layout[g]).toBeUndefined();
    expect(s().nodes[api]).toEqual({ id: api, type: 'api', title: 'API' });
  });

  it('loadGraph y toGraph conservan los grupos; sin grupos no hay campo', () => {
    const graph: WalkieCanvasGraphV0 = {
      schemaVersion: 0,
      version: 3,
      nodes: { a: { id: 'a', type: 'api', title: 'A', groupId: 'g' } },
      edges: {},
      layout: { a: { x: 0, y: 0 }, g: { x: 0, y: 0, w: 400, h: 240 } },
      groups: { g: { id: 'g', title: 'Backend', kind: 'backend', collapsed: true } },
    };
    s().loadGraph(graph);
    // Al guardar, el grafo declara la jerarquía explícita; recargarlo da lo mismo.
    const saved = toGraph(s());
    expect(saved).toEqual({ ...graph, groupNesting: 'explicit' });
    s().loadGraph(saved);
    expect(toGraph(s())).toEqual(saved);

    s().loadGraph({ ...graph, nodes: {}, layout: {}, groups: undefined });
    expect(toGraph(s())).not.toHaveProperty('groups');
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
    ['screen', 'portal', 'navigation'],
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

describe('updateNode con imagen', () => {
  it('pone y quita la imagen de una pantalla', () => {
    const id = s().addNode('screen', { x: 0, y: 0 });
    s().markSaved(1);

    s().updateNode(id, { assetId: 'asset-1' });
    expect(s().nodes[id]?.assetId).toBe('asset-1');
    expect(s().dirty).toBe(true);

    s().updateNode(id, { assetId: null });
    expect(s().nodes[id]).toEqual({ id, type: 'screen', title: 'Pantalla' });
  });

  it('ignora la imagen en nodos que no son pantallas', () => {
    const id = s().addNode('api', { x: 0, y: 0 });
    s().markSaved(1);

    s().updateNode(id, { assetId: 'asset-1' });

    expect(s().nodes[id]?.assetId).toBeUndefined();
    expect(s().dirty).toBe(false);
  });
});

describe('updateNode con destino', () => {
  it('pone y quita el destino de un portal, e ignora otros tipos', () => {
    const portal = s().addNode('portal', { x: 0, y: 0 });
    const screen = s().addNode('screen', { x: 0, y: 0 });

    s().updateNode(portal, { targetFeatureId: 'feat-2', title: 'Transferir' });
    expect(s().nodes[portal]).toEqual({ id: portal, type: 'portal', title: 'Transferir', targetFeatureId: 'feat-2' });

    s().updateNode(portal, { targetFeatureId: null });
    expect(s().nodes[portal]?.targetFeatureId).toBeUndefined();

    s().updateNode(screen, { targetFeatureId: 'feat-2' });
    expect(s().nodes[screen]?.targetFeatureId).toBeUndefined();
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

describe('tours', () => {
  function setup() {
    const login = s().addNode('screen', { x: 0, y: 0 });
    const rule = s().addNode('rule', { x: 0, y: 0 });
    const api = s().addNode('api', { x: 0, y: 0 });
    const tour = s().addTour('  Iniciar sesión  ')!;
    return { login, rule, api, tour };
  }

  it('addTour crea un tour vacío con el nombre recortado; vacío no crea nada', () => {
    const { tour } = setup();

    expect(s().tours[tour]).toEqual({ id: tour, name: 'Iniciar sesión', steps: [] });
    expect(s().addTour('   ')).toBeNull();
    expect(s().addTour('x'.repeat(80))).not.toBeNull();
    expect(Object.values(s().tours).map((t) => t.name.length)).toContain(60);
  });

  it('addStep agrega al final, con nota opcional, solo a nodos que existen', () => {
    const { login, rule, tour } = setup();

    expect(s().addStep(tour, login, ' Aquí empieza ')).toBe(0);
    expect(s().addStep(tour, rule)).toBe(1);
    expect(s().addStep(tour, 'nada')).toBeNull();
    expect(s().addStep('nada', login)).toBeNull();

    expect(s().tours[tour]?.steps).toEqual([{ nodeId: login, note: 'Aquí empieza' }, { nodeId: rule }]);
  });

  it('edita la nota (vacía la quita y respeta el límite) y cambia el nodo de un paso', () => {
    const { login, api, tour } = setup();
    s().addStep(tour, login, 'Hola');

    s().updateStepNote(tour, 0, 'x'.repeat(600));
    expect(s().tours[tour]?.steps[0]?.note).toHaveLength(500);
    s().updateStepNote(tour, 0, '  ');
    expect(s().tours[tour]?.steps[0]).toEqual({ nodeId: login });

    s().setStepNode(tour, 0, api);
    expect(s().tours[tour]?.steps[0]).toEqual({ nodeId: api });
  });

  it('moveStep sube y baja pasos; fuera de rango no hace nada', () => {
    const { login, rule, api, tour } = setup();
    s().addStep(tour, login);
    s().addStep(tour, rule);
    s().addStep(tour, api);

    s().moveStep(tour, 2, -1);
    expect(s().tours[tour]?.steps.map((x) => x.nodeId)).toEqual([login, api, rule]);
    s().moveStep(tour, 0, -1);
    s().moveStep(tour, 2, 1);
    expect(s().tours[tour]?.steps.map((x) => x.nodeId)).toEqual([login, api, rule]);
  });

  it('renombra, quita pasos y borra el tour', () => {
    const { login, tour } = setup();
    s().addStep(tour, login);

    s().renameTour(tour, 'Login');
    s().removeStep(tour, 0);
    expect(s().tours[tour]).toEqual({ id: tour, name: 'Login', steps: [] });

    s().removeTour(tour);
    expect(s().tours).toEqual({});
  });

  it('las acciones marcan cambios y las que no cambian nada no', () => {
    const { login, tour } = setup();
    s().addStep(tour, login, 'Hola');
    s().markSaved(1);

    s().renameTour(tour, 'Iniciar sesión');
    s().updateStepNote(tour, 0, 'Hola');
    s().moveStep(tour, 0, 1);
    expect(s().dirty).toBe(false);

    s().updateStepNote(tour, 0, 'Chao');
    expect(s().dirty).toBe(true);
  });

  it('borrar un nodo quita sus pasos de todos los tours (criterio 4)', () => {
    const { login, rule, tour } = setup();
    const other = s().addTour('Otro')!;
    s().addStep(tour, login);
    s().addStep(tour, rule);
    s().addStep(other, rule);

    s().removeNode(rule);

    expect(s().tours[tour]?.steps).toEqual([{ nodeId: login }]);
    expect(s().tours[other]?.steps).toEqual([]);
  });

  it('toGraph lleva los tours solo si hay; loadGraph los recupera', () => {
    expect(toGraph(s())).not.toHaveProperty('tours');
    const { login, tour } = setup();
    s().addStep(tour, login, 'Hola');

    const graph = toGraph(s());
    const other = createGraphStore();
    other.getState().loadGraph(graph);

    expect(other.getState().tours).toEqual(s().tours);
    expect(toGraph(other.getState())).toEqual(graph);
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

describe('decisión (modo de una regla)', () => {
  it('convierte una regla conservando id, título, posición y conexiones, con "Sí" y "No" de partida', () => {
    const rule = s().addNode('rule', { x: 40, y: 80 });
    s().renameNode(rule, '¿Tiene cuenta?');
    const login = s().addNode('screen', { x: 0, y: 0 });
    const edge = s().connect(rule, login)!;

    s().setRuleMode(rule, 'decision');

    const node = s().nodes[rule]!;
    expect(node).toMatchObject({ id: rule, type: 'rule', mode: 'decision', title: '¿Tiene cuenta?' });
    expect(node.branches?.map((b) => b.label)).toEqual(['Sí', 'No']);
    expect(s().layout[rule]).toEqual({ x: 40, y: 80 });
    // La conexión sigue ahí, sin salida: se asigna a mano.
    expect(s().edges[edge]).toEqual({ id: edge, from: rule, to: login, kind: 'uses' });
    s().updateEdge(edge, { branch: node.branches![0]!.id });
    expect(s().edges[edge]?.branch).toBe(node.branches![0]!.id);
  });

  it('una conexión que nace de una salida es esa rama; una salida ajena se ignora', () => {
    const rule = s().addNode('rule', { x: 0, y: 0 });
    const a = s().addNode('screen', { x: 0, y: 0 });
    s().setRuleMode(rule, 'decision');
    const [yes] = s().nodes[rule]!.branches!;

    const edge = s().connect(rule, a, undefined, { branch: yes!.id })!;
    const other = s().connect(a, rule, undefined, { branch: yes!.id })!;

    expect(s().edges[edge]?.branch).toBe(yes!.id);
    expect(s().edges[other]?.branch).toBeUndefined();
    s().updateEdge(edge, { branch: 'no-existe' });
    expect(s().edges[edge]?.branch).toBe(yes!.id);
  });

  it('renombra, agrega y quita salidas; quitar una deja sus conexiones sin asignar', () => {
    const rule = s().addNode('rule', { x: 0, y: 0 });
    const a = s().addNode('screen', { x: 0, y: 0 });
    s().setRuleMode(rule, 'decision');
    const [yes, no] = s().nodes[rule]!.branches!;
    const edge = s().connect(rule, a, undefined, { branch: no!.id })!;

    s().renameBranch(rule, yes!.id, '  Ya es cliente ');
    s().renameBranch(rule, yes!.id, '   ');
    const extra = s().addBranch(rule)!;
    s().removeBranch(rule, no!.id);

    expect(s().nodes[rule]!.branches).toEqual([
      { id: yes!.id, label: 'Ya es cliente' },
      { id: extra, label: 'Sí' },
    ]);
    expect(s().edges[edge]).toEqual({ id: edge, from: rule, to: a, kind: 'uses' });
    expect(s().addBranch(a)).toBeNull();
  });

  it('volver a regla quita las salidas y deja su etiqueta en la conexión', () => {
    const rule = s().addNode('rule', { x: 0, y: 0 });
    const a = s().addNode('screen', { x: 0, y: 0 });
    s().setRuleMode(rule, 'decision');
    const edge = s().connect(rule, a, undefined, { branch: s().nodes[rule]!.branches![0]!.id })!;

    s().setRuleMode(rule, 'rule');

    expect(s().nodes[rule]).toEqual({ id: rule, type: 'rule', title: 'Regla' });
    expect(s().edges[edge]).toEqual({ id: edge, from: rule, to: a, kind: 'uses', label: 'Sí' });
  });

  it('solo una regla puede ser una decisión', () => {
    const screen = s().addNode('screen', { x: 0, y: 0 });
    s().markSaved(1);

    s().setRuleMode(screen, 'decision');

    expect(s().nodes[screen]?.mode).toBeUndefined();
    expect(s().dirty).toBe(false);
  });
});

describe('solicitud y respuesta', () => {
  function exchange() {
    const screen = s().addNode('screen', { x: 0, y: 0 });
    const api = s().addNode('api', { x: 0, y: 0 });
    const request = s().connect(screen, api)!;
    return { screen, api, request };
  }

  it('addResponse crea el retorno en sentido inverso, vinculado a la solicitud; admite varias', () => {
    const { screen, api, request } = exchange();

    const ok = s().addResponse(request, { status: 201 })!;
    const error = s().addResponse(request, { status: 409, label: 'Correo ya registrado' })!;

    expect(s().edges[ok]).toEqual({ id: ok, from: api, to: screen, kind: 'response', replyTo: request, status: 201 });
    expect(s().edges[error]).toMatchObject({ from: api, to: screen, replyTo: request, status: 409, label: 'Correo ya registrado' });
    expect(s().addResponse(ok)).toBeNull();
  });

  it('el código va en su campo (100 a 599), aparte de la condición', () => {
    const { request } = exchange();
    const response = s().addResponse(request)!;

    s().updateEdge(response, { status: 200, when: 'si hay saldo', outcome: ' Se muestra el comprobante ' });
    s().updateEdge(response, { status: 99 });

    expect(s().edges[response]).toMatchObject({ status: 200, when: 'si hay saldo', outcome: 'Se muestra el comprobante' });
    s().updateEdge(response, { status: null, outcome: '' });
    expect(s().edges[response]).toEqual(expect.not.objectContaining({ status: expect.anything(), outcome: expect.anything() }));
  });

  it('replyTo solo acepta otra conexión request; borrar la solicitud desvincula sus respuestas', () => {
    const { request } = exchange();
    const response = s().addResponse(request)!;

    s().updateEdge(response, { replyTo: response });
    expect(s().edges[response]?.replyTo).toBe(request);
    s().removeEdge(request);

    expect(s().edges[response]).toBeDefined();
    expect(s().edges[response]?.replyTo).toBeUndefined();
  });

  it('reverse intercambia origen y destino y conserva etiqueta y detalle', () => {
    const { screen, api, request } = exchange();
    s().updateEdge(request, { label: 'Alta', notes: 'Con reintento' });

    s().updateEdge(request, { kind: 'response', reverse: true });

    expect(s().edges[request]).toEqual({ id: request, from: api, to: screen, kind: 'response', label: 'Alta', notes: 'Con reintento' });
  });

  it('una solicitud guarda el endpoint y los parámetros de ese paso, normalizados', () => {
    const { request } = exchange();

    s().updateEdge(request, {
      request: { method: 'POST', path: ' /usuarios ', params: [{ name: ' X-Canal ', in: 'header', value: ' app ' }, { name: ' ', in: 'query' }] },
    });

    expect(s().edges[request]?.request).toEqual({ method: 'POST', path: '/usuarios', params: [{ name: 'X-Canal', in: 'header', value: 'app' }] });
    s().updateEdge(request, { request: null });
    expect(s().edges[request]?.request).toBeUndefined();
  });
});

describe('duplicateNode', () => {
  it('copia propiedades, imagen y grupo con id propio, corrida y sin conexiones', () => {
    const screen = s().addNode('screen', { x: 80, y: 80 });
    const api = s().addNode('api', { x: 400, y: 80 });
    s().updateNode(screen, { title: 'Inicio', description: 'Pantalla inicial', assetId: '018f0000-0000-7000-8000-000000000001' });
    s().addInput(screen, { name: 'correo' });
    const group = s().addGroup({ x: 0, y: 0, w: 400, h: 400 }, { members: [screen] });
    s().connect(screen, api);

    const copy = s().duplicateNode(screen)!;

    expect(copy).not.toBe(screen);
    expect(s().nodes[copy]).toEqual({ ...s().nodes[screen], id: copy });
    expect(s().nodes[copy]?.groupId).toBe(group);
    expect(s().nodes[copy]?.inputs).not.toBe(s().nodes[screen]?.inputs);
    expect(s().layout[copy]).toEqual({ x: 104, y: 104 });
    expect(Object.values(s().edges).filter((e) => e.from === copy || e.to === copy)).toEqual([]);
    expect(Object.keys(s().edges)).toHaveLength(1);
  });

  it('la copia de un ref apunta al mismo elemento del catálogo', () => {
    const ref = s().addRef({ id: 'item-1', title: 'Clientes' }, { x: 0, y: 0 });

    const copy = s().duplicateNode(ref)!;

    expect(s().nodes[copy]).toEqual({ id: copy, type: 'ref', title: 'Clientes', catalogId: 'item-1' });
    expect(s().duplicateNode('no-existe')).toBeNull();
  });
});

describe('notas adhesivas', () => {
  it('se crean, editan, mueven, duplican y borran; van en el grafo solo si hay alguna', () => {
    expect(toGraph(s()).stickyNotes).toBeUndefined();
    const note = s().addStickyNote({ x: 13, y: 21 });
    s().updateStickyNote(note, '  Pendiente: validar  ');
    s().moveStickyNote(note, { x: 101, y: 50 });

    expect(toGraph(s()).stickyNotes).toEqual({ [note]: { id: note, text: 'Pendiente: validar' } });
    expect(s().layout[note]).toEqual({ x: 104, y: 48 });

    const copy = s().duplicateStickyNote(note)!;
    expect(s().stickyNotes[copy]?.text).toBe('Pendiente: validar');
    expect(s().layout[copy]).toEqual({ x: 128, y: 72 });

    s().removeStickyNote(note);
    s().removeStickyNote(copy);
    expect(s().stickyNotes).toEqual({});
    expect(s().layout).toEqual({});
  });

  it('se cargan con el grafo y un cambio en ellas durante un guardado sigue pendiente', () => {
    s().loadGraph({ schemaVersion: 0, version: 2, nodes: {}, edges: {}, layout: { n: { x: 0, y: 0 } }, stickyNotes: { n: { id: 'n', text: 'Hola' } } });
    expect(s().stickyNotes['n']?.text).toBe('Hola');

    s().updateStickyNote('n', 'Hola de nuevo');
    const sent = s();
    s().updateStickyNote('n', 'Otro cambio');
    s().markSaved(3, sent);

    expect(s().version).toBe(3);
    expect(s().dirty).toBe(true);
  });
});
