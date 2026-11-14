/**
 * Cámara del lienzo (revisión de fluidez): un solo dueño de la vista para «Ver todo», localizar, abrir con una caja
 * enfocada, el modo tour y los recorridos. Cada movimiento es una única transición desde la vista actual hasta un
 * destino fijo, desplazamiento y escala a la vez:
 *
 * - El reloj empieza en el primer cuadro que se dibuja, no al pedirla: si el hilo principal está ocupado al empezar,
 *   la cámara no «salta» a mitad de camino (lo que pasaba con `fitView`, que arrancaba la transición y en el mismo
 *   paso reconstruía todos los nodos).
 * - Se interpola el punto del lienzo que queda en el centro y el zoom en escala logarítmica: sin el alejarse y volver
 *   a acercar de una interpolación «suave» de d3, sin rebotes ni correcciones al final.
 * - Una nueva petición reemplaza a la pendiente (no se encolan) y parte de donde está la vista en ese cuadro.
 * - Cambios insignificantes no se animan; con movimiento reducido la vista va directo al destino.
 * - `cancel()` deja la vista donde está: lo usa el lienzo cuando la persona arrastra o hace zoom, y al desmontarse.
 */

export interface View {
  x: number;
  y: number;
  zoom: number;
}

export interface CameraHost {
  getViewport(): View;
  setViewport(view: View): void;
  /** Tamaño del lienzo en px (para interpolar alrededor de su centro). */
  size(): { width: number; height: number };
}

export interface CameraOptions {
  /** ms; 0 = sin animación. */
  duration?: number;
}

/** Duración de los movimientos de cámara: corta, pero perceptible como desplazamiento (no como corte). */
export const CAMERA_MS = 320;

/** Diferencias por debajo de esto no se animan (ni se aplican): la vista ya está ahí. */
const PIXEL_EPSILON = 0.5;
const ZOOM_EPSILON = 0.002;

export function sameView(a: View, b: View): boolean {
  return (
    Math.abs(a.x - b.x) < PIXEL_EPSILON && Math.abs(a.y - b.y) < PIXEL_EPSILON && Math.abs(Math.log(a.zoom / b.zoom)) < ZOOM_EPSILON
  );
}

/** Aceleración y frenado suaves y simétricos (sin salto al empezar ni corrección al terminar). */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * Vista intermedia en `t` (0–1): el punto del lienzo que se ve en el centro avanza en línea recta y el zoom cambia en
 * proporción constante, así el contenido no se escapa del centro ni se aleja de más a mitad de camino.
 */
export function interpolateView(from: View, to: View, t: number, size: { width: number; height: number }): View {
  if (t <= 0) return from;
  if (t >= 1) return to;
  const cx = size.width / 2;
  const cy = size.height / 2;
  const centerFrom = { x: (cx - from.x) / from.zoom, y: (cy - from.y) / from.zoom };
  const centerTo = { x: (cx - to.x) / to.zoom, y: (cy - to.y) / to.zoom };
  const zoom = Math.exp(Math.log(from.zoom) + (Math.log(to.zoom) - Math.log(from.zoom)) * t);
  const center = { x: centerFrom.x + (centerTo.x - centerFrom.x) * t, y: centerFrom.y + (centerTo.y - centerFrom.y) * t };
  return { x: cx - center.x * zoom, y: cy - center.y * zoom, zoom };
}

export interface Camera {
  /** Lleva la vista a `target`; resuelve `true` al llegar y `false` si otra petición o `cancel()` la interrumpió. */
  to(target: View, options?: CameraOptions): Promise<boolean>;
  cancel(): void;
  /** Hay una transición en curso (el lienzo no guarda la vista en cada cuadro mientras tanto). */
  readonly animating: boolean;
  /** Avisa cada vez que un movimiento llega a destino (no en cada cuadro): ej. recordar la vista. */
  onSettle(listener: (view: View) => void): () => void;
}

export interface CameraEnv {
  raf: (cb: (time: number) => void) => number;
  caf: (id: number) => void;
  reducedMotion: () => boolean;
}

const browserEnv: CameraEnv = {
  raf: (cb) => requestAnimationFrame(cb),
  caf: (id) => cancelAnimationFrame(id),
  reducedMotion: () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
};

export function createCamera(host: CameraHost, env: CameraEnv = browserEnv): Camera {
  let frame: number | null = null;
  let finish: ((arrived: boolean) => void) | null = null;
  const listeners = new Set<(view: View) => void>();
  const settled = (view: View) => listeners.forEach((l) => l(view));

  const stop = (arrived: boolean) => {
    if (frame !== null) env.caf(frame);
    frame = null;
    const done = finish;
    finish = null;
    done?.(arrived);
  };

  return {
    get animating() {
      return frame !== null;
    },
    cancel: () => stop(false),
    onSettle(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    to(target, options = {}) {
      // Una petición nueva reemplaza a la pendiente: la anterior resuelve `false` y esta parte de la vista actual.
      stop(false);
      const duration = env.reducedMotion() ? 0 : (options.duration ?? CAMERA_MS);
      if (sameView(host.getViewport(), target)) return Promise.resolve(true);
      if (duration <= 0) {
        host.setViewport(target);
        settled(target);
        return Promise.resolve(true);
      }
      return new Promise<boolean>((resolve) => {
        finish = resolve;
        let start: number | null = null;
        let from: View | null = null;
        const step = (time: number) => {
          // El reloj empieza en el primer cuadro: lo que haya bloqueado antes no adelanta la transición.
          if (start === null) {
            start = time;
            from = host.getViewport();
          }
          const t = Math.min(1, (time - start) / duration);
          host.setViewport(t >= 1 ? target : interpolateView(from!, target, easeInOutCubic(t), host.size()));
          if (t >= 1) {
            frame = null;
            settled(target);
            stop(true);
          } else frame = env.raf(step);
        };
        frame = env.raf(step);
      });
    },
  };
}
