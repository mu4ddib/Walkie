import { v7 as uuidv7 } from 'uuid';
import type { DiscoveryApplyResult, DiscoveryOperation } from '../api/client';
import { autoLayout, catalogKey, type LayoutMetrics } from '../map/mapLayout';

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
};

const snap = (v: number) => Math.round(v / 8) * 8 || 0;

/**
 * Ids (UUID v7 del cliente, como todo id de nodo, conexión e interfaz) y posiciones del lienzo inicial, con la misma
 * distribución que el mapa de la app (`autoLayout`): las pantallas en columnas siguiendo la navegación hacia rutas más
 * profundas (la lista a la izquierda de su detalle) y, en una fila debajo, las APIs y módulos que llaman, cada uno bajo las pantallas que lo usan. Un módulo
 * no tiene pantallas: sus APIs van en una columna. Determinista: el mismo borrador da las mismas posiciones.
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
  const layout: CanvasInput['layout'] = {};
  if (screens.length === 0) {
    const auto = autoLayout(others, [], {}, CANVAS_METRICS);
    for (const key of others) layout[key] = { x: snap(auto[key]!.x), y: snap(auto[key]!.y) };
  } else {
    // Para ubicar, la navegación va de la ruta menos profunda a la más profunda (la lista antes que su detalle): un
    // enlace de vuelta (detalle → lista) se dibuja igual, pero no apila las dos en una columna por el ciclo.
    const depth = new Map(draft.nodes.map((n) => [n.key, (n.route ?? '').split('/').filter(Boolean).length]));
    const forward = (from: string, to: string) => depth.get(from)! < depth.get(to)! || (depth.get(from) === depth.get(to) && from < to);
    const navigation = draft.edges
      .filter((e) => e.kind === 'navigation' && forward(e.from, e.to))
      .map((e) => ({ from: e.from, to: e.to }));
    const users: Record<string, string[]> = Object.fromEntries(others.map((k) => [k, [] as string[]]));
    for (const e of draft.edges) if (e.kind === 'request' && users[e.to]) users[e.to]!.push(e.from);
    const auto = autoLayout(screens, navigation, users, CANVAS_METRICS);
    for (const key of screens) layout[key] = { x: snap(auto[key]!.x), y: snap(auto[key]!.y) };
    for (const key of others) {
      const p = auto[catalogKey(key)]!;
      layout[key] = { x: snap(p.x), y: snap(p.y) };
    }
  }

  return { nodes, edges, interfaces, layout };
}
