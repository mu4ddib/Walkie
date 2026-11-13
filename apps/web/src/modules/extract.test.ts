import { describe, expect, it } from 'vitest';
import type { WalkieCanvasGraphV0 } from '../schema/walkie-graph';
import { interfaceKey, membersOf, planExtraction } from './extract';

/**
 * Feature de ejemplo: un grupo «Backend» con un subgrupo «Datos»; dentro, la API de usuarios y el servicio; fuera, la
 * pantalla que llama, la base de datos que el servicio lee y una decisión que no se toca. Datos ficticios.
 */
function sample(): WalkieCanvasGraphV0 {
  return {
    schemaVersion: 0,
    version: 4,
    nodes: {
      screen: { id: 'screen', type: 'screen', title: 'Registro', inputs: [{ name: 'correo', type: 'string', ruleIds: ['rule'] }] },
      api: { id: 'api', type: 'api', title: 'POST usuarios', http: { method: 'POST', path: '/usuarios' }, groupId: 'backend' },
      svc: { id: 'svc', type: 'service', title: 'Usuarios', notes: 'Crea la cuenta', groupId: 'datos' },
      rule: { id: 'rule', type: 'rule', title: 'Correo válido', groupId: 'backend' },
      db: { id: 'db', type: 'database', title: 'Clientes' },
    },
    edges: {
      req: { id: 'req', from: 'screen', to: 'api', kind: 'request' },
      res: { id: 'res', from: 'api', to: 'screen', kind: 'response', status: 201, replyTo: 'req' },
      call: { id: 'call', from: 'api', to: 'svc', kind: 'request' },
      reply: { id: 'reply', from: 'svc', to: 'api', kind: 'response', replyTo: 'call' },
      read: { id: 'read', from: 'svc', to: 'db', kind: 'reads' },
    },
    layout: {
      screen: { x: 0, y: 0 },
      backend: { x: 300, y: -40, w: 600, h: 400 },
      datos: { x: 560, y: 80, w: 300, h: 200 },
      api: { x: 320, y: 40 },
      svc: { x: 600, y: 120 },
      rule: { x: 320, y: 240 },
      db: { x: 1000, y: 120 },
      note: { x: 600, y: 240 },
    },
    groups: {
      backend: { id: 'backend', title: 'Backend', kind: 'backend' },
      datos: { id: 'datos', title: 'Datos', kind: 'data', parentId: 'backend' },
    },
    stickyNotes: { note: { id: 'note', text: 'Ojo con los duplicados', groupId: 'datos' } },
    groupNesting: 'explicit',
    tours: {
      flow: {
        id: 'flow',
        name: 'Alta',
        kind: 'flow',
        steps: [
          { id: 's1', edgeId: 'req' },
          { id: 's2', edgeId: 'call' },
          { id: 's3', edgeId: 'read' },
          { id: 's4', edgeId: 'reply' },
          { id: 's5', edgeId: 'res' },
        ],
      },
      guide: { id: 'guide', name: 'Guía', kind: 'guide', steps: [{ id: 'g1', nodeId: 'screen' }, { id: 'g2', nodeId: 'api' }, { id: 'g3', nodeId: 'svc' }] },
    },
  };
}

function counter() {
  let n = 0;
  return () => `id-${++n}`;
}

const base = { moduleId: 'mod', moduleName: 'Usuarios', moduleNodeId: 'box' };

