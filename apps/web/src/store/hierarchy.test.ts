import { beforeEach, describe, expect, it } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';
import type { WalkieCanvasGraphV0 } from '../schema/walkie-graph';
import { createGraphStore, toGraph, type GraphStore } from './graphStore';
import { ancestorsOf, canNest, commonOwner, inferHierarchy, isHidden, visibleEnd } from './hierarchy';

let store: StoreApi<GraphStore>;
const s = () => store.getState();

beforeEach(() => {
  store = createGraphStore();
});

/**
 * Tres niveles: AWS ⊃ microservicio usuarios ⊃ datos, con una API en cada nivel, una nota en el intermedio y una
 * pantalla fuera.
 */
function threeLevels() {
  const aws = s().addGroup({ x: 0, y: 0, w: 1200, h: 800 }, { title: 'AWS', kind: 'cloud' });
  const users = s().addGroup({ x: 40, y: 80, w: 800, h: 600 }, { title: 'microservicio usuarios', parentId: aws });
  const data = s().addGroup({ x: 80, y: 400, w: 400, h: 240 }, { title: 'datos', kind: 'data', parentId: users });
  const gateway = s().addNode('api', { x: 960, y: 80 });
  const apiUsers = s().addNode('api', { x: 80, y: 160 });
  const db = s().addNode('database', { x: 120, y: 480 });
  const screen = s().addNode('screen', { x: -400, y: 0 });
  const note = s().addStickyNote({ x: 400, y: 160 }, 'Escala con la demanda');
  s().setParent(gateway, aws);
  s().setParent(apiUsers, users);
  s().setParent(db, data);
  s().setParent(note, users);
  return { aws, users, data, gateway, apiUsers, db, screen, note };
}

describe('jerarquía de grupos', () => {
  it('ancestros, ancestro común y pertenencia de nodos, notas y grupos', () => {
    const { aws, users, data, db, note, gateway, screen } = threeLevels();

    expect(ancestorsOf(s(), db)).toEqual([data, users, aws]);
    expect(ancestorsOf(s(), note)).toEqual([users, aws]);
    expect(ancestorsOf(s(), data)).toEqual([users, aws]);
    expect(ancestorsOf(s(), screen)).toEqual([]);
    expect(commonOwner(s(), [db, note])).toBe(users);
    expect(commonOwner(s(), [db, gateway])).toBe(aws);
    expect(commonOwner(s(), [db, screen])).toBeNull();
  });

  it('plegar oculta todo lo de dentro; el extremo visible es el grupo plegado más externo', () => {
    const { aws, users, data, db, apiUsers, note, screen } = threeLevels();
    s().updateGroup(data, { collapsed: true });

    // Solo «datos» plegado: la base se ve como «datos».
    let collapsed = new Set([data]);
    expect(isHidden(s(), db, collapsed)).toBe(true);
    expect(visibleEnd(s(), db, collapsed)).toBe(data);
    expect(isHidden(s(), apiUsers, collapsed)).toBe(false);

    // AWS plegado también: todo lo de dentro (grupos, nodos y la nota) queda oculto y se ve como AWS.
    s().updateGroup(aws, { collapsed: true });
    collapsed = new Set([aws, data]);
    for (const id of [users, data, db, apiUsers, note]) expect(isHidden(s(), id, collapsed)).toBe(true);
    expect(visibleEnd(s(), db, collapsed)).toBe(aws);
    expect(visibleEnd(s(), screen, collapsed)).toBe(screen);

    // Al desplegar AWS, «datos» sigue plegado: su estado no se tocó.
    s().updateGroup(aws, { collapsed: false });
    expect(s().groups[data]?.collapsed).toBe(true);
    expect(s().groups[users]?.collapsed).toBeUndefined();
  });

  it('moveGroup desplaza todos los descendientes, también ocultos, y conserva las distancias', () => {
    const { aws, users, data, db, apiUsers, note, gateway, screen } = threeLevels();
    s().updateGroup(aws, { collapsed: true });
    s().updateGroup(data, { collapsed: true });
    const before = structuredClone(s().layout);

    s().moveGroup(aws, { x: 200, y: 96 });

    for (const id of [aws, users, data, db, apiUsers, note, gateway]) {
      expect(s().layout[id]).toMatchObject({ x: before[id]!.x + 200, y: before[id]!.y + 96 });
    }
    expect(s().layout[screen]).toEqual(before[screen]);
    // Tamaños de las cajas intactos.
    expect(s().layout[users]).toMatchObject({ w: 800, h: 600 });

    // Mover un grupo interno solo mueve lo suyo.
    s().moveGroup(data, { x: s().layout[data]!.x + 40, y: s().layout[data]!.y });
    expect(s().layout[db]!.x).toBe(before[db]!.x + 240);
    expect(s().layout[apiUsers]!.x).toBe(before[apiUsers]!.x + 200);
  });

  it('setParent mete y saca grupos; rechaza ciclos', () => {
    const { aws, users, data } = threeLevels();

    expect(canNest(s(), aws, data)).toBe(false);
    expect(s().setParent(aws, data)).toBe(false);
    expect(s().setParent(users, users)).toBe(false);
    expect(s().setParent(users, data)).toBe(false);
    expect(s().groups[aws]).not.toHaveProperty('parentId');

    s().markSaved(1);
    expect(s().setParent(data, aws)).toBe(true);
    expect(s().groups[data]?.parentId).toBe(aws);
    expect(s().dirty).toBe(true);
    expect(s().setParent(data, aws)).toBe(false);
    expect(s().setParent(data, null)).toBe(true);
    expect(s().groups[data]).not.toHaveProperty('parentId');
  });

  it('removeGroup sube lo que contenía un nivel (grupos, nodos y notas)', () => {
    const { aws, users, data, apiUsers, note } = threeLevels();

    s().removeGroup(users);

    expect(s().groups[data]?.parentId).toBe(aws);
    expect(s().nodes[apiUsers]?.groupId).toBe(aws);
    expect(s().stickyNotes[note]?.groupId).toBe(aws);
  });

  it('addGroup envuelve grupos, nodos y notas y queda dentro del padre indicado (sin ciclos)', () => {
    const { aws, data, apiUsers, note, users } = threeLevels();

    const wrap = s().addGroup({ x: 0, y: 0, w: 400, h: 400 }, { members: [data, apiUsers, note], parentId: users });

    expect(s().groups[wrap]?.parentId).toBe(users);
    expect(s().groups[data]?.parentId).toBe(wrap);
    expect(s().nodes[apiUsers]?.groupId).toBe(wrap);
    expect(s().stickyNotes[note]?.groupId).toBe(wrap);
    expect(ancestorsOf(s(), data)).toEqual([wrap, users, aws]);

    // Un padre que está dentro de un miembro crearía un ciclo: se ignora.
    const bad = s().addGroup({ x: 0, y: 0, w: 400, h: 400 }, { members: [aws], parentId: data });
    expect(s().groups[bad]).not.toHaveProperty('parentId');
  });

  it('la jerarquía, las posiciones y los plegados sobreviven a guardar y recargar', () => {
    threeLevels();
    const [aws, , data] = Object.keys(s().groups);
    s().updateGroup(aws!, { collapsed: true });
    s().updateGroup(data!, { collapsed: true });
    const saved = JSON.parse(JSON.stringify(toGraph(s()))) as WalkieCanvasGraphV0;

    const other = createGraphStore();
    other.getState().loadGraph(saved);

    expect(toGraph(other.getState())).toEqual(saved);
    expect(other.getState().dirty).toBe(false);
  });

  it('duplicar una nota la deja en el mismo grupo', () => {
    const { note, users } = threeLevels();
    const copy = s().duplicateStickyNote(note)!;
    expect(s().stickyNotes[copy]?.groupId).toBe(users);
  });
});

