import type { Rect } from './ports';
import type { Point } from './route';

/**
 * Etiquetas de las conexiones de un mismo par (spec conexiones-ida-y-vuelta, tarea 2): cada una sobre su propio trazo,
 * sin pisar a las otras ni a una caja. Si no hay lugar, el par muestra una etiqueta compuesta («llama ⇄ responde 201»):
 * las etiquetas quedan juntas, una al lado de la otra, y cada mitad sigue siendo la de su conexión.
 */

/** Separación mínima entre etiquetas, y entre una etiqueta y una caja (px). */
export const LABEL_MARGIN = 6;
/** Hueco entre las partes de una etiqueta compuesta, donde va «⇄» (px). */
export const JOIN_GAP = 18;
/** Dónde se prueba poner la etiqueta, como fracción del largo del trazo: primero la mitad. */
const CANDIDATES = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8];

/**
 * Tamaño aproximado de una etiqueta por su texto (12 px de IBM Plex Sans, con su borde y relleno), con el número de
 * paso y el distintivo del código (monoespaciado, con relleno) si los tiene.
 */
export function labelSize(text: string, extras: { step?: boolean; code?: boolean } = {}): { w: number; h: number } {
  return { w: Math.ceil(text.length * 6.8) + 22 + (extras.step ? 21 : 0) + (extras.code ? 12 : 0), h: 22 };
}

/** Punto a la fracción `t` (0 a 1) del largo de una polilínea. */
export function pointAt(points: readonly Point[], t: number): Point {
  const lengths = points.slice(1).map((p, i) => Math.abs(p.x - points[i]!.x) + Math.abs(p.y - points[i]!.y));
  let left = lengths.reduce((a, b) => a + b, 0) * t;
  for (let i = 0; i < lengths.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (left <= lengths[i]!) {
      const f = lengths[i]! === 0 ? 0 : left / lengths[i]!;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
    left -= lengths[i]!;
  }
  return { ...points[points.length - 1]! };
}

const boxAt = (center: Point, size: { w: number; h: number }): Rect => ({
  x: center.x - size.w / 2,
  y: center.y - size.h / 2,
  w: size.w,
  h: size.h,
});

/** ¿Se tocan dos cajas, contando un margen entre ellas? */
export function touches(a: Rect, b: Rect, margin = LABEL_MARGIN): boolean {
  return a.x < b.x + b.w + margin && b.x < a.x + a.w + margin && a.y < b.y + b.h + margin && b.y < a.y + a.h + margin;
}

export interface PairLabel {
  id: string;
  /** El trazo de la conexión. */
  points: readonly Point[];
  size: { w: number; h: number };
}

export interface PlacedLabel {
  x: number;
  y: number;
  /** En la etiqueta compuesta: primera, del medio o última. */
  joined?: 'start' | 'middle' | 'end';
}

/**
 * Centro de la etiqueta de cada conexión de un par. `boxes` son las cajas que no se deben tapar (nodos, grupos
 * plegados, notas) y `taken` las etiquetas ya puestas de otros pares.
 */
export function placePairLabels(
  labels: readonly PairLabel[],
  boxes: readonly Rect[],
  taken: readonly Rect[] = [],
): Record<string, PlacedLabel> {
  const placed: Rect[] = [];
  const result: Record<string, PlacedLabel> = {};
  for (const label of labels) {
    const spot = CANDIDATES.map((t) => pointAt(label.points, t)).find((p) => {
      const box = boxAt(p, label.size);
      return ![...placed, ...taken].some((r) => touches(box, r)) && !boxes.some((r) => touches(box, r, 0));
    });
    if (!spot) return joinLabels(labels, boxes, taken);
    placed.push(boxAt(spot, label.size));
    result[label.id] = spot;
  }
  return result;
}

/** Corrimientos (px) que prueba la etiqueta compuesta si a mitad del trazo tapa algo: arriba y abajo, alternando. */
const JOIN_SHIFTS = [0, -30, 30, -60, 60, -90, 90];

/**
 * Etiqueta compuesta: todas en fila, centradas a mitad del trazo de la primera; si ahí tapan una caja u otra etiqueta,
 * un poco más arriba o más abajo (la primera posición libre). Si ninguna lo está, a mitad del trazo.
 */
function joinLabels(labels: readonly PairLabel[], boxes: readonly Rect[], taken: readonly Rect[]): Record<string, PlacedLabel> {
  const center = pointAt(labels[0]!.points, 0.5);
  const total = labels.reduce((sum, l) => sum + l.size.w, 0) + JOIN_GAP * (labels.length - 1);
  const h = Math.max(...labels.map((l) => l.size.h));
  const free = (dy: number) => {
    const group = { x: center.x - total / 2, y: center.y + dy - h / 2, w: total, h };
    return !boxes.some((r) => touches(group, r, 0)) && !taken.some((r) => touches(group, r));
  };
  const dy = JOIN_SHIFTS.find(free) ?? 0;
  let x = center.x - total / 2;
  const result: Record<string, PlacedLabel> = {};
  labels.forEach((label, i) => {
    result[label.id] = {
      x: x + label.size.w / 2,
      y: center.y + dy,
      joined: i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle',
    };
    x += label.size.w + JOIN_GAP;
  });
  return result;
}
