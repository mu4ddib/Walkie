import { describe, expect, it } from 'vitest';
import { createCamera, easeInOutCubic, interpolateView, MAX_STEP, sameView, type View } from './camera';

/** Reloj de cuadros falso: cada `frame(ms)` corre los callbacks pendientes con ese tiempo (sin depender de timers reales). */
function setup(options: { reduced?: boolean; start?: View } = {}) {
  let view: View = options.start ?? { x: 0, y: 0, zoom: 1 };
  const calls: View[] = [];
  let pending: ((t: number) => void)[] = [];
  const settled: View[] = [];
  const camera = createCamera(
    {
      getViewport: () => view,
      setViewport: (v) => {
        view = v;
        calls.push(v);
      },
      size: () => ({ width: 1000, height: 600 }),
    },
    {
      raf: (cb) => {
        pending.push(cb);
        return pending.length;
      },
      caf: () => {
        pending = [];
      },
      reducedMotion: () => !!options.reduced,
    },
  );
  camera.onSettle((v) => settled.push(v));
  const frame = (time: number) => {
    const run = pending;
    pending = [];
    run.forEach((cb) => cb(time));
  };
  return { camera, frame, calls, settled, view: () => view, set: (v: View) => (view = v) };
}

const target = { x: -800, y: -300, zoom: 0.5 };

describe('cámara del lienzo (revisión de fluidez)', () => {
  it('una sola transición: el reloj empieza en el segundo cuadro (sin salto aunque haya demora) y termina exacta', async () => {
    const { camera, frame, calls, settled } = setup();
    const done = camera.to(target, { duration: 300 });
    // El primer cuadro llega tarde (el hilo estaba ocupado) y paga el arranque: la vista no se mueve todavía.
    frame(1000);
    expect(calls).toEqual([]);
    // El segundo también tarda (pintar todo el lienzo): avanza poco, no a mitad de camino.
    frame(1200);
    // Sin el tope, 200 ms de 300 la dejarían a tres cuartos del camino (x ≈ -600).
    expect(Math.abs(calls[0]!.x)).toBeLessThan(20);
    for (let t = 1216; calls.at(-1) !== target && t < 3000; t += 16) frame(t);
    expect(calls.at(-1)).toEqual(target);
    await expect(done).resolves.toBe(true);
    // Recuerda la vista una sola vez, al llegar.
    expect(settled).toEqual([target]);
  });

  it('con cuadros lentos tarda más pero no salta: al menos 10 pasos y ninguno grande', () => {
    const { camera, frame, calls } = setup();
    void camera.to(target, { duration: 320 });
    // Safari pintando todo el lienzo al encuadrar: ~150 ms por cuadro (sin el tope serían 2 o 3 cuadros).
    for (let t = 0; calls.at(-1) !== target && t < 10_000; t += 150) frame(t);
    expect(calls.at(-1)).toEqual(target);
    expect(calls.length).toBeGreaterThanOrEqual(1 / MAX_STEP);
    const zooms = [1, ...calls.map((c) => c.zoom)];
    const progress = zooms.map((z) => Math.log(z) / Math.log(target.zoom));
    const steps = progress.slice(1).map((p, i) => p - progress[i]!);
    expect(Math.max(...steps)).toBeLessThan(0.25);
  });

  it('avanza siempre hacia el destino: el zoom no se aleja de más ni vuelve atrás', () => {
    const { camera, frame, calls } = setup();
    void camera.to(target, { duration: 300 });
    for (let t = 0; t <= 300; t += 16) frame(t);
    frame(301);
    const zooms = calls.map((c) => c.zoom);
    for (let i = 1; i < zooms.length; i++) expect(zooms[i]!).toBeLessThanOrEqual(zooms[i - 1]! + 1e-9);
  });

  it('una petición nueva reemplaza a la pendiente (no se encola) y parte de donde está la vista', async () => {
    const { camera, frame, calls } = setup();
    const first = camera.to(target, { duration: 300 });
    frame(0);
    frame(100);
    const where = calls.at(-1)!;
    const second = camera.to({ x: 0, y: 0, zoom: 2 }, { duration: 300 });
    await expect(first).resolves.toBe(false);
    frame(200);
    expect(calls.at(-1)).toEqual(where);
    for (let t = 216; t < 2000; t += 16) frame(t);
    expect(calls.at(-1)).toEqual({ x: 0, y: 0, zoom: 2 });
    await expect(second).resolves.toBe(true);
  });

  it('cancelar (la persona arrastra o hace zoom) deja la vista donde está y no la recuerda como destino', async () => {
    const { camera, frame, calls, settled } = setup();
    const done = camera.to(target, { duration: 300 });
    frame(0);
    frame(120);
    const count = calls.length;
    camera.cancel();
    expect(camera.animating).toBe(false);
    frame(200);
    expect(calls.length).toBe(count);
    await expect(done).resolves.toBe(false);
    expect(settled).toEqual([]);
  });

  it('si ya está encuadrada no se mueve; con movimiento reducido va directo', async () => {
    const still = setup({ start: target });
    await expect(still.camera.to({ ...target, x: target.x + 0.2 })).resolves.toBe(true);
    expect(still.calls).toEqual([]);

    const reduced = setup({ reduced: true });
    await expect(reduced.camera.to(target)).resolves.toBe(true);
    expect(reduced.calls).toEqual([target]);
    expect(reduced.settled).toEqual([target]);
  });

  it('interpola el centro en línea recta y el zoom en proporción constante', () => {
    const size = { width: 1000, height: 600 };
    const from = { x: 0, y: 0, zoom: 1 };
    const to = { x: -1000, y: -600, zoom: 4 };
    const mid = interpolateView(from, to, 0.5, size);
    expect(mid.zoom).toBeCloseTo(2);
    // El punto del lienzo en el centro de la pantalla está a mitad de camino entre los dos centros.
    const center = (v: View) => ({ x: (500 - v.x) / v.zoom, y: (300 - v.y) / v.zoom });
    expect(center(mid).x).toBeCloseTo((center(from).x + center(to).x) / 2);
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(sameView(from, { x: 0.3, y: -0.3, zoom: 1.001 })).toBe(true);
  });
});
