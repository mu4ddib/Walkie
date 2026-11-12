/** Desde cuántos pasos la lista solo dibuja los que se ven (spec tours-a-escala). */
export const VIRTUAL_FROM = 80;
/** Alto estimado de un paso cerrado (px, con la separación) mientras no se ha medido. */
export const STEP_ESTIMATE = 56;
/** Pasos de más que se dibujan arriba y abajo de lo visible. */
export const OVERSCAN = 8;

/** Posición de cada paso desde el principio de la lista; el último valor es el alto total. */
export function offsetsOf(heights: readonly number[]): number[] {
  const offsets = [0];
  for (const h of heights) offsets.push(offsets[offsets.length - 1]! + h);
  return offsets;
}

/**
 * Pasos a dibujar, `[start, end)`: los que tocan la franja visible `[top, top + height)` (medida desde el principio de
 * la lista) más `overscan` de cada lado. `keep` (un paso que se arrastra) siempre queda dentro.
 */
export function windowRange(
  offsets: readonly number[],
  top: number,
  height: number,
  overscan = OVERSCAN,
  keep?: number,
): [number, number] {
  const count = offsets.length - 1;
  if (count <= 0) return [0, 0];
  // Primer paso cuyo final pasa de `top`, y primero que empieza después de `top + height` (búsqueda binaria).
  const first = search(offsets, (o) => o > top, 1) - 1;
  const last = search(offsets, (o) => o >= top + height, 0);
  let start = Math.max(0, Math.min(first, count - 1) - overscan);
  let end = Math.min(count, Math.max(last, first + 1) + overscan);
  if (keep !== undefined && keep >= 0 && keep < count) {
    start = Math.min(start, keep);
    end = Math.max(end, keep + 1);
  }
  return [start, end];
}

/** Primer índice `i >= from` que cumple `past` (o `offsets.length - 1`); `past` es monótona. */
function search(offsets: readonly number[], past: (offset: number) => boolean, from: number): number {
  let lo = from;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (past(offsets[mid]!)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}
