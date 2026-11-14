import { describe, expect, it } from 'vitest';
import { KeyedValue, StableElements, sameValue } from './stableElements';

describe('identidad estable de nodos y conexiones', () => {
  it('conserva los objetos que no cambiaron y renueva solo los que sí', () => {
    const cache = new StableElements<{ id: string; data: { title: string; at: { x: number } } }>();
    const first = cache.reuse([
      { id: 'a', data: { title: 'A', at: { x: 1 } } },
      { id: 'b', data: { title: 'B', at: { x: 2 } } },
    ]);
    const second = cache.reuse([
      { id: 'a', data: { title: 'A', at: { x: 1 } } },
      { id: 'b', data: { title: 'B2', at: { x: 2 } } },
    ]);
    expect(second[0]).toBe(first[0]);
    expect(second[1]).not.toBe(first[1]);
    expect(cache.changed).toEqual(['b']);
  });

  it('sin ningún cambio devuelve la misma lista (React Flow no procesa nada); con otro orden, una lista nueva', () => {
    const cache = new StableElements<{ id: string; v: number }>();
    const first = cache.reuse([
      { id: 'a', v: 1 },
      { id: 'b', v: 2 },
    ]);
    expect(
      cache.reuse([
        { id: 'a', v: 1 },
        { id: 'b', v: 2 },
      ]),
    ).toBe(first);
    const swapped = cache.reuse([
      { id: 'b', v: 2 },
      { id: 'a', v: 1 },
    ]);
    expect(swapped).not.toBe(first);
    expect(swapped[0]).toBe(first[1]);
  });

  it('compara por contenido; las funciones no deciden (se derivan de los demás datos)', () => {
    expect(sameValue({ a: [1, { b: 2 }], f: () => 1 }, { a: [1, { b: 2 }], f: () => 2 })).toBe(true);
    expect(sameValue({ a: [1, 2] }, { a: [1, 3] })).toBe(false);
    expect(sameValue({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(sameValue(new Set([1]), new Set([1]))).toBe(false);
  });

  it('un valor con clave se recalcula solo si cambia la clave', () => {
    const value = new KeyedValue<object>();
    const a = value.get('k1', () => ({}));
    expect(value.get('k1', () => ({}))).toBe(a);
    expect(value.get('k2', () => ({}))).not.toBe(a);
  });
});
