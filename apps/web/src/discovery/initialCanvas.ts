import { v7 as uuidv7 } from 'uuid';
import type { DiscoveryApplyResult, DiscoveryOperation } from '../api/client';
import { type LayoutMetrics } from '../map/mapLayout';
import { layeredLayout } from './layout/layered';
import { boxSize } from './layout/layoutQuality';

/** El borrador del lienzo inicial que devuelve la vista previa de un módulo o una feature (`created[].canvas`). */
export type CanvasDraft = NonNullable<DiscoveryApplyResult['created'][number]['canvas']>;

/** Lo que la persona manda para crearlo: un id por clave y una posición por caja (`operation.canvas`). */
export type CanvasInput = NonNullable<DiscoveryOperation['canvas']>;

/**
 * Medidas del lienzo inicial: las cajas de `Canvas.tsx` miden 184 × 72 y crecen con su contenido; se dejan holgadas y en
 * múltiplos de la grilla de 8 px, así ninguna se encima con la de al lado aunque crezca (la API rechaza cajas encimadas).
 */
export const CANVAS_METRICS: LayoutMetrics = {
  main: { w: 232, h: 104 },
  below: { w: 232, h: 104 },
  columnGap: 96,
  rowGap: 56,
  belowGap: 112,
  belowSpacing: 32,
  belowPerRow: 4,
};

const snap = (v: number) => Math.round(v / 8) * 8 || 0;

/**
 * Ids (UUID v7 del cliente, como todo id de nodo, conexión e interfaz) y posiciones del lienzo inicial con la
 * distribución por capas (`layout/layered.ts`, spec walkie-live-documentacion): las pantallas de izquierda a derecha
 * siguiendo la navegación hacia rutas más profundas (la lista a la izquierda de su detalle) y cada API junto a quien
 * la llama (a su derecha, entre las dos pantallas que la comparten o, si son pocas, debajo). Un módulo no tiene
 * pantallas: sus APIs van en una grilla. Determinista: el mismo borrador da las mismas posiciones. Solo ubica un
 * lienzo nuevo: nunca reorganiza uno existente.
 * `previous` conserva los ids de una vista previa anterior del mismo borrador (así el reintento manda los mismos).
 */
export function planInitialCanvas(draft: CanvasDraft, previous?: CanvasInput): CanvasInput {
  const id = (map: Record<string, string> | undefined, key: string) => map?.[key] ?? uuidv7();
  const nodes = Object.fromEntries(draft.nodes.map((n) => [n.key, id(previous?.nodes, n.key)]));
  const edges = Object.fromEntries(draft.edges.map((e) => [e.key, id(previous?.edges, e.key)]));
  const interfaces = Object.fromEntries(draft.interfaces.map((i) => [i.key, id(previous?.interfaces, i.key)]));

  const order = (keys: string[]) => [...keys].sort((a, b) => a.localeCompare(b));
  const screens = order(draft.nodes.filter((n) => n.type === 'screen').map((n) => n.key));
  const others = order(draft.nodes.filter((n) => n.type !== 'screen').map((n) => n.key));
  // Para ubicar, la navegación va de la ruta menos profunda a la más profunda (la lista antes que su detalle): un
  // enlace de vuelta (detalle → lista) se dibuja igual, pero no apila las dos en una columna por el ciclo.
  const depth = new Map(draft.nodes.map((n) => [n.key, (n.route ?? '').split('/').filter(Boolean).length]));
  const forward = (from: string, to: string) => depth.get(from)! < depth.get(to)! || (depth.get(from) === depth.get(to) && from < to);
  const navigation = draft.edges.filter((e) => e.kind === 'navigation' && forward(e.from, e.to));
  const calls = draft.edges.filter((e) => e.kind !== 'navigation');
  const titles = new Map(draft.nodes.map((n) => [n.key, n.title]));
  const layout: CanvasInput['layout'] = layeredLayout(screens, others, navigation, calls, undefined, (k) => boxSize(titles.get(k) ?? ''));

  return { nodes, edges, interfaces, layout };
}

type Box = { x: number; y: number; w?: number; h?: number };

/**
 * Ids y posiciones de lo que se agrega a un lienzo existente (ADR-0018): solo las cajas nuevas (las que el borrador
 * no reutiliza), en una columna libre a la derecha de todo lo que ya está, alineada con su borde de arriba. Nada de lo
 * que hay se mueve. `previous` conserva los ids de una vista previa anterior (un reintento manda los mismos).
 */
export function planAttachCanvas(draft: CanvasDraft, existing: Record<string, Box>, previous?: CanvasInput): CanvasInput {
  const id = (map: Record<string, string> | undefined, key: string) => map?.[key] ?? uuidv7();
  const added = draft.nodes.filter((n) => !n.existing);
  const order = ['screen', 'ref', 'module', 'portal'];
  const sorted = [...added].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || a.key.localeCompare(b.key));
  const boxes = Object.values(existing);
  const right = boxes.length === 0 ? 0 : Math.max(...boxes.map((b) => b.x + (b.w ?? 184)));
  const top = boxes.length === 0 ? 0 : Math.min(...boxes.map((b) => b.y));
  const x = snap(right + CANVAS_METRICS.columnGap);
  const layout: CanvasInput['layout'] = {};
  sorted.forEach((n, i) => {
    layout[n.key] = { x, y: snap(top + i * (CANVAS_METRICS.main.h + CANVAS_METRICS.rowGap)) };
  });
  return {
    nodes: Object.fromEntries(added.map((n) => [n.key, id(previous?.nodes, n.key)])),
    edges: Object.fromEntries(draft.edges.map((e) => [e.key, id(previous?.edges, e.key)])),
    interfaces: {},
    layout,
  };
}
