import { GRID } from '../theme/palette';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Aire entre cajas al ubicar un grupo nuevo o empujar las de abajo. */
export const SPACE_GAP = GRID * 3;

const overlaps = (a: Rect, b: Rect, gap = 0) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/**
 * Dónde poner una caja nueva de tamaño `want` sin taparse con nada: el punto libre más cercano a `want` dentro de la
 * vista (en pasos de la grilla, en espiral); si la vista está llena, debajo de todo lo que hay.
 */
export function freeSpot(want: Rect, obstacles: readonly Rect[], view: Rect): { x: number; y: number } {
  const step = GRID * 4;
  const fits = (r: Rect) => !obstacles.some((o) => overlaps(r, o, SPACE_GAP));
  if (fits(want)) return { x: want.x, y: want.y };
  const maxRing = Math.ceil(Math.max(view.w, view.h) / step);
  for (let ring = 1; ring <= maxRing; ring++) {
    const candidates: { x: number; y: number; d: number }[] = [];
    for (let i = -ring; i <= ring; i++) {
      for (const [dx, dy] of [
        [i, -ring],
        [i, ring],
        [-ring, i],
        [ring, i],
      ] as const) {
        const x = want.x + dx * step;
        const y = want.y + dy * step;
        candidates.push({ x, y, d: Math.hypot(dx, dy) });
      }
    }
    candidates.sort((a, b) => a.d - b.d);
    for (const c of candidates) {
      const r = { ...want, x: c.x, y: c.y };
      const inside = r.x >= view.x && r.y >= view.y && r.x + r.w <= view.x + view.w && r.y + r.h <= view.y + view.h;
      if (inside && fits(r)) return { x: c.x, y: c.y };
    }
  }
  const bottom = obstacles.length > 0 ? Math.max(...obstacles.map((o) => o.y + o.h)) : want.y;
  return { x: want.x, y: bottom + SPACE_GAP * 2 };
}

/**
 * Una caja creció (de `before` a `after`, ej. al completar su contrato): las que estaban debajo y ahora quedan tapadas
 * bajan lo justo, y las que esas tapan también (en cascada). Devuelve la posición nueva de cada caja que se mueve.
 * Solo empuja hacia abajo lo que antes no se tocaba: no reacomoda superposiciones que ya existían.
 */
export function pushBelow(
  id: string,
  before: Rect,
  after: Rect,
  boxes: Readonly<Record<string, Rect>>,
): Record<string, { x: number; y: number }> {
  const moved: Record<string, { x: number; y: number }> = {};
  const current: Record<string, Rect> = { ...boxes, [id]: after };
  const queue: { id: string; before: Rect }[] = [{ id, before }];
  while (queue.length > 0) {
    const { id: grownId, before: was } = queue.shift()!;
    const grown = current[grownId]!;
    for (const [other, rect] of Object.entries(current)) {
      if (other === grownId || other === id) continue;
      const below = rect.y >= was.y;
      const sameColumn = rect.x < grown.x + grown.w && grown.x < rect.x + rect.w;
      if (!below || !sameColumn || overlaps(was, rect) || !overlaps(grown, rect)) continue;
      const y = grown.y + grown.h + SPACE_GAP;
      if (y <= rect.y) continue;
      const next = { ...rect, y };
      queue.push({ id: other, before: rect });
      current[other] = next;
      moved[other] = { x: rect.x, y };
    }
  }
  return moved;
}
