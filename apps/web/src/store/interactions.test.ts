import { describe, expect, it } from 'vitest';
import { FLOW_TIMEOUT_MAX_MS, FLOW_TIMING, advance, firstPhase, goTo, phaseDuration, stepGroup } from '../tours/flowPlayback';
import { stepIssues } from '../tours/flows';
import { createGraphStore, toGraph } from './graphStore';

/** Interacciones en el store (spec interacciones, ADR-0011): operación, retornos de cualquier intercambio y recorridos. */
function setup() {
  let n = 0;
  const store = createGraphStore(() => `id-${++n}`);
  const s = () => store.getState();
  return { store, s };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('operación de una conexión', () => {
  it('fijarla absorbe el acceso a datos anterior (sus entidades pasan al intercambio) y vaciarla vuelve al tipo', () => {
    const { s } = setup();
    const api = s().addNode('api', { x: 0, y: 0 });
    const db = s().addNode('database', { x: 300, y: 0 });
    const id = s().connect(api, db, 'reads')!;
    s().updateEdge(id, { data: { operation: 'write', entities: ['cuentas'] } });

    s().updateEdge(id, { operation: 'db.write', kind: 'request' });
    expect(s().edges[id]).toMatchObject({ kind: 'request', operation: 'db.write', exchange: { entities: ['cuentas'] } });
    expect(s().edges[id]!.data).toBeUndefined();

    s().updateEdge(id, { operation: null });
    expect(s().edges[id]!.operation).toBeUndefined();
  });

  it('la operación personalizada guarda su nombre; el intercambio se normaliza y vacío se quita', () => {
    const { s } = setup();
    const a = s().addNode('service', { x: 0, y: 0 });
    const b = s().addNode('service', { x: 300, y: 0 });
    const id = s().connect(a, b)!;
    s().updateEdge(id, { operation: 'custom', customOperation: '  Conciliar  ', technology: 'gRPC' });
    s().updateEdge(id, { exchange: { params: [{ name: ' cuenta ' }, { name: '' }], timeoutMs: 3000, entities: [' '] } });
    expect(s().edges[id]).toMatchObject({
      operation: 'custom',
      customOperation: 'Conciliar',
      technology: 'gRPC',
      exchange: { params: [{ name: 'cuenta' }], timeoutMs: 3000 },
    });
    s().updateEdge(id, { exchange: { params: [{ name: '' }] } });
    expect(s().edges[id]!.exchange).toBeUndefined();
  });
});

describe('migración de conexiones anteriores', () => {
  it('fija la operación sin marcar cambios ni sumar un paso al historial; el próximo guardado la lleva', async () => {
    const { s } = setup();
    s().loadGraph({
      schemaVersion: 0,
      version: 4,
      nodes: { a: { id: 'a', type: 'api', title: 'A' }, b: { id: 'b', type: 'database', title: 'B' } },
      edges: { e: { id: 'e', from: 'a', to: 'b', kind: 'reads', data: { operation: 'read', entities: ['cuentas'] } } },
      layout: { a: { x: 0, y: 0 }, b: { x: 300, y: 0 } },
    });
    await tick();
    s().migrateOperations({ e: 'db.query' });
    expect(s().edges.e).toMatchObject({ kind: 'request', operation: 'db.query', exchange: { entities: ['cuentas'] } });
    expect(s().edges.e!.data).toBeUndefined();
    expect(s().dirty).toBe(false);
    expect(s().canUndo).toBe(false);
    expect(toGraph(s()).edges.e!.operation).toBe('db.query');
  });
});

describe('retornos de cualquier intercambio', () => {
  it('una consulta a la base tiene resultados (vacío, error) en sentido inverso; un retorno no lleva operación', () => {
    const { s } = setup();
    const api = s().addNode('api', { x: 0, y: 0 });
    const db = s().addNode('database', { x: 300, y: 0 });
    const query = s().connect(api, db, 'request')!;
    s().updateEdge(query, { operation: 'db.query', exchange: { command: { language: 'sql', text: 'SELECT 1' } } });

    const empty = s().addResponse(query, { result: { type: 'empty', description: 'sin filas' } })!;
    expect(s().edges[empty]).toMatchObject({ from: db, to: api, kind: 'response', replyTo: query, result: { type: 'empty' } });

    s().updateEdge(empty, { operation: 'db.query', exchange: { description: 'x' } });
    expect(s().edges[empty]!.operation).toBeUndefined();
    expect(s().edges[empty]!.exchange).toBeUndefined();

    // Un retorno no responde a otro retorno ni a una navegación.
    expect(s().addResponse(empty)).toBeNull();
    // Una operación no lleva `result` ni `stream`.
    s().updateEdge(query, { result: { type: 'success' }, stream: true });
    expect(s().edges[query]!.result).toBeUndefined();
    expect(s().edges[query]!.stream).toBeUndefined();
  });

  it('invertir una operación invierte sus retornos con ella', () => {
    const { s } = setup();
    const api = s().addNode('api', { x: 0, y: 0 });
    const db = s().addNode('database', { x: 300, y: 0 });
    const query = s().connect(db, api, 'request')!;
    const result = s().addResponse(query, { result: { type: 'success' } })!;
    expect(s().edges[result]).toMatchObject({ from: api, to: db });

    s().updateEdge(query, { reverse: true });
    expect(s().edges[query]).toMatchObject({ from: api, to: db });
    expect(s().edges[result]).toMatchObject({ from: db, to: api });
  });

  it('borrar la operación deja sus retornos y respuestas correlacionadas sin vínculo; Ctrl+Z la recupera', async () => {
    const { s } = setup();
    const svc = s().addNode('service', { x: 0, y: 0 });
    const topic = s().addResource('topic', { x: 300, y: 0 });
    const worker = s().addNode('service', { x: 600, y: 0 });
    const pub = s().connect(svc, topic, 'event')!;
    s().updateEdge(pub, { operation: 'message.publish' });
    const ack = s().addResponse(pub, { result: { type: 'ack' } })!;
    const reply = s().connect(worker, svc, 'event')!;
    s().updateEdge(reply, { operation: 'message.reply', correlatesWith: pub });
    expect(s().edges[reply]!.correlatesWith).toBe(pub);
    // No se correlaciona consigo misma.
    s().updateEdge(pub, { correlatesWith: pub });
    expect(s().edges[pub]!.correlatesWith).toBeUndefined();

    await tick();
    s().removeEdge(pub);
    expect(s().edges[ack]!.replyTo).toBeUndefined();
    expect(s().edges[reply]!.correlatesWith).toBeUndefined();
    await tick();
    s().undo();
    expect(s().edges[ack]!.replyTo).toBe(pub);
    expect(s().edges[reply]!.correlatesWith).toBe(pub);
  });

  it('el grafo guarda y recarga lo nuevo igual', () => {
    const { s } = setup();
    const api = s().addNode('api', { x: 0, y: 0 });
    const db = s().addNode('database', { x: 300, y: 0 });
    const q = s().connect(api, db, 'request')!;
    s().updateEdge(q, { operation: 'db.query', pattern: 'request-response', technology: 'PostgreSQL' });
    s().addResponse(q, { result: { type: 'error', code: 'ORA-01403' } });
    const graph = toGraph(s());
    const other = setup();
    other.s().loadGraph(graph);
    expect(toGraph(other.s())).toEqual(graph);
  });
});

describe('recorridos: pasos simultáneos y timeout', () => {
  function flow() {
    const { s } = setup();
    const svc = s().addNode('service', { x: 0, y: 0 });
    const a = s().addNode('database', { x: 300, y: 0 });
    const b = s().addResource('cache', { x: 300, y: 200 });
    const toA = s().connect(svc, a, 'request')!;
    const toB = s().connect(svc, b, 'request')!;
    const back = s().addResponse(toA)!;
    const tour = s().addFlowTour('Fan-out', [toA, toB, back])!;
    return { s, tour, toA, toB, back };
  }

  it('marca un paso como simultáneo (no el primero) y uno como timeout (solo de conexión)', () => {
    const { s, tour } = flow();
    s().setStepFlags(tour, 0, { parallel: true });
    s().setStepFlags(tour, 1, { parallel: true, timeout: true });
    expect(s().tours[tour]!.steps.map((x) => [!!x.parallel, !!x.timeout])).toEqual([
      [false, false],
      [true, true],
      [false, false],
    ]);
    s().setStepFlags(tour, 1, { timeout: false });
    expect(s().tours[tour]!.steps[1]!.timeout).toBeUndefined();
  });

  it('la reproducción toma el grupo simultáneo como un paso y un fan-out no es un salto', () => {
    const { s, tour } = flow();
    s().setStepFlags(tour, 1, { parallel: true });
    const t = s().tours[tour]!;
    expect(stepGroup(t, 0)).toEqual([0, 1]);
    const end = advance(t, { tourId: tour, step: 0, phase: 'target', mode: 'play' });
    expect(end).toMatchObject({ step: 2, phase: firstPhase(t, 2) });
    expect(goTo(t, { tourId: tour, step: 0, phase: 'target', mode: 'paused' }, 1).step).toBe(0);
    // Ni el paso simultáneo ni el que sigue desde el destino de cualquiera del grupo son saltos.
    expect(stepIssues(t, s().edges)).toEqual([[], [], []]);
  });

  it('la espera de un paso con timeout dura su timeoutMs (acotado) y no lo de llegar', () => {
    const { s, tour } = flow();
    s().setStepFlags(tour, 2, { timeout: true });
    const t = s().tours[tour]!;
    const at = (wait?: number) => phaseDuration(t, { tourId: tour, step: 2, phase: 'target', mode: 'play' }, 1, wait);
    expect(at()).toBe(FLOW_TIMING.target);
    expect(at(3000)).toBe(3000);
    expect(at(60000)).toBe(FLOW_TIMEOUT_MAX_MS);
    expect(phaseDuration(t, { tourId: tour, step: 1, phase: 'target', mode: 'play' }, 1, 3000)).toBe(FLOW_TIMING.target);
  });
});
