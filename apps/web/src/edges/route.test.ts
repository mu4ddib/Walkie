import { describe, expect, it } from 'vitest';
import type { Port, Rect } from './ports';
import { defaultRoute, polylinePath, routeAround, segmentHits, simplify, type Point } from './route';

const right = (x: number, y: number): Port => ({ x, y, side: 'right' });
const left = (x: number, y: number): Port => ({ x, y, side: 'left' });

/** ¿Algún tramo pasa por dentro de alguna caja? */
const crosses = (points: Point[], boxes: Rect[]) =>
  points.some((p, i) => i > 0 && boxes.some((b) => segmentHits(points[i - 1]!, p, b)));
const orthogonal = (points: Point[]) => points.every((p, i) => i === 0 || p.x === points[i - 1]!.x || p.y === points[i - 1]!.y);

describe('routeAround', () => {
  it('sin cajas en medio no cambia nada: se dibuja el trazo de siempre', () => {
    expect(routeAround(right(184, 36), left(600, 36), [{ x: 300, y: 300, w: 184, h: 72 }])).toBeNull();
  });

  it('rodea una caja que queda en medio del trazo, sin atravesarla y en escalones', () => {
    const middle: Rect = { x: 300, y: 0, w: 184, h: 72 };
    const route = routeAround(right(184, 36), left(600, 36), [middle])!;

    expect(route).not.toBeNull();
    expect(route[0]).toEqual({ x: 184, y: 36 });
    expect(route.at(-1)).toEqual({ x: 600, y: 36 });
    expect(crosses(route, [middle])).toBe(false);
    expect(orthogonal(route)).toBe(true);
    // Rodea por arriba o por abajo, con su margen.
    const ys = route.map((p) => p.y);
    expect(Math.min(...ys) <= -16 || Math.max(...ys) >= 72 + 16).toBe(true);
  });

  it('rodea varias cajas y llega por el lado de su destino', () => {
    const boxes: Rect[] = [
      { x: 260, y: -40, w: 120, h: 160 },
      { x: 420, y: 60, w: 120, h: 160 },
    ];
    const route = routeAround(right(184, 36), left(700, 160), boxes)!;
    expect(crosses(route, boxes)).toBe(false);
    expect(orthogonal(route)).toBe(true);
    // El último tramo entra horizontal, desde la izquierda del destino.
    const [a, b] = route.slice(-2);
    expect(a!.y).toBe(b!.y);
    expect(a!.x).toBeLessThan(b!.x);
  });

  it('con un doblez pedido (bendX) que esquiva, respeta el trazo de siempre', () => {
    // El doblez en x = 220 pasa a la izquierda de la caja: no hay choque.
    const box: Rect = { x: 300, y: 100, w: 184, h: 72 };
    expect(routeAround(right(184, 36), left(600, 300), [box], { x: 220 })).toBeNull();
    // Sin ese doblez (a mitad de camino, x = 392) atraviesa la caja.
    expect(defaultRoute(right(184, 36), left(600, 300))).toEqual([
      { x: 184, y: 36 },
      { x: 392, y: 36 },
      { x: 392, y: 300 },
      { x: 600, y: 300 },
    ]);
    expect(routeAround(right(184, 36), left(600, 300), [box])).not.toBeNull();
  });
});

describe('polylinePath y simplify', () => {
  it('arma el trazo y ubica la etiqueta a mitad del largo; quita puntos sobrantes', () => {
    const { d, labelX, labelY } = polylinePath([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ]);
    expect(d).toBe('M0 0 L100 0 L100 100');
    expect({ labelX, labelY }).toEqual({ labelX: 100, labelY: 0 });
    expect(
      simplify([
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
    ]);
  });
});
