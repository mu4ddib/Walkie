import { beforeEach, describe, expect, it } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';
import { createGraphStore, toGraph, type GraphStore } from './graphStore';

let store: StoreApi<GraphStore>;
const s = () => store.getState();

beforeEach(() => {
  store = createGraphStore();
});

/** Tour con tres pasos de nodo con nota; devuelve ids. */
function setup() {
  const a = s().addNode('screen', { x: 0, y: 0 });
  const b = s().addNode('api', { x: 0, y: 0 });
  const c = s().addNode('database', { x: 0, y: 0 });
  const tour = s().addTour('Alta')!;
  s().addStep(tour, a, 'Primero');
  s().addStep(tour, b, 'Segundo');
  s().addStep(tour, c, 'Tercero');
  return { a, b, c, tour, ids: () => s().tours[tour]!.steps.map((x) => x.id) };
}

describe('identidad de los pasos (spec tours-compactos)', () => {
  it('cada paso nace con su id; cambiar su nodo o su nota no lo cambia', () => {
    const { tour, b, ids } = setup();
    const [first] = ids();
    expect(new Set(ids()).size).toBe(3);

    s().setStepNode(tour, 0, b);
    s().updateStepNote(tour, 0, 'Otra nota');
    s().updateStepNote(tour, 0, '');
    expect(s().tours[tour]!.steps[0]).toEqual({ id: first, nodeId: b });
  });

  it('mover un paso conserva su identidad y su nota; la numeración es su posición', () => {
    const { tour, ids } = setup();
    const before = ids();

    s().moveStepTo(tour, 0, 2);

    expect(ids()).toEqual([before[1], before[2], before[0]]);
    expect(s().tours[tour]!.steps[2]!.note).toBe('Primero');
    s().markSaved(1);
    s().moveStepTo(tour, 1, 1);
    s().moveStepTo(tour, 0, 9);
    expect(s().dirty).toBe(false);
  });

  it('insertar, duplicar y quitar no mezclan notas ni referencias', () => {
    const { tour, a, c, ids } = setup();

    const inserted = s().insertStep(tour, 1, { nodeId: c }, 'Nuevo')!;
    expect(ids()[1]).toBe(inserted);
    expect(s().tours[tour]!.steps[1]).toMatchObject({ nodeId: c, note: 'Nuevo' });

    const copy = s().duplicateStep(tour, 0)!;
    expect(ids()[1]).toBe(copy);
    expect(s().tours[tour]!.steps[1]).toEqual({ id: copy, nodeId: a, note: 'Primero' });
    // Editar la copia no toca el original.
    s().updateStepNote(tour, 1, 'Copia editada');
    expect(s().tours[tour]!.steps[0]!.note).toBe('Primero');

    s().removeStep(tour, 0);
    expect(s().tours[tour]!.steps.map((x) => x.note)).toEqual(['Copia editada', 'Nuevo', 'Segundo', 'Tercero']);
    // Un tour no admite conexiones ni nodos que no existen.
    expect(s().insertStep(tour, 0, { nodeId: 'nada' })).toBeNull();
    expect(s().insertStep(tour, 99, { nodeId: c })).toBeNull();
  });

  it('duplicar un tour copia sus pasos con identidad propia', () => {
    const { tour, ids } = setup();
    const copy = s().duplicateTour(tour)!;
    const copied = s().tours[copy]!;

    expect(copied.name).toBe('Alta (copia)');
    expect(copied.kind).toBe('guide');
    expect(copied.steps.map((x) => x.note)).toEqual(['Primero', 'Segundo', 'Tercero']);
    expect(copied.steps.some((x) => ids().includes(x.id))).toBe(false);
  });

  it('los tours guardados sin ids reciben uno al abrirlos, sin marcar cambios; recargar los conserva', () => {
    s().loadGraph({
      schemaVersion: 0,
      version: 2,
      nodes: { a: { id: 'a', type: 'screen', title: 'A' } },
      edges: {},
      layout: {},
      tours: {
        t: { id: 't', name: 'Anterior', steps: [{ nodeId: 'a', note: 'Hola' }, { nodeId: 'a' }] },
        // Un id repetido (copiado a mano) también se corrige.
        r: { id: 'r', name: 'Repetido', steps: [{ id: 'x', nodeId: 'a' }, { id: 'x', nodeId: 'a' }] },
      },
    });
    expect(s().dirty).toBe(false);
    const steps = s().tours.t!.steps;
    expect(steps.every((x) => typeof x.id === 'string')).toBe(true);
    expect(steps[0]).toMatchObject({ nodeId: 'a', note: 'Hola' });
    expect(new Set(s().tours.r!.steps.map((x) => x.id)).size).toBe(2);
    expect(s().tours.r!.steps[0]!.id).toBe('x');

    const saved = toGraph(s());
    const other = createGraphStore();
    other.getState().loadGraph(saved);
    expect(other.getState().tours.t!.steps.map((x) => x.id)).toEqual(steps.map((x) => x.id));
  });
});
