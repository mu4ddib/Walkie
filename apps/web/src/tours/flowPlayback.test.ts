import { describe, expect, it } from 'vitest';
import type { Tour } from '../schema/walkie-graph';
import { advance, ended, firstPhase, goTo, phaseDuration, type Playing } from './flowPlayback';

const tour: Tour = {
  id: 't',
  name: 'Alta',
  steps: [{ edgeId: 'e1' }, { nodeId: 'n' }, { edgeId: 'e2' }],
};
const start: Playing = { tourId: 't', step: 0, phase: 'source', mode: 'play' };

describe('reproducción de un recorrido', () => {
  it('cada paso de conexión pasa por origen, recorrido y destino; uno de nodo, solo destino', () => {
    let p = start;
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      seen.push(`${p.step}:${p.phase}`);
      p = advance(tour, p);
    }
    expect(seen).toEqual(['0:source', '0:travel', '0:target', '1:target', '2:source', '2:travel']);
    expect(p).toMatchObject({ step: 2, phase: 'target', mode: 'play' });
    // Al terminar el último paso se detiene: terminó.
    p = advance(tour, p);
    expect(ended(tour, p)).toBe(true);
  });

  it('pausa congela; avanzar un paso en pausa lo muestra entero y se detiene', () => {
    const paused: Playing = { ...start, phase: 'travel', mode: 'paused' };
    expect(advance(tour, paused)).toBe(paused);

    let p = goTo(tour, paused, 2);
    expect(p).toMatchObject({ step: 2, phase: 'source', mode: 'step' });
    p = advance(tour, advance(tour, p));
    expect(p).toMatchObject({ step: 2, phase: 'target', mode: 'step' });
    p = advance(tour, p);
    expect(p.mode).toBe('paused');
    // Retroceder mientras se reproduce sigue reproduciendo.
    expect(goTo(tour, { ...start, step: 2 }, 1)).toMatchObject({ step: 1, phase: 'target', mode: 'play' });
    expect(goTo(tour, start, 9).step).toBe(2);
  });

  it('la velocidad acorta o alarga cada fase', () => {
    expect(phaseDuration(tour, start, 2)).toBe(phaseDuration(tour, start, 1) / 2);
    expect(firstPhase(tour, 1)).toBe('target');
  });
});