describe('inferHierarchy (lienzos anteriores)', () => {
  const base = (): WalkieCanvasGraphV0 => ({
    schemaVersion: 0,
    version: 1,
    nodes: {
      api: { id: 'api', type: 'api', title: 'API usuarios', groupId: 'users' },
      gw: { id: 'gw', type: 'api', title: 'Gateway', groupId: 'aws' },
    },
    edges: {},
    layout: {
      aws: { x: 0, y: 0, w: 1000, h: 800 },
      users: { x: 40, y: 80, w: 600, h: 400 },
      other: { x: 900, y: 600, w: 400, h: 400 },
      api: { x: 80, y: 160 },
      gw: { x: 700, y: 80 },
      n1: { x: 100, y: 300 },
      n2: { x: 2000, y: 2000 },
    },
    groups: {
      aws: { id: 'aws', title: 'AWS', kind: 'cloud', collapsed: true },
      users: { id: 'users', title: 'microservicio usuarios', kind: 'backend' },
      other: { id: 'other', title: 'Externos', kind: 'external' },
    },
    stickyNotes: { n1: { id: 'n1', text: 'Nota' }, n2: { id: 'n2', text: 'Suelta' } },
  });

  it('un grupo contenido por completo pasa a estar dentro del más chico que lo contiene; solaparse no basta', () => {
    const graph = inferHierarchy(base());

    expect(graph.groupNesting).toBe('explicit');
    expect(graph.groups?.users?.parentId).toBe('aws');
    // «Externos» solo se solapa con AWS: queda suelto.
    expect(graph.groups?.other).not.toHaveProperty('parentId');
    // Los nodos conservan su grupo conocido; las notas se asignan por contención.
    expect(graph.nodes.api?.groupId).toBe('users');
    expect(graph.nodes.gw?.groupId).toBe('aws');
    expect(graph.stickyNotes?.n1?.groupId).toBe('users');
    expect(graph.stickyNotes?.n2).not.toHaveProperty('groupId');
  });

  it('dos contenedores del mismo tamaño son ambiguos: no se adivina', () => {
    const graph = base();
    graph.layout.twin = { x: 0, y: 0, w: 1000, h: 800 };
    graph.groups!.twin = { id: 'twin', title: 'Gemelo', kind: 'custom' };
    const inferred = inferHierarchy(graph);
    expect(inferred.groups?.users).not.toHaveProperty('parentId');
    // Y entre los gemelos, ninguno es estrictamente más grande.
    expect(inferred.groups?.twin).not.toHaveProperty('parentId');
    expect(inferred.groups?.aws).not.toHaveProperty('parentId');
  });

  it('no toca un grafo con jerarquía explícita, aunque las cajas se contengan', () => {
    const graph = { ...base(), groupNesting: 'explicit' as const };
    expect(inferHierarchy(graph)).toBe(graph);
  });

  it('loadGraph infiere sin marcar cambios: al plegar AWS (del lienzo anterior) se oculta el grupo interno', () => {
    s().loadGraph(base());
    expect(s().dirty).toBe(false);
    expect(s().groups.users?.parentId).toBe('aws');
    expect(isHidden(s(), 'users', new Set(['aws']))).toBe(true);
    expect(visibleEnd(s(), 'api', new Set(['aws']))).toBe('aws');
  });
});
