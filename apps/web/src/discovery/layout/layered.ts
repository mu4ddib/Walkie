/**
 * Distribución por capas del lienzo inicial de Walkie Live (spec walkie-live-documentacion, parte 3). Propia, sin
 * dependencias: una variante reducida de Sugiyama para el caso del lienzo descubierto (pantallas que navegan entre sí
 * y llaman a APIs).
 *
 * - Las pantallas van en capas de izquierda a derecha por la navegación (la más larga cadena que llega a cada una).
 * - Cada API va en un bloque junto a quien la llama: a la derecha de su pantalla si la llama una sola capa, o entre las
 *   dos capas que la comparten. Así las llamadas son cortas y salen en abanico hacia un lado, sin cruzar la lista.
 * - Hasta tres APIs de una sola pantalla van en una fila debajo de ella (más compacto, como Pedidos).
 * - Un bloque con muchas APIs se parte en subcolumnas (con las filas que mejor llenan la vista), corridas media fila, para que los
 *   trazos a la subcolumna lejana pasen por los huecos de la cercana.
 * - El orden dentro de cada capa sale del baricentro de sus vecinos (barridos de ida y vuelta), lo que reduce cruces.
 * - Si una navegación atraviesa un bloque, el bloque empieza una fila más abajo: el corredor de la navegación queda libre.
 * - El hueco entre una pantalla y sus APIs deja lugar a la etiqueta de la llamada.
 *
 * Cada caja ocupa lo que mide de verdad (`size`: ancho y alto según su título, ver `boxSize`), así una API de ruta
 * larga, que en el lienzo ocupa dos o tres líneas, no se encima con la de abajo.
 *
 * Determinista (el mismo borrador da las mismas posiciones) y en la grilla de 8 px. No toca lienzos existentes: solo
 * ubica un borrador nuevo.
 */
export type Point = { x: number; y: number };
export type Link = { from: string; to: string };

export interface LayeredMetrics {
  /** Tamaño mínimo de una caja (cada una ocupa lo que da `size`, nunca menos). */
  box: { w: number; h: number };
  /** Entre filas de una columna. */
  rowGap: number;
  /** Entre una columna y la siguiente cuando las une una llamada con etiqueta. */
  labelGap: number;
  /** Entre subcolumnas de un mismo bloque. */
  subGap: number;
  /** Entre dos capas de pantallas sin bloque entre ellas. */
  screenGap: number;
  /** Aire extra entre una pantalla y la fila de APIs debajo de ella (para la etiqueta). */
  belowGap: number;
  /** Filas por subcolumna que se prueban: se queda la que mejor llena `area` (la vista libre del editor). */
  perColumn: readonly number[];
  area: { w: number; h: number };
}

export const LAYERED_METRICS: LayeredMetrics = {
  box: { w: 184, h: 72 },
  rowGap: 32,
  labelGap: 160,
  subGap: 48,
  screenGap: 128,
  belowGap: 32,
  perColumn: [6, 7, 8, 9, 10, 12],
  area: { w: 1160, h: 700 },
};

/** Hasta cuántas APIs de una sola pantalla van en una fila debajo de ella. */
const BELOW_MAX = 3;

type Size = { w: number; h: number };
const snap = (v: number) => Math.round(v / 8) * 8 || 0;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Posiciones de `screens` y `others` (APIs, módulos, recursos) según la navegación (`navigation`, ya sin ciclos: de la
 * ruta menos profunda a la más profunda) y las llamadas (`calls`, de una pantalla a otra cosa).
 */
export function layeredLayout(
  screens: readonly string[],
  others: readonly string[],
  navigation: readonly Link[],
  calls: readonly Link[],
  metrics: LayeredMetrics = LAYERED_METRICS,
  size: (key: string) => Size = () => ({ w: 184, h: 104 }),
): Record<string, Point> {
  const sized = (k: string): Size => {
    const s = size(k);
    return { w: Math.max(metrics.box.w, s.w), h: Math.max(metrics.box.h, s.h) };
  };
  // Pocas filas por columna dan un lienzo ancho y bajo; muchas, uno alto. Se elige la que entra con más zoom en la
  // vista libre (desempata la de menos filas, con trazos más cortos).
  let best: { zoom: number; positions: Record<string, Point> } | undefined;
  for (const perColumn of metrics.perColumn) {
    const positions = layout(screens, others, navigation, calls, metrics, sized, perColumn);
    const keys = Object.keys(positions);
    const w = Math.max(0, ...keys.map((k) => positions[k]!.x + sized(k).w));
    const h = Math.max(0, ...keys.map((k) => positions[k]!.y + sized(k).h));
    const zoom = Math.min(metrics.area.w / Math.max(w, 1), metrics.area.h / Math.max(h, 1));
    if (!best || zoom > best.zoom + 0.01) best = { zoom, positions };
  }
  return best!.positions;
}

