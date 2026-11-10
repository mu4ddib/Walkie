/**
 * Distribución del mapa de una app (spec mapa-de-la-app). La primera vez, las features se ordenan solas de izquierda a
 * derecha siguiendo los portales: una feature va una columna después de la más lejana que lleva a ella (las de entrada
 * a la izquierda); dentro de cada columna, cerca de las que la anteceden. Los componentes compartidos van en una fila
 * debajo, bajo las features que los usan. Lo que se movió a mano se respeta; lo nuevo se ubica sin encimarse.
 */
export type Point = { x: number; y: number };

/** Tamaño de las cajas del mapa (el mismo que dibuja `map.css`). */
export const FEATURE_BOX = { w: 280, h: 152 } as const;
export const CATALOG_BOX = { w: 216, h: 72 } as const;
const COLUMN_GAP = 168;
const ROW_GAP = 72;
const CATALOG_GAP = 168;

/** Clave de un elemento del catálogo en la distribución (las features usan su id). */
export const catalogKey = (itemId: string) => `catalog:${itemId}`;

/**
 * Posición automática de cada feature (`features` en el orden de desempate, ej. por nombre) y de cada elemento del
 * catálogo dado (`catalog`: id → features que lo usan).
 */
export function autoLayout(
  features: readonly string[],
  links: readonly { from: string; to: string }[],
  catalog: Readonly<Record<string, readonly string[]>> = {},
): Record<string, Point> {
  const known = new Set(features);
  const edges = links.filter((l) => l.from !== l.to && known.has(l.from) && known.has(l.to));
  const incoming = new Map(features.map((f) => [f, edges.filter((e) => e.to === f).map((e) => e.from)]));

  // Columna: la más larga cadena de portales que llega a ella (acotada: un ciclo no la empuja sin fin).
  const rank = new Map(features.map((f) => [f, 0]));
  for (let round = 0; round < features.length; round++) {
    let changed = false;
    for (const e of edges) {
      const next = Math.min(rank.get(e.from)! + 1, features.length - 1);
      if (next > rank.get(e.to)! && !reaches(edges, e.to, e.from)) {
        rank.set(e.to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Filas: cada columna en orden; una feature cerca de las que la anteceden (promedio de sus filas).
  const columns = new Map<number, string[]>();
  for (const f of features) columns.set(rank.get(f)!, [...(columns.get(rank.get(f)!) ?? []), f]);
  const row = new Map<string, number>();
  const positions: Record<string, Point> = {};
  for (const r of [...columns.keys()].sort((a, b) => a - b)) {
    const list = columns.get(r)!;
    const weight = (f: string) => {
      const rows = incoming.get(f)!.map((p) => row.get(p)).filter((v): v is number => v !== undefined);
      // Sin antecesores (o sueltas): al final de la columna, en su orden.
      return rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : Number.POSITIVE_INFINITY;
    };
    const ordered = list
      .map((f, i) => ({ f, w: weight(f), i }))
      .sort((a, b) => (a.w === b.w ? a.i - b.i : a.w - b.w))
      .map((x) => x.f);
    ordered.forEach((f, i) => {
      row.set(f, i);
      positions[f] = { x: r * (FEATURE_BOX.w + COLUMN_GAP), y: i * (FEATURE_BOX.h + ROW_GAP) };
    });
  }

  // Componentes compartidos: una fila debajo, cada uno bajo el promedio de sus features, sin encimarse.
  const bottom = Math.max(0, ...Object.values(positions).map((p) => p.y + FEATURE_BOX.h));
  const items = Object.entries(catalog)
    .map(([id, users]) => {
      const xs = users.map((u) => positions[u]?.x).filter((x): x is number => x !== undefined);
      return { id, x: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0 };
    })
    .sort((a, b) => a.x - b.x || a.id.localeCompare(b.id));
  let nextX = Number.NEGATIVE_INFINITY;
  for (const item of items) {
    const x = Math.max(item.x + (FEATURE_BOX.w - CATALOG_BOX.w) / 2, nextX);
    positions[catalogKey(item.id)] = { x, y: bottom + CATALOG_GAP };
    nextX = x + CATALOG_BOX.w + 32;
  }
  return positions;
}

/** ¿Desde `from` se llega a `to` por los portales? (para no empujar columnas en un ciclo) */
function reaches(edges: readonly { from: string; to: string }[], from: string, to: string): boolean {
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length) {
    const current = queue.shift()!;
    if (current === to) return true;
    for (const e of edges) {
      if (e.from === current && !seen.has(e.to)) {
        seen.add(e.to);
        queue.push(e.to);
      }
    }
  }
  return false;
}

/**
 * Lo guardado manda; lo que no tiene posición guardada toma la automática, y si con ella pisaría una caja ya ubicada,
 * baja hasta quedar libre. `sizes` da el tamaño de cada clave.
 */
export function mergeLayout(
  saved: Readonly<Record<string, Point>>,
  auto: Readonly<Record<string, Point>>,
  sizes: (key: string) => { w: number; h: number },
): Record<string, Point> {
  const result: Record<string, Point> = {};
  for (const key of Object.keys(auto)) if (saved[key]) result[key] = saved[key];
  const overlaps = (key: string, p: Point) =>
    Object.entries(result).some(([other, q]) => {
      const a = sizes(key);
      const b = sizes(other);
      return p.x < q.x + b.w + 16 && q.x < p.x + a.w + 16 && p.y < q.y + b.h + 16 && q.y < p.y + a.h + 16;
    });
  for (const key of Object.keys(auto)) {
    if (result[key]) continue;
    const p = { ...auto[key]! };
    while (overlaps(key, p)) p.y += ROW_GAP;
    result[key] = p;
  }
  return result;
}
