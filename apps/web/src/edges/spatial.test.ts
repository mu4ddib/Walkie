import { describe, expect, it } from 'vitest';
import { RectGrid, around } from './spatial';

describe('índice espacial de cajas', () => {
  it('devuelve lo mismo que filtrar la lista entera, cada caja una vez', () => {
    const items = Array.from({ length: 200 }, (_, i) => ({
      id: `n${i}`,
      rect: { x: (i % 20) * 250 - 300, y: Math.floor(i / 20) * 180 - 200, w: 200 + (i % 3) * 300, h: 96 },
    }));
    const grid = new RectGrid(items);
    for (const area of [around({ x: 0, y: 0 }, { x: 900, y: 400 }, 400), { x: -5000, y: -5000, w: 100, h: 100 }, { x: 1000, y: 300, w: 1, h: 1 }]) {
      const expected = items.filter(
        (o) => o.rect.x < area.x + area.w && o.rect.x + o.rect.w > area.x && o.rect.y < area.y + area.h && o.rect.y + o.rect.h > area.y,
      );
      const found = grid.query(area);
      expect(new Set(found.map((f) => f.id))).toEqual(new Set(expected.map((e) => e.id)));
      expect(found.length).toBe(expected.length);
    }
  });
});
