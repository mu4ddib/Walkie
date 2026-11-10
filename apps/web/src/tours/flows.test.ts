import { beforeEach, describe, expect, it } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';
import { createGraphStore, toGraph, type GraphStore } from '../store/graphStore';
import { continuations, isFlowTour, lastEnd, stepIssues, suggestOrder, tourNodes } from './flows';

let store: StoreApi<GraphStore>;
const s = () => store.getState();

beforeEach(() => {
  store = createGraphStore();
});

/**
 * Pantalla → API → Servicio → Base de datos → Servicio → API → Pantalla, con solicitudes y sus respuestas, y una
 * decisión en el servicio (correo libre / ya registrado).
 */
function signUp() {
  const screen = s().addNode('screen', { x: 0, y: 0 });
  const api = s().addNode('api', { x: 240, y: 0 });
  const service = s().addNode('service', { x: 480, y: 0 });
  const db = s().addNode('database', { x: 720, y: 0 });
  const req = s().connect(screen, api, 'request')!;
  const callService = s().connect(api, service, 'request')!;
  const read = s().connect(service, db, 'reads')!;
  const rows = s().connect(db, service, 'response')!;
  const serviceReply = s().addResponse(callService, { status: 200 })!;
  const created = s().addResponse(req, { status: 201 })!;
  return { screen, api, service, db, req, callService, read, rows, serviceReply, created };
}

describe('suggestOrder', () => {
  it('ordena Pantalla → API → Servicio → BD → Servicio → API → Pantalla aunque se seleccione desordenado', () => {
    const e = signUp();
    const order = [e.created, e.rows, e.req, e.serviceReply, e.read, e.callService];
    expect(suggestOrder(order, s().edges)).toEqual([e.req, e.callService, e.read, e.rows, e.serviceReply, e.created]);
  });

  it('una cadena abierta tiene un único orden', () => {
    const e = signUp();
    expect(suggestOrder([e.read, e.callService, e.req], s().edges)).toEqual([e.req, e.callService, e.read]);
  });

  it('con bifurcaciones o pasos desconectados no sugiere: decide el usuario', () => {
    const e = signUp();
    const other = s().addNode('screen', { x: 0, y: 200 });
    const toOther = s().connect(e.screen, other, 'navigation')!;
    // Dos salidas desde la pantalla y nada que las una.
    expect(suggestOrder([toOther, e.req], s().edges)).toBeNull();
    // Desconectadas.
    expect(suggestOrder([e.req, e.rows], s().edges)).toBeNull();
    // Una sola conexión: trivial.
    expect(suggestOrder([e.read], s().edges)).toEqual([e.read]);
  });

  it('acepta repetir una conexión (reintento) si la secuencia cierra', () => {
    const a = s().addNode('service', { x: 0, y: 0 });
    const b = s().addNode('api', { x: 200, y: 0 });
    const go = s().connect(a, b, 'request')!;
    const back = s().connect(b, a, 'event')!;
    expect(suggestOrder([go, back, go], s().edges)).toEqual([go, back, go]);
  });
});

describe('recorridos en el store', () => {
  it('addFlowTour guarda un paso por conexión; una conexión sirve en varios recorridos', () => {
    const e = signUp();
    const t1 = s().addFlowTour('Alta ok', [e.req, e.created])!;
    const t2 = s().addFlowTour('Solo ida', [e.req])!;

    expect(s().tours[t1]?.steps).toEqual([{ edgeId: e.req }, { edgeId: e.created }]);
    expect(s().tours[t2]?.steps).toEqual([{ edgeId: e.req }]);
    expect(isFlowTour(s().tours[t1])).toBe(true);
    expect(tourNodes(s().tours[t1], s().edges)).toEqual(new Set([e.screen, e.api]));
    expect(lastEnd(s().tours[t1], s().edges)).toBe(e.screen);
  });

  it('addEdgeStep, nota, setStepEdge y reorderSteps', () => {
    const e = signUp();
    const t = s().addFlowTour('Alta', [e.req])!;

    expect(s().addEdgeStep(t, e.callService, 'La API delega')).toBe(1);
    expect(s().addEdgeStep(t, 'nada')).toBeNull();
    s().updateStepNote(t, 0, 'Envía el formulario');
    expect(s().tours[t]?.steps).toEqual([
      { edgeId: e.req, note: 'Envía el formulario' },
      { edgeId: e.callService, note: 'La API delega' },
    ]);

    s().setStepEdge(t, 1, e.read);
    expect(s().tours[t]?.steps[1]).toEqual({ edgeId: e.read, note: 'La API delega' });

    s().reorderSteps(t, [1, 0]);
    expect(s().tours[t]?.steps.map((x) => x.edgeId)).toEqual([e.read, e.req]);
    s().markSaved(1);
    s().reorderSteps(t, [0, 0]);
    s().reorderSteps(t, [0]);
    expect(s().dirty).toBe(false);
  });

  it('borrar una conexión usada deja el paso marcado para reemplazarlo o quitarlo', () => {
    const e = signUp();
    const t = s().addFlowTour('Alta', [e.req, e.callService])!;
    s().updateStepNote(t, 1, 'Delega');

    s().removeEdge(e.callService);

    const step = s().tours[t]!.steps[1]!;
    expect(step).toEqual({ removedEdge: { from: e.api, to: e.service, kind: 'request' }, note: 'Delega' });
    expect(stepIssues(s().tours[t]!, s().edges)[1]).toContainEqual({ kind: 'removed' });

    // Reemplazar por otra conexión conserva la nota.
    const again = s().connect(e.api, e.service, 'request')!;
    s().setStepEdge(t, 1, again);
    expect(s().tours[t]!.steps[1]).toEqual({ edgeId: again, note: 'Delega' });

    // Borrar un nodo también marca los pasos de sus conexiones.
    s().removeNode(e.service);
    expect(s().tours[t]!.steps[1]).toHaveProperty('removedEdge');
    // El grafo sigue siendo guardable (sin referencias colgando).
    expect(JSON.stringify(toGraph(s()))).not.toContain(`"edgeId":"${again}"`);
  });
});

