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

/**
 * Tamaño de una caja del lienzo según su título, medido en el navegador (`.pixel-node`: de 184 a 264 px de ancho;
 * 89 px de alto con título y método/ruta en una línea; cada línea de más al partirse, unos 20 px). Se redondea hacia
 * arriba para no quedarse corto: es lo que reserva la distribución.
 */
export function boxSize(title: string): { w: number; h: number } {
  const w = Math.min(264, Math.max(184, Math.ceil((8 + title.length * 8.4) / 8) * 8));
  const extra = title.length <= 29 ? 0 : Math.ceil((title.length - 29) / 2.5);
  return { w, h: 96 + extra * 20 };
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
