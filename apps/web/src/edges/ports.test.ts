import { describe, expect, it } from 'vitest';
import { computePorts, sideToward, staggerBends, type Rect } from './ports';

const box = (x: number, y: number, w = 184, h = 72): Rect => ({ x, y, w, h });

describe('sideToward', () => {
  it('elige el lado que mira al otro extremo según el hueco entre las cajas', () => {
    const a = box(0, 0);
    expect(sideToward(a, box(400, 0))).toBe('right');
    expect(sideToward(a, box(-400, 10))).toBe('left');
    expect(sideToward(a, box(20, 300))).toBe('bottom');
    expect(sideToward(a, box(-20, -300))).toBe('top');
    // Con hueco horizontal, por los lados aunque esté más lejos en vertical (el lienzo se lee de izquierda a derecha).
    expect(sideToward(a, box(400, 120))).toBe('right');
    expect(sideToward(a, box(260, 600))).toBe('right');
    // Sin ese hueco (apiladas o casi), arriba o abajo.
    expect(sideToward(a, box(210, 600))).toBe('bottom');
    // Debajo y apenas corrida: abajo.
    expect(sideToward(a, box(150, 200))).toBe('bottom');
  });
});

describe('computePorts', () => {
  it('reparte las conexiones que comparten lado, ordenadas por dónde está el otro extremo', () => {
    // «Home» a la izquierda; tres destinos a la derecha, de arriba abajo, en desorden en la lista.
    const rects = { home: box(0, 100, 184, 120), a: box(500, 0), b: box(500, 140), c: box(500, 280) };
    const ports = computePorts(
      [
        { id: 'toC', source: 'home', target: 'c' },
        { id: 'toA', source: 'home', target: 'a' },
        { id: 'toB', source: 'home', target: 'b' },
      ],
      rects,
    );

    const ys = ['toA', 'toB', 'toC'].map((id) => ports[id]!.source.y);
    expect(ports.toA!.source).toMatchObject({ x: 184, side: 'right' });
    // Puntos distintos, de arriba abajo como sus destinos, dentro del lado y lejos de las esquinas.
    expect(ys).toEqual([...ys].sort((p, q) => p - q));
    expect(new Set(ys).size).toBe(3);
    expect(Math.min(...ys)).toBeGreaterThan(100);
    expect(Math.max(...ys)).toBeLessThan(220);
    // Cada destino recibe por su lado izquierdo, en el centro (una sola conexión).
    expect(ports.toB!.target).toEqual({ x: 500, y: 140 + 36, side: 'left' });
  });

  it('dos conexiones entre el mismo par van paralelas, con su propio punto en cada extremo', () => {
    const ports = computePorts(
      [
        { id: 'request', source: 'screen', target: 'api' },
        { id: 'response', source: 'api', target: 'screen' },
      ],
      { screen: box(0, 0), api: box(400, 0) },
    );
    expect(ports.request!.source.side).toBe('right');
    expect(ports.response!.source.side).toBe('left');
    expect(ports.request!.source.y).not.toBe(ports.response!.target.y);
    expect(ports.request!.source.y).toBe(ports.request!.target.y);
    expect(ports.response!.source.y).toBe(ports.response!.target.y);
  });

  it('una rama de decisión sale de su salida; solo se reparte la llegada', () => {
    const fixed = { x: 184, y: 50, side: 'right' as const };
    const ports = computePorts(
      [
        { id: 'yes', source: 'decision', target: 'ok', fixedSource: fixed },
        { id: 'other', source: 'screen', target: 'ok' },
      ],
      { decision: box(0, 0), ok: box(400, 0), screen: box(0, 200) },
    );
    expect(ports.yes!.source).toBe(fixed);
    expect(ports.yes!.target.side).toBe('left');
    expect(ports.other!.target.side).toBe('left');
    expect(ports.yes!.target.y).toBeLessThan(ports.other!.target.y);
  });

  it('una conexión sin caja de algún extremo no recibe puertos', () => {
    expect(computePorts([{ id: 'e', source: 'a', target: 'b' }], { a: box(0, 0) })).toEqual({});
  });
});

describe('staggerBends', () => {
  it('las que comparten lado doblan cada una en su línea, sin cruzarse; una sola o derecha, a mitad de camino', () => {
    const right = (y: number) => ({ x: 184, y, side: 'right' as const });
    const left = (x: number, y: number) => ({ x, y, side: 'left' as const });
    const bends = staggerBends([
      // Dos suben (la de más arriba dobla más cerca), una va derecha y dos bajan (la de más abajo dobla más cerca).
      { id: 'up1', box: 'home', source: right(10), target: left(600, -200) },
      { id: 'up2', box: 'home', source: right(20), target: left(600, -100) },
      { id: 'straight', box: 'home', source: right(30), target: left(600, 30) },
      { id: 'down1', box: 'home', source: right(40), target: left(600, 200) },
      { id: 'down2', box: 'home', source: right(50), target: left(600, 300) },
      { id: 'alone', box: 'other', source: right(10), target: left(600, 300) },
    ]);
    expect(bends.up1).toEqual({ x: 184 + 24 });
    expect(bends.up2).toEqual({ x: 184 + 40 });
    expect(bends.down2).toEqual({ x: 184 + 24 });
    expect(bends.down1).toEqual({ x: 184 + 40 });
    expect(bends.straight).toBeUndefined();
    expect(bends.alone).toBeUndefined();
  });

  it('sin lugar para doblar antes del destino, no fuerza el doblez', () => {
    const bends = staggerBends([
      { id: 'a', box: 'n', source: { x: 0, y: 10, side: 'right' }, target: { x: 30, y: -100, side: 'left' } },
      { id: 'b', box: 'n', source: { x: 0, y: 20, side: 'right' }, target: { x: 30, y: -50, side: 'left' } },
    ]);
    expect(bends).toEqual({});
  });
});