function layout(
  screens: readonly string[],
  others: readonly string[],
  navigation: readonly Link[],
  calls: readonly Link[],
  metrics: LayeredMetrics,
  size: (key: string) => Size,
  perColumn: number,
): Record<string, Point> {
  const columnWidth = (keys: readonly string[]) => Math.max(metrics.box.w, ...keys.map((k) => size(k).w));
  /** Alto de una lista apilada (con su aire entre cajas). */
  const stackHeight = (keys: readonly string[]) => keys.reduce((sum, k) => sum + size(k).h, 0) + metrics.rowGap * Math.max(0, keys.length - 1);
  const screenSet = new Set(screens);
  const nav = navigation.filter((l) => l.from !== l.to && screenSet.has(l.from) && screenSet.has(l.to));
  // Las pantallas de una capa van en filas del alto de la más alta.
  const screenStep = Math.max(metrics.box.h, ...screens.map((k) => size(k).h)) + metrics.rowGap;

  // Capas de pantallas: la más larga cadena de navegación que llega (la navegación ya viene sin ciclos).
  const rank = new Map(screens.map((s) => [s, 0]));
  for (let round = 0; round < screens.length; round++) {
    let changed = false;
    for (const l of nav) {
      const next = Math.min(rank.get(l.from)! + 1, screens.length - 1);
      if (next > rank.get(l.to)!) {
        rank.set(l.to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const layers = Math.max(0, ...rank.values()) + 1;

  // Quién llama a cada otra caja y en qué bloque va: entre la primera y la última capa que la llaman.
  const callers = new Map(others.map((o) => [o, [] as string[]]));
  for (const c of calls) if (screenSet.has(c.from) && callers.has(c.to) && !callers.get(c.to)!.includes(c.from)) callers.get(c.to)!.push(c.from);
  const block = new Map<string, number>();
  const loose: string[] = [];
  for (const o of others) {
    const ranks = callers.get(o)!.map((s) => rank.get(s)!);
    if (ranks.length === 0) loose.push(o);
    else block.set(o, Math.max(Math.min(...ranks), Math.max(...ranks) - 1));
  }

  // Orden de las pantallas dentro de su capa: baricentro de sus vecinas por la navegación, barridos de ida y vuelta.
  const byLayer: string[][] = Array.from({ length: layers }, () => []);
  for (const s of screens) byLayer[rank.get(s)!]!.push(s);
  const row = new Map<string, number>();
  byLayer.forEach((l) => l.forEach((s, i) => row.set(s, i)));
  const neighbours = (s: string, dir: -1 | 1) =>
    nav.filter((l) => (dir < 0 ? l.to === s : l.from === s)).map((l) => row.get(dir < 0 ? l.from : l.to)!);
  for (let sweep = 0; sweep < 4; sweep++) {
    const dir = sweep % 2 === 0 ? -1 : 1;
    const order = dir < 0 ? byLayer.keys() : [...byLayer.keys()].reverse().values();
    for (const r of order) {
      const list = byLayer[r]!;
      const weight = new Map(
        list.map((s) => {
          const ns = neighbours(s, dir);
          return [s, ns.length ? mean(ns) : row.get(s)!];
        }),
      );
      list.sort((a, b) => weight.get(a)! - weight.get(b)! || row.get(a)! - row.get(b)!);
      list.forEach((s, i) => row.set(s, i));
    }
  }

  // Bloques: sus cajas ordenadas por el baricentro de quienes las llaman (y por clave al empatar).
  const blocks: string[][] = Array.from({ length: layers }, () => []);
  for (const o of others) if (block.has(o)) blocks[block.get(o)!]!.push(o);
  const callerRow = (o: string) => mean(callers.get(o)!.map((s) => row.get(s)!));
  for (const b of blocks) b.sort((x, y) => callerRow(x) - callerRow(y) || x.localeCompare(y));

  // Columnas: pantallas de la capa r, después su bloque (en subcolumnas), después la capa siguiente.
  const positions: Record<string, Point> = {};
  let x = 0;
  for (let r = 0; r < layers; r++) {
    for (const s of byLayer[r]!) positions[s] = { x, y: row.get(s)! * screenStep };
    const items = blocks[r]!;
    if (items.length === 0) {
      x += columnWidth(byLayer[r]!) + metrics.screenGap;
      continue;
    }
    const only = byLayer[r]!.length === 1 ? byLayer[r]![0]! : undefined;
    if (only && items.length <= BELOW_MAX && items.every((o) => callers.get(o)!.every((s) => s === only))) {
      // Pocas APIs de una sola pantalla: en una fila debajo de ella (como las de Pedidos), sin otra columna.
      const rowWidth = items.reduce((sum, o) => sum + size(o).w, 0) + metrics.subGap * (items.length - 1);
      const span = Math.max(size(only).w, rowWidth);
      const y = positions[only]!.y + size(only).h + metrics.rowGap + metrics.belowGap;
      positions[only] = { x: x + (span - size(only).w) / 2, y: positions[only]!.y };
      let left = x + (span - rowWidth) / 2;
      for (const o of items) {
        positions[o] = { x: left, y };
        left += size(o).w + metrics.subGap;
      }
      x += span + metrics.screenGap;
      continue;
    }
    x += columnWidth(byLayer[r]!) + metrics.labelGap;
    const columns = items.length <= perColumn + 2 ? 1 : Math.ceil(items.length / perColumn);
    const rows = Math.ceil(items.length / columns);
    const lists = Array.from({ length: columns }, (_, c) => items.slice(c * rows, (c + 1) * rows));
    // Las subcolumnas impares, corridas media caja: los trazos a la lejana pasan por los huecos de la cercana.
    const shift = (c: number) => (c % 2 === 1 ? (size(lists[c]![0]!).h + metrics.rowGap) / 2 : 0);
    const height = Math.max(...lists.map((l, c) => stackHeight(l) + shift(c)));
    // Una navegación que pasa por este bloque (de la capa r o antes a una posterior): el bloque empieza debajo.
    const crossed = nav.some((l) => rank.get(l.from)! <= r && rank.get(l.to)! > r);
    const callerBoxes = items.flatMap((o) => callers.get(o)!).map((s) => ({ y: positions[s]?.y ?? row.get(s)! * screenStep, h: size(s).h }));
    const top = crossed
      ? Math.min(...callerBoxes.map((b) => b.y)) + screenStep
      : mean(callerBoxes.map((b) => b.y + b.h / 2)) - height / 2;
    lists.forEach((list, c) => {
      let y = top + shift(c);
      for (const o of list) {
        positions[o] = { x, y };
        y += size(o).h + metrics.rowGap;
      }
      x += columnWidth(list) + (c < columns - 1 ? metrics.subGap : metrics.labelGap);
    });
  }

  // Lo que nadie llama (o lo llama algo que no es una pantalla): al final, en columnas.
  loose.sort((a, b) => a.localeCompare(b));
  if (screens.length === 0) {
    // Sin pantallas (un módulo): una grilla casi cuadrada, cada fila del alto de su caja más alta.
    const columns = Math.max(1, Math.ceil(Math.sqrt(loose.length / 2)));
    const w = columnWidth(loose) + metrics.subGap;
    let y = 0;
    for (let i = 0; i < loose.length; i += columns) {
      const line = loose.slice(i, i + columns);
      line.forEach((o, c) => (positions[o] = { x: c * w, y }));
      y += Math.max(...line.map((o) => size(o).h)) + metrics.rowGap;
    }
  } else {
    if (loose.length) x = Math.max(x - metrics.labelGap - metrics.screenGap, 0) + metrics.screenGap;
    let y = 0;
    for (const o of loose) {
      positions[o] = { x, y };
      y += size(o).h + metrics.rowGap;
    }
  }

  // A la grilla, con la esquina de arriba a la izquierda en 0. Se redondea hacia arriba lo que separa cajas: una caja
  // nunca se acerca más que `rowGap` a la de abajo por el redondeo.
  const minX = Math.min(...Object.values(positions).map((p) => p.x));
  const minY = Math.min(...Object.values(positions).map((p) => p.y));
  for (const key of Object.keys(positions)) {
    const p = positions[key]!;
    positions[key] = { x: snap(p.x - minX), y: snap(p.y - minY) };
  }
  return positions;
}
