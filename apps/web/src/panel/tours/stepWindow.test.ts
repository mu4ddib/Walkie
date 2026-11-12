import { describe, expect, it } from 'vitest';
import { offsetsOf, windowRange } from './stepWindow';

const offsets = offsetsOf(Array.from({ length: 300 }, () => 50));

describe('ventana de la lista de pasos (spec tours-a-escala)', () => {
  it('suma las alturas', () => {
    expect(offsetsOf([10, 20, 30])).toEqual([0, 10, 30, 60]);
  });

  it('dibuja lo visible más el margen', () => {
    expect(windowRange(offsets, 0, 500, 2)).toEqual([0, 12]);
    expect(windowRange(offsets, 1000, 500, 2)).toEqual([18, 32]);
    expect(windowRange(offsets, 1025, 100, 0)).toEqual([20, 23]);
  });

  it('se ajusta a los bordes y a una franja fuera de la lista', () => {
    expect(windowRange(offsets, -400, 300, 2)).toEqual([0, 3]);
    expect(windowRange(offsets, 99999, 500, 2)).toEqual([297, 300]);
    expect(windowRange([0], 0, 500)).toEqual([0, 0]);
  });

  it('con alturas distintas (un paso abierto) usa las medidas', () => {
    const mixed = offsetsOf([50, 400, 50, 50, 50]);
    expect(windowRange(mixed, 460, 60, 0)).toEqual([2, 4]);
    expect(windowRange(mixed, 100, 60, 0)).toEqual([1, 2]);
  });

  it('mantiene dentro el paso que se arrastra', () => {
    expect(windowRange(offsets, 5000, 500, 2, 3)).toEqual([3, 112]);
  });
});
