import type { Tour } from '../schema/walkie-graph';

/**
 * Reproducción de un recorrido (spec recorridos-y-grupos, parte 4). Es estado de visualización: vive en el lienzo,
 * nunca en el store, así el autoguardado no la ve.
 *
 * Cada paso de conexión pasa por tres fases: `source` (se resalta el origen), `travel` (se anima la conexión en su
 * sentido real) y `target` (se destaca el destino). Un paso de nodo, o uno cuya conexión se eliminó, solo tiene
 * `target`.
 */
export type FlowPhase = 'source' | 'travel' | 'target';

/** `play` avanza solo; `step` termina el paso en curso y se detiene; `paused` queda quieto. */
export type FlowMode = 'play' | 'step' | 'paused';

export interface Playing {
  tourId: string;
  step: number;
  phase: FlowPhase;
  mode: FlowMode;
}

/** Duración de cada fase a 1× (ms). */
export const FLOW_TIMING: Record<FlowPhase, number> = { source: 700, travel: 1500, target: 900 };
/** Un paso de nodo se muestra este tiempo a 1×. */
export const FLOW_NODE_MS = 1600;

/** Fase con la que empieza un paso. */
export function firstPhase(tour: Tour | undefined, step: number): FlowPhase {
  return tour?.steps[step]?.edgeId ? 'source' : 'target';
}

/** Lo que dura la fase actual a `speed`. */
export function phaseDuration(tour: Tour | undefined, p: Playing, speed: number): number {
  const base = tour?.steps[p.step]?.edgeId ? FLOW_TIMING[p.phase] : FLOW_NODE_MS;
  return Math.round(base / speed);
}

/** Siguiente estado al terminar la fase en curso (no cambia nada si está en pausa). */
export function advance(tour: Tour | undefined, p: Playing): Playing {
  if (p.mode === 'paused') return p;
  if (p.phase === 'source') return { ...p, phase: 'travel' };
  if (p.phase === 'travel') return { ...p, phase: 'target' };
  const last = (tour?.steps.length ?? 0) - 1;
  // Terminó el paso: en `step` se detiene aquí; en `play`, sigue con el próximo o termina.
  if (p.mode === 'step' || p.step >= last) return { ...p, mode: 'paused' };
  return { ...p, step: p.step + 1, phase: firstPhase(tour, p.step + 1) };
}

/** Ir a un paso: si se estaba reproduciendo, sigue; si no, se muestra ese paso completo una vez y se detiene. */
export function goTo(tour: Tour | undefined, p: Playing, step: number): Playing {
  const count = tour?.steps.length ?? 0;
  const target = Math.max(0, Math.min(count - 1, step));
  return { ...p, step: target, phase: firstPhase(tour, target), mode: p.mode === 'play' ? 'play' : 'step' };
}

/** ¿Terminó? (último paso mostrado y en pausa) */
export function ended(tour: Tour | undefined, p: Playing): boolean {
  return p.mode === 'paused' && p.step === (tour?.steps.length ?? 0) - 1 && p.phase === 'target';
}