describe('convertir en módulo', () => {
  it('un grupo incluye sus subgrupos, sus cajas y sus notas', () => {
    const members = membersOf(sample(), ['backend']);
    expect([...members.groups].sort()).toEqual(['backend', 'datos']);
    expect([...members.nodes].sort()).toEqual(['api', 'rule', 'svc']);
    expect([...members.notes]).toEqual(['note']);
  });

  it('propone una interfaz por lo que entra y una dependencia por la base de fuera', () => {
    const plan = planExtraction(sample(), { ...base, roots: ['backend'], newId: counter() });

    expect(plan.external.sort()).toEqual(['db', 'screen']);
    expect(plan.interfaces.map((i) => [i.name, i.kind, i.nodeId])).toEqual([
      ['POST usuarios', 'provides', 'api'],
      ['Clientes', 'requires', 'svc'],
    ]);
    // La respuesta pasa por la interfaz de su solicitud.
    const provides = plan.interfaces.find((i) => i.kind === 'provides')!;
    expect(provides.edges.sort()).toEqual(['req', 'res']);
  });

  it('el módulo conserva posiciones relativas, contratos, notas y solicitud/respuesta', () => {
    const plan = planExtraction(sample(), { ...base, roots: ['backend'], newId: counter() });
    const m = plan.module;

    expect(Object.keys(m.nodes).sort()).toEqual(['api', 'rule', 'svc']);
    expect(m.nodes.api!.http).toEqual({ method: 'POST', path: '/usuarios' });
    expect(m.nodes.svc!.notes).toBe('Crea la cuenta');
    expect(m.edges.reply!.replyTo).toBe('call');
    expect(m.groups!.backend!.parentId).toBeUndefined();
    expect(m.groups!.datos!.parentId).toBe('backend');
    expect(m.stickyNotes!.note!.groupId).toBe('datos');
    // El grupo de más afuera queda en el origen; lo demás, a la misma distancia que antes.
    expect(m.layout.backend).toMatchObject({ x: 80, y: 80, w: 600 });
    expect(m.layout.api!.x - m.layout.backend!.x).toBe(20);
    expect(m.layout.api!.y - m.layout.backend!.y).toBe(80);
  });

  it('en la feature, la caja del módulo reemplaza la selección y las conexiones externas llegan a sus interfaces', () => {
    const plan = planExtraction(sample(), { ...base, roots: ['backend'], newId: counter() });
    const f = plan.feature;
    const provides = plan.interfaces.find((i) => i.kind === 'provides')!;
    const requires = plan.interfaces.find((i) => i.kind === 'requires')!;

    expect(Object.keys(f.nodes).sort()).toEqual(['box', 'db', 'screen']);
    expect(f.nodes.box).toMatchObject({ type: 'module', moduleId: 'mod', title: 'Usuarios' });
    expect(f.groups).toBeUndefined();
    expect(f.stickyNotes).toBeUndefined();
    expect(f.layout.box).toMatchObject({ x: 300, y: -40 });
    // Mismo id: los pasos de recorrido que las usan siguen valiendo.
    expect(f.edges.req).toMatchObject({ from: 'screen', to: 'box', toInterface: { id: provides.id, name: 'POST usuarios' } });
    expect(f.edges.res).toMatchObject({ from: 'box', to: 'screen', replyTo: 'req', fromInterface: { id: provides.id } });
    expect(f.edges.read).toMatchObject({ from: 'box', to: 'db', fromInterface: { id: requires.id, name: 'Clientes' } });
    expect(f.edges.call).toBeUndefined();
    expect(f.version).toBe(4);
  });

  it('remapea los tours: pasos de nodo a la caja, internos a un recorrido del módulo enlazado desde la interfaz', () => {
    const plan = planExtraction(sample(), { ...base, roots: ['backend'], newId: counter() });

    expect(plan.feature.tours!.flow!.steps.map((s) => s.edgeId)).toEqual(['req', 'read', 'res']);
    const inner = Object.values(plan.module.tours!).find((t) => t.kind === 'flow')!;
    expect(inner).toMatchObject({ name: 'Alta' });
    expect(inner.steps.map((s) => s.edgeId)).toEqual(['call', 'reply']);
    const provides = plan.interfaces.find((i) => i.kind === 'provides')!;
    expect(plan.module.interfaces![provides.id]!.tourId).toBe(inner.id);
    // Dos pasos seguidos sobre lo convertido quedan en uno, sobre la caja.
    expect(plan.feature.tours!.guide!.steps.map((s) => s.nodeId)).toEqual(['screen', 'box']);
    expect(plan.tourNotes.join(' ')).toMatch(/«Alta»: 2 pasos pasan al recorrido interno/);
    // La regla pasa al módulo: el input de la pantalla pierde su vínculo y se avisa.
    expect(plan.feature.nodes.screen!.inputs![0]!.ruleIds).toBeUndefined();
    expect(plan.warnings.join(' ')).toMatch(/Registro/);
  });

  it('incluir la base de fuera la mete en el módulo y quita la dependencia', () => {
    const plan = planExtraction(sample(), { ...base, roots: ['backend'], include: ['db'], newId: counter() });

    expect(plan.module.nodes.db).toBeDefined();
    expect(plan.module.edges.read).toBeDefined();
    expect(plan.interfaces.map((i) => i.kind)).toEqual(['provides']);
    expect(plan.feature.nodes.db).toBeUndefined();
    expect(plan.external).toEqual(['screen']);
  });

  it('con los mismos ids y nombres propios da el mismo plan (un reintento no genera ids nuevos)', () => {
    const first = planExtraction(sample(), { ...base, roots: ['backend'], newId: counter() });
    const key = interfaceKey('api', 'provides');
    const again = planExtraction(sample(), {
      ...base,
      roots: ['backend'],
      ids: first.ids,
      names: { [key]: 'Crear usuario' },
      newId: () => {
        throw new Error('no debería generar ids');
      },
    });

    expect(again.interfaces.map((i) => i.id)).toEqual(first.interfaces.map((i) => i.id));
    expect(again.feature.edges.req!.toInterface!.name).toBe('Crear usuario');
  });

  it('una rama que sale de lo convertido queda como condición', () => {
    const graph = sample();
    graph.nodes.rule = { ...graph.nodes.rule!, mode: 'decision', branches: [{ id: 'b1', label: 'Sí' }] };
    graph.edges.yes = { id: 'yes', from: 'rule', to: 'db', kind: 'uses', branch: 'b1' };
    const plan = planExtraction(graph, { ...base, roots: ['backend'], newId: counter() });

    expect(plan.feature.edges.yes).toMatchObject({ from: 'box', when: 'Sí' });
    expect(plan.feature.edges.yes!.branch).toBeUndefined();
  });
});
