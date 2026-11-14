import type { Rect } from './ports';

/**
 * Índice espacial en grilla de las cajas del lienzo (revisión de fluidez): para cada conexión solo interesan las cajas
 * cerca de su trazo. Sin él, cada conexión recorría todas las cajas del lienzo en cada cambio (O(conexiones × cajas)).
 * Se arma de nuevo en cada cálculo (O(cajas)); la consulta devuelve lo mismo que filtrar la lista entera.
 */
export class RectGrid<T extends { id: string; rect: Rect }> {
  private cells = new Map<string, T[]>();

  constructor(
    items: readonly T[],
    private readonly size = 400,
  ) {
    for (const item of items) {
      const { x0, x1, y0, y1 } = this.range(item.rect);
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const key = `${x},${y}`;
          const cell = this.cells.get(key);
          if (cell) cell.push(item);
          else this.cells.set(key, [item]);
        }
      }
    }
  }

  private range(r: Rect) {
    return {
      x0: Math.floor(r.x / this.size),
      x1: Math.floor((r.x + r.w) / this.size),
      y0: Math.floor(r.y / this.size),
      y1: Math.floor((r.y + r.h) / this.size),
    };
  }

  /** Cajas que se cruzan con `area` (cada una una vez, en el orden en que se agregaron dentro de cada celda). */
  query(area: Rect): T[] {
    const { x0, x1, y0, y1 } = this.range(area);
    const found = new Set<T>();
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (const item of this.cells.get(`${x},${y}`) ?? []) {
          const r = item.rect;
          if (r.x < area.x + area.w && r.x + r.w > area.x && r.y < area.y + area.h && r.y + r.h > area.y) found.add(item);
        }
      }
    }
    return [...found];
  }
}

/** Rectángulo que cubre dos puntos con un margen alrededor. */
export function around(a: { x: number; y: number }, b: { x: number; y: number }, margin: number): Rect {
  const x = Math.min(a.x, b.x) - margin;
  const y = Math.min(a.y, b.y) - margin;
  return { x, y, w: Math.abs(a.x - b.x) + margin * 2, h: Math.abs(a.y - b.y) + margin * 2 };
}
