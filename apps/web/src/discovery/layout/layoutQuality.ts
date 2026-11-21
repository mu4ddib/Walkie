/**
 * Medidas de legibilidad de una distribución de lienzo (spec walkie-live-documentacion, parte 3). Funciones puras para
 * comparar el lienzo inicial antes y después: cruces entre conexiones, largo de las conexiones, cajas y etiquetas
 * encimadas, tamaño total y el zoom con que «Ver todo» lo muestra en el área libre del editor.
 *
 * Aproximaciones (las mismas para las dos distribuciones que se comparan): cada caja mide lo que da `size` (por
 * defecto lo nominal del lienzo, 184 × 72); una conexión es el segmento entre los centros de sus cajas; su etiqueta, una caja de 140 × 22 en la
 * mitad del segmento.
 */
export type Point = { x: number; y: number };
export type Edge = { from: string; to: string };

export const BOX = { w: 184, h: 72 };
const LABEL = { w: 140, h: 22 };

/** Área libre del editor para «Ver todo» en una ventana: sin la barra (52), la barra de herramientas (72) ni el inspector (352). */
export function freeArea(width: number, height: number, inspector = true): { w: number; h: number } {
  return { w: width - 72 - (inspector && width > 900 ? 352 : 0) - 48, h: height - 52 - 48 };
}

export interface LayoutQuality {
  crossings: number;
  meanEdgeLength: number;
  maxEdgeLength: number;
  boxOverlaps: number;
  labelOverBox: number;
  labelOverLabel: number;
  width: number;
  height: number;
  /** Zoom con que todo entra en el área libre de 1280 × 800 con el inspector abierto (tope 1). */
  fitZoom1280: number;
  fitZoom1440: number;
  fitZoom1920: number;
}

type Rect = { x: number; y: number; w: number; h: number };

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Líneas de un texto partido por palabras; una palabra más larga que la línea ocupa las que necesite. */
export function lines(text: string, perLine: number): number {
  let count = 1;
  let used = 0;
  for (const word of text.split(' ').filter(Boolean)) {
    if (used > 0 && used + 1 + word.length <= perLine) {
      used += 1 + word.length;
      continue;
    }
    if (used > 0) count++;
    count += Math.floor((word.length - 1) / perLine);
    used = ((word.length - 1) % perLine) + 1;
  }
  return count;
}

/**
 * Tamaño con que el navegador dibuja una caja (`.pixel-node`), medido en Chromium: de 184 a 264 px de ancho según el
 * texto más largo; de alto, el título, la línea de método y ruta (`http`) y la descripción (hasta 2 líneas) partidos
 * por palabras. Conservador: nunca menor que lo medido. Es la misma fórmula que valida la API
 * (`BoxSizes.Estimate` en `Walkie.Modules.Discovery`): lo que la distribución reserva, la API lo acepta.
 */
export function boxSize(title: string, http?: string, description?: string, extra = 0): { w: number; h: number } {
  const longest = Math.max(title.length * 8.4, (description?.length ?? 0) * 6.3, (http?.length ?? 0) * 7.6);
  const w = Math.min(264, Math.max(184, Math.ceil((longest + 12) / 8) * 8));
  let h = 50 + 19 * lines(title, 29);
  if (http) h += 20 * lines(http, 30);
  if (description) h += 18 * Math.min(2, lines(description, 40));
  return { w, h: h + extra };
}

type SavedNode = {
  type?: string;
  title?: string;
  description?: string;
  http?: { method?: string; path?: string };
  inputs?: unknown[];
  expression?: string;
  assetId?: string;
};

/**
 * Tamaño de una caja de un lienzo guardado, como la mide la API (`BoxSizes.OfSaved`): lo explícito de su `layout`
 * manda (un grupo, el ancho de un módulo) y lo que falta sale de su contenido (un `ref`, con su título como firma).
 */
