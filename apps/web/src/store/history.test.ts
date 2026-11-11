import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';
import { createGraphStore, toGraph, type GraphStore } from './graphStore';
import { COALESCE_MS, HISTORY_LIMIT } from './history';
import { withoutIds } from '../test/steps';

let store: StoreApi<GraphStore>;
const s = () => store.getState();
/** Cada gesto del usuario llega en su propia tarea: los de la misma tarea se unen en un paso. */
const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  store = createGraphStore();
  s().loadGraph({ schemaVersion: 0, version: 3, nodes: {}, edges: {}, layout: {} });
});

afterEach(() => vi.useRealTimers());

describe('deshacer y rehacer', () => {
  it('deshace y rehace cada acción; un cambio nuevo descarta lo que había para rehacer', async () => {
    expect(s().canUndo).toBe(false);
    const a = s().addNode('screen', { x: 0, y: 0 });
    await nextTask();
    const b = s().addNode('api', { x: 240, y: 0 });
    await nextTask();
    const e = s().connect(a, b)!;
    await nextTask();
    expect(s().canUndo).toBe(true);

    s().undo();
    expect(s().edges[e]).toBeUndefined();
    s().undo();
    expect(s().nodes[b]).toBeUndefined();
    expect(s().canRedo).toBe(true);
    s().redo();
    expect(s().nodes[b]).toBeDefined();

    s().renameNode(a, 'Login');
    expect(s().canRedo).toBe(false);
    s().redo();
    expect(s().edges[e]).toBeUndefined();
    expect(s().version).toBe(3);
  });

  it('volver a lo guardado deja el lienzo al día; un cambio sin guardar sigue pendiente', async () => {
    const a = s().addNode('screen', { x: 0, y: 0 });
    await nextTask();
    s().markSaved(4, s());
    expect(s().dirty).toBe(false);

    s().moveNode(a, { x: 80, y: 80 });
    await nextTask();
    expect(s().dirty).toBe(true);
    s().undo();
    expect(s().dirty).toBe(false);
    s().undo();
    expect(s().dirty).toBe(true);
    expect(s().nodes[a]).toBeUndefined();
    s().redo();
    expect(s().dirty).toBe(false);
  });

  it('lo que pasa en un mismo gesto (misma tarea) es un solo paso', async () => {
    const g = s().addGroup({ x: 0, y: 0, w: 400, h: 240 });
    await nextTask();
    // Crear una caja, meterla en el grupo y agrandar la caja del grupo: un solo paso.
    const n = s().addNode('api', { x: 360, y: 200 });
    s().setParent(n, g);
    s().growGroup(g, { x: 360, y: 200, w: 184, h: 72 });
    await nextTask();

    s().undo();
    expect(s().nodes[n]).toBeUndefined();
    expect(s().layout[g]).toEqual({ x: 0, y: 0, w: 400, h: 240 });
  });

  it('un lote (arrastre) es un paso aunque dure varias tareas', async () => {
    const a = s().addNode('screen', { x: 0, y: 0 });
    await nextTask();
    s().beginBatch();
    for (const x of [8, 16, 24, 32]) {
      s().moveNode(a, { x, y: 0 });
      await nextTask();
    }
    s().endBatch();
    s().moveNode(a, { x: 80, y: 0 });
    await nextTask();

    s().undo();
    expect(s().layout[a]).toEqual({ x: 32, y: 0 });
    s().undo();
    expect(s().layout[a]).toEqual({ x: 0, y: 0 });
  });

  it('escribir en el mismo campo se une; tras una pausa o en otro campo es otro paso', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const a = s().addNode('screen', { x: 0, y: 0 });
    await nextTask();
    for (const title of ['L', 'Lo', 'Log', 'Login']) {
      s().renameNode(a, title);
      vi.advanceTimersByTime(100);
      await nextTask();
    }
    vi.advanceTimersByTime(COALESCE_MS + 1);
    s().renameNode(a, 'Login 2');
    await nextTask();
    s().updateNode(a, { description: 'Entrada' });
    await nextTask();

    s().undo();
    expect(s().nodes[a]?.description).toBeUndefined();
    s().undo();
    expect(s().nodes[a]?.title).toBe('Login');
    s().undo();
    expect(s().nodes[a]?.title).toBe('Pantalla');
  });

  it('cubre grupos, notas y recorridos; cargar otro grafo olvida el historial', async () => {
    const a = s().addNode('screen', { x: 0, y: 0 });
    const b = s().addNode('api', { x: 240, y: 0 });
    const e = s().connect(a, b)!;
    await nextTask();
    const t = s().addFlowTour('Alta', [e])!;
    await nextTask();
    s().removeEdge(e);
    await nextTask();
    expect(s().tours[t]?.steps[0]).toHaveProperty('removedEdge');

    // Deshacer el borrado recupera la conexión y el paso que la usaba.
    s().undo();
    expect(s().edges[e]).toBeDefined();
    expect(withoutIds(s().tours[t]?.steps[0])).toEqual({ edgeId: e });

    s().loadGraph(toGraph(s()));
    expect(s().canUndo).toBe(false);
    expect(s().canRedo).toBe(false);
  });

  it(`recuerda como mucho ${HISTORY_LIMIT} pasos`, async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const a = s().addNode('screen', { x: 0, y: 0 });
    await nextTask();
    for (let i = 1; i <= HISTORY_LIMIT + 10; i++) {
      s().moveNode(a, { x: i * 8, y: i % 2 ? 0 : 8 });
      vi.advanceTimersByTime(COALESCE_MS + 1);
      await nextTask();
    }
    let steps = 0;
    while (s().canUndo) {
      s().undo();
      steps++;
    }
    expect(steps).toBe(HISTORY_LIMIT);
  });
});

describe('growGroup', () => {
  it('agranda el grupo y sus grupos de afuera para que quepa lo de dentro, en la grilla; nunca achica', () => {
    const outer = s().addGroup({ x: 0, y: 0, w: 600, h: 400 });
    const inner = s().addGroup({ x: 40, y: 80, w: 300, h: 200 }, { parentId: outer });

    // Una caja que sobresale por la derecha y por abajo del grupo interno, y del externo.
    s().growGroup(inner, { x: 500, y: 300, w: 184, h: 72 });
    // Derecha: 500 + 184 + 24 = 708 → 712 en la grilla; abajo: 300 + 72 + 24 = 396 → 400.
    expect(s().layout[inner]).toEqual({ x: 40, y: 80, w: 672, h: 320 });
    const grown = s().layout[inner]!;
    expect(s().layout[outer]).toEqual({ x: 0, y: 0, w: 736, h: 424 });

    // Hacia la izquierda y arriba (con lugar para el encabezado), sin mover lo de dentro.
    s().growGroup(outer, { x: -100, y: -50, w: 184, h: 72 });
    expect(s().layout[outer]).toMatchObject({ x: -128, y: -112 });
    expect(s().layout[inner]).toEqual(grown);

    // Algo que ya cabe no cambia nada.
    s().markSaved(1);
    s().growGroup(inner, { x: 80, y: 160, w: 100, h: 40 });
    expect(s().dirty).toBe(false);
  });
});
