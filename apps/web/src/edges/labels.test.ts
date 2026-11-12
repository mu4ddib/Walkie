import { describe, expect, it } from 'vitest';
import { JOIN_GAP, labelSize, placePairLabels, pointAt, touches } from './labels';
import type { Rect } from './ports';

const size = { w: 60, h: 22 };
const box = (p: { x: number; y: number }, s = size): Rect => ({ x: p.x - s.w / 2, y: p.y - s.h / 2, w: s.w, h: s.h });

describe('etiquetas de un par (spec conexiones-ida-y-vuelta)', () => {
  it('el tamaño crece con el texto y con el número de paso', () => {
    expect(labelSize('llama').w).toBeLessThan(labelSize('llama · POST /cuentas').w);
    expect(labelSize('llama', { step: true }).w).toBeGreaterThan(labelSize('llama').w);
    expect(labelSize('responde 201', { code: true }).w).toBeGreaterThan(labelSize('responde 201').w);
  });

  it('un punto a lo largo de la polilínea', () => {
    const line = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    expect(pointAt(line, 0.5)).toEqual({ x: 100, y: 0 });
    expect(pointAt(line, 0.25)).toEqual({ x: 50, y: 0 });
    expect(pointAt(line, 1)).toEqual({ x: 100, y: 100 });
  });

  it('dos trazos paralelos verticales: las etiquetas se corren a lo largo hasta no tocarse', () => {
    const req = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 600 },
      { x: 400, y: 600 },
    ];
    const res = [
      { x: 400, y: 616 },
      { x: 184, y: 616 },
      { x: 184, y: 16 },
      { x: 0, y: 16 },
    ];
    const placed = placePairLabels(
      [
        { id: 'req', points: req, size },
        { id: 'res', points: res, size },
      ],
      [],
    );
    expect(placed.req!.joined).toBeUndefined();
    expect(touches(box(placed.req!), box(placed.res!))).toBe(false);
    // Cada una sobre su trazo.
    expect(placed.req!.x).toBe(200);
    expect(placed.res!.x).toBe(184);
  });

  it('no tapa cajas ni etiquetas ya puestas', () => {
    const line = [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
    ];
    const wall: Rect = { x: 470, y: -40, w: 60, h: 80 };
    const other: Rect = { x: 370, y: -11, w: 60, h: 22 };
    const placed = placePairLabels([{ id: 'a', points: line, size }], [wall], [other]);
    expect(touches(box(placed.a!), wall, 0)).toBe(false);
    expect(touches(box(placed.a!), other)).toBe(false);
  });

  it('sin lugar en el trazo: etiqueta compuesta en fila, centrada y con el hueco para «⇄»', () => {
    const short = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
    ];
    const back = [
      { x: 40, y: 10 },
      { x: 0, y: 10 },
    ];
    const placed = placePairLabels(
      [
        { id: 'req', points: short, size },
        { id: 'res', points: back, size: { w: 90, h: 22 } },
      ],
      [],
    );
    expect(placed.req!.joined).toBe('start');
    expect(placed.res!.joined).toBe('end');
    expect(placed.res!.y).toBe(placed.req!.y);
    // Entre el borde derecho de una y el izquierdo de la otra, el hueco.
    expect(placed.res!.x - 45 - (placed.req!.x + 30)).toBe(JOIN_GAP);
    // Centradas a mitad del primer trazo.
    expect((placed.req!.x - 30 + placed.res!.x + 45) / 2).toBe(20);
    expect(placed.req!.y).toBe(0);
  });

  it('la compuesta se corre arriba o abajo si a mitad del trazo tapa una caja', () => {
    const short = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
    ];
    const left: Rect = { x: -200, y: -10, w: 200, h: 20 };
    const right: Rect = { x: 40, y: -10, w: 200, h: 20 };
    const placed = placePairLabels(
      [
        { id: 'a', points: short, size },
        { id: 'b', points: [...short].reverse(), size },
      ],
      [left, right],
    );
    expect(placed.a!.joined).toBe('start');
    expect(placed.a!.y).toBe(-30);
    expect(touches(box(placed.a!), left, 0) || touches(box(placed.b!), right, 0)).toBe(false);
  });
});