export function savedBoxSize(node: SavedNode | undefined, box: { w?: number; h?: number }): { w: number; h: number } {
  let size = { w: 184, h: 72 };
  if (node) {
    const http = node.http ? `${node.http.method ?? ''} ${node.http.path ?? ''}`.trim() : node.type === 'ref' ? node.title : undefined;
    let extra = 0;
    if (Array.isArray(node.inputs)) extra += 16 + 16 * Math.min(6, node.inputs.length);
    if (node.expression) extra += 16 * Math.min(4, node.expression.split('\n').length);
    if (node.assetId) extra += 112;
    size = boxSize(node.title ?? '', http, node.description, extra);
  }
  return { w: box.w ?? size.w, h: box.h ?? size.h };
}

/** Tamaño de una caja del borrador de Walkie Live, como la dibujará el lienzo (y como la valida la API). */
export function draftBoxSize(node: { type: string; title: string; route?: string }): { w: number; h: number } {
  switch (node.type) {
    case 'screen':
      return boxSize(node.title, undefined, node.route !== undefined ? `Ruta: ${node.route}` : undefined);
    case 'ref':
      return boxSize(node.title, node.title);
    case 'portal':
      return boxSize(`→ ${node.title}`);
    case 'module':
      return boxSize(node.title, undefined, undefined, 48);
    default:
      return boxSize(node.title);
  }
}

/** Si los segmentos ab y cd se cruzan (sin contar extremos compartidos). */
function cross(a: Point, b: Point, c: Point, d: Point): boolean {
  const o = (p: Point, q: Point, r: Point) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

export function measure(
  layout: Record<string, Point>,
  edges: readonly Edge[],
  size: (key: string) => { w: number; h: number } = () => BOX,
): LayoutQuality {
  const keys = Object.keys(layout);
  const rect = (k: string): Rect => ({ ...layout[k]!, ...size(k) });
  const center = (k: string): Point => {
    const r = rect(k);
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  };
  const segments = edges
    .filter((e) => layout[e.from] && layout[e.to] && e.from !== e.to)
    .map((e) => ({ ...e, a: center(e.from), b: center(e.to) }));
  let crossings = 0;
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const s = segments[i]!;
      const t = segments[j]!;
      if (s.from === t.from || s.from === t.to || s.to === t.from || s.to === t.to) continue;
      if (cross(s.a, s.b, t.a, t.b)) crossings++;
    }
  }
  const lengths = segments.map((s) => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y));
  const boxes: Rect[] = keys.map(rect);
  let boxOverlaps = 0;
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (overlaps(boxes[i]!, boxes[j]!)) boxOverlaps++;
  const labels: Rect[] = segments.map((s) => ({ x: (s.a.x + s.b.x) / 2 - LABEL.w / 2, y: (s.a.y + s.b.y) / 2 - LABEL.h / 2, ...LABEL }));
  let labelOverBox = 0;
  let labelOverLabel = 0;
  labels.forEach((l, i) => {
    const s = segments[i]!;
    if (keys.some((k) => k !== s.from && k !== s.to && overlaps(l, rect(k)))) labelOverBox++;
    for (let j = i + 1; j < labels.length; j++) if (overlaps(l, labels[j]!)) labelOverLabel++;
  });
  const width = keys.length ? Math.max(...boxes.map((b) => b.x + b.w)) - Math.min(...boxes.map((b) => b.x)) : 0;
  const height = keys.length ? Math.max(...boxes.map((b) => b.y + b.h)) - Math.min(...boxes.map((b) => b.y)) : 0;
  const zoom = (w: number, h: number) => {
    const area = freeArea(w, h);
    return Math.min(1, area.w / Math.max(width, 1), area.h / Math.max(height, 1));
  };
  return {
    crossings,
    meanEdgeLength: lengths.length ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length) : 0,
    maxEdgeLength: lengths.length ? Math.round(Math.max(...lengths)) : 0,
    boxOverlaps,
    labelOverBox,
    labelOverLabel,
    width: Math.round(width),
    height: Math.round(height),
    fitZoom1280: Math.round(zoom(1280, 800) * 100) / 100,
    fitZoom1440: Math.round(zoom(1440, 900) * 100) / 100,
    fitZoom1920: Math.round(zoom(1920, 1080) * 100) / 100,
  };
}