describe('stepIssues y continuaciones', () => {
  it('señala saltos y respuestas antes de su solicitud; se revalida al invertir una conexión', () => {
    const e = signUp();
    const t = s().addFlowTour('Desordenado', [e.created, e.req, e.read])!;

    let issues = stepIssues(s().tours[t]!, s().edges);
    expect(issues[0]).toContainEqual({ kind: 'response-first', requestId: e.req });
    // created: API → Pantalla; req: Pantalla → API: continúa. read sale del servicio: salto desde la API.
    expect(issues[1]).toEqual([]);
    expect(issues[2]).toContainEqual({ kind: 'jump', end: e.api, start: e.service });

    // Invertir «read» (BD → Servicio) no lo arregla; quitar el salto sí.
    s().updateEdge(e.read, { reverse: true });
    issues = stepIssues(s().tours[t]!, s().edges);
    expect(issues[2]).toContainEqual({ kind: 'jump', end: e.api, start: e.db });
  });

  it('continuaciones: lo que sale del último nodo; con una decisión, cada rama es una opción', () => {
    const e = signUp();
    s().setRuleMode(s().addNode('rule', { x: 0, y: 0 }), 'decision');
    const decision = Object.values(s().nodes).find((n) => n.mode === 'decision')!;
    const [yes, no] = decision.branches!;
    const ok = s().connect(decision.id, e.api, 'uses', { branch: yes!.id })!;
    const ko = s().connect(decision.id, e.screen, 'uses', { branch: no!.id })!;

    expect(continuations(s().edges, decision.id).map((x) => x.id).sort()).toEqual([ok, ko].sort());
    // Dos recorridos con ramas distintas guardan cada uno la suya.
    const success = s().addFlowTour('Éxito', [ok, e.callService])!;
    const failure = s().addFlowTour('Error', [ko])!;
    expect(s().edges[s().tours[success]!.steps[0]!.edgeId!]?.branch).toBe(yes!.id);
    expect(s().edges[s().tours[failure]!.steps[0]!.edgeId!]?.branch).toBe(no!.id);
  });
});

describe('tipo de tour (tours-y-recorridos)', () => {
  it('un tour solo admite pasos de nodo y un recorrido solo de conexión; nacen con su tipo', () => {
    const e = signUp();
    const guide = s().addTour('Conoce la pantalla')!;
    const flow = s().addTour('Alta', 'flow')!;

    expect(s().tours[guide]?.kind).toBe('guide');
    expect(s().tours[flow]?.kind).toBe('flow');
    // Un recorrido vacío sigue siendo un recorrido.
    expect(isFlowTour(s().tours[flow])).toBe(true);
    expect(s().addEdgeStep(guide, e.req)).toBeNull();
    expect(s().addStep(flow, e.screen)).toBeNull();
    expect(s().addStep(guide, e.screen)).toBe(0);
    expect(s().addEdgeStep(flow, e.req)).toBe(0);
    const fromSelection = s().addFlowTour('Desde la selección', [e.req])!;
    expect(s().tours[fromSelection]?.kind).toBe('flow');
  });

  it('los tours de lienzos anteriores reciben el tipo de sus pasos al abrir, sin marcar cambios', () => {
    s().loadGraph({
      schemaVersion: 0,
      version: 2,
      nodes: { a: { id: 'a', type: 'screen', title: 'A' }, b: { id: 'b', type: 'api', title: 'B' } },
      edges: { e: { id: 'e', from: 'a', to: 'b', kind: 'request' } },
      layout: {},
      tours: {
        t1: { id: 't1', name: 'Clásico', steps: [{ nodeId: 'a' }] },
        t2: { id: 't2', name: 'Mixto', steps: [{ nodeId: 'a' }, { edgeId: 'e' }] },
        t3: { id: 't3', name: 'Vacío', steps: [] },
      },
    });
    expect(s().dirty).toBe(false);
    expect(Object.values(s().tours).map((t) => t.kind)).toEqual(['guide', 'flow', 'guide']);
    expect(toGraph(s()).tours?.t2?.kind).toBe('flow');
  });
});
