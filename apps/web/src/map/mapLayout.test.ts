import { describe, expect, it } from 'vitest';
import { CATALOG_BOX, FEATURE_BOX, autoLayout, catalogKey, mergeLayout } from './mapLayout';

const size = (key: string) => (key.startsWith('catalog:') ? CATALOG_BOX : FEATURE_BOX);

describe('autoLayout', () => {
  it('ordena de izquierda a derecha siguiendo los portales; las de entrada a la izquierda', () => {
    const p = autoLayout(['events', 'home', 'login', 'loose'], [
      { from: 'login', to: 'home' },
      { from: 'home', to: 'events' },
      { from: 'login', to: 'events' },
    ]);
    expect(p.login!.x).toBe(0);
    expect(p.home!.x).toBeGreaterThan(p.login!.x);
    // Eventos va después de la más lejana que lleva a ella (Home), no al lado de Login.
    expect(p.events!.x).toBeGreaterThan(p.home!.x);
    // La suelta queda en la primera columna, después de las conectadas.
    expect(p.loose!.x).toBe(0);
    expect(p.loose!.y).toBeGreaterThan(p.login!.y);
  });

  it('un ciclo (ida y vuelta) no empuja las columnas sin fin y nada se encima', () => {
    const p = autoLayout(['a', 'b', 'c'], [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'a' },
      { from: 'b', to: 'c' },
    ]);
    const boxes = Object.values(p);
    expect(new Set(boxes.map((q) => `${q.x},${q.y}`)).size).toBe(3);
    expect(Math.max(...boxes.map((q) => q.x))).toBeLessThan(3 * (FEATURE_BOX.w + 200));
  });

  it('los componentes compartidos van en una fila debajo, bajo sus features', () => {
    const p = autoLayout(['login', 'events'], [{ from: 'login', to: 'events' }], {
      api: ['login', 'events'],
      db: ['events'],
    });
    const api = p[catalogKey('api')]!;
    const db = p[catalogKey('db')]!;
    expect(api.y).toBeGreaterThan(p.login!.y + FEATURE_BOX.h);
    expect(api.y).toBe(db.y);
    expect(db.x).toBeGreaterThanOrEqual(api.x + CATALOG_BOX.w);
  });
});

describe('mergeLayout', () => {
  it('respeta lo guardado y ubica lo nuevo sin encimarse', () => {
    const auto = { a: { x: 0, y: 0 }, b: { x: 0, y: 224 } };
    const merged = mergeLayout({ a: { x: 0, y: 240 } }, auto, size);
    expect(merged.a).toEqual({ x: 0, y: 240 });
    // b caería encima de a: baja hasta quedar libre.
    expect(merged.b!.y).toBeGreaterThanOrEqual(240 + FEATURE_BOX.h + 16);
    // Las posiciones guardadas de algo que ya no existe no se devuelven.
    expect(mergeLayout({ gone: { x: 1, y: 1 } }, auto, size)).not.toHaveProperty('gone');
  });
});
