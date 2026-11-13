import { describe, expect, it } from 'vitest';
import { freeSpot, pushBelow, SPACE_GAP } from './layoutSpace';

describe('espacio en el lienzo', () => {
  it('un grupo vacío va al hueco libre más cercano de la vista, sin tapar nada', () => {
    const view = { x: 0, y: 0, w: 1600, h: 1000 };
    const obstacles = [
      { x: 500, y: 350, w: 380, h: 580 },
      { x: 950, y: 350, w: 340, h: 400 },
    ];
    const spot = freeSpot({ x: 560, y: 380, w: 480, h: 320 }, obstacles, view);
    const placed = { ...spot, w: 480, h: 320 };
    for (const o of obstacles) {
      const touches = placed.x < o.x + o.w && o.x < placed.x + placed.w && placed.y < o.y + o.h && o.y < placed.y + placed.h;
      expect(touches).toBe(false);
    }
    // Sin lugar en la vista, debajo de todo.
    expect(freeSpot({ x: 0, y: 0, w: 480, h: 320 }, [{ x: 0, y: 0, w: 1600, h: 1000 }], view).y).toBe(1000 + SPACE_GAP * 2);
  });

  it('una caja que crece empuja a las de abajo en cascada, no a las de al lado ni a las que ya se tocaban', () => {
    const moved = pushBelow(
      'pago',
      { x: 0, y: 0, w: 260, h: 120 },
      { x: 0, y: 0, w: 260, h: 200 },
      {
        pago: { x: 0, y: 0, w: 260, h: 120 },
        comprobante: { x: 0, y: 150, w: 260, h: 120 },
        tercero: { x: 0, y: 300, w: 260, h: 120 },
        lado: { x: 400, y: 150, w: 260, h: 120 },
        pegado: { x: 0, y: 100, w: 260, h: 40 },
      },
    );
    expect(moved.comprobante).toEqual({ x: 0, y: 200 + SPACE_GAP });
    expect(moved.tercero).toEqual({ x: 0, y: 200 + SPACE_GAP + 120 + SPACE_GAP });
    expect(moved.lado).toBeUndefined();
    expect(moved.pegado).toBeUndefined();
  });
});
