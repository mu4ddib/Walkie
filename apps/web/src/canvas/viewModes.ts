/**
 * Modos de presentación del lienzo (spec walkie-live-documentacion, parte 3). Cambian solo lo que se dibuja: nunca el
 * grafo, las posiciones ni lo guardado.
 *
 * - `summary` (Resumen funcional): pantallas, reglas, actores, portales y módulos con su navegación; lo técnico (APIs,
 *   servicios, bases y recursos, también como componentes) se oculta y cada caja dice a cuántas cosas técnicas llama.
 * - `interactions` (Explorar interacciones): todo a la vista y sin etiquetas; al elegir una caja o una conexión se
 *   destaca ella con sus vecinas y sus conexiones (con etiqueta) y se atenúa el resto.
 * - `full` (Arquitectura completa): todo, como siempre.
 */
import type { Edge, Node } from '../schema/walkie-graph';
import { CATALOG_NODE_TYPES, type NodeType } from '../store/graphStore';

export type ViewMode = 'summary' | 'interactions' | 'full';

export const VIEW_MODE_OPTIONS: readonly { id: ViewMode; label: string; tip: string }[] = [
  { id: 'summary', label: 'Resumen', tip: 'Resumen funcional: pantallas y navegación; lo técnico se cuenta en cada caja' },
  { id: 'interactions', label: 'Interacciones', tip: 'Explorar interacciones: elige una caja para ver con qué se relaciona' },
  { id: 'full', label: 'Completa', tip: 'Arquitectura completa: todo, con sus etiquetas' },
];

const TECHNICAL: ReadonlySet<NodeType> = new Set(CATALOG_NODE_TYPES);

/** Cajas que el resumen funcional oculta (`typeOf` da el tipo efectivo: el de su elemento si es un componente). */
export function summaryHidden(nodes: Record<string, Node>, typeOf: (node: Node) => NodeType): Set<string> {
  return new Set(Object.values(nodes).filter((n) => TECHNICAL.has(typeOf(n))).map((n) => n.id));
}

/** A cuántas cajas ocultas llega cada caja visible (en el resumen: «llama a 5»). */
export function hiddenCalls(edges: Record<string, Edge>, hidden: ReadonlySet<string>): Record<string, number> {
  const targets: Record<string, Set<string>> = {};
  for (const e of Object.values(edges)) {
    if (e.kind === 'response') continue;
    if (hidden.has(e.to) && !hidden.has(e.from)) (targets[e.from] ??= new Set()).add(e.to);
  }
  return Object.fromEntries(Object.entries(targets).map(([id, set]) => [id, set.size]));
}

/** Lo que se destaca al explorar: lo elegido, sus vecinas y las conexiones que las unen. Sin selección, nada. */
export function focusOf(
  edges: Record<string, Edge>,
  selectedNodes: ReadonlySet<string>,
  selectedEdges: ReadonlySet<string>,
): { nodes: Set<string>; edges: Set<string> } | null {
  if (selectedNodes.size === 0 && selectedEdges.size === 0) return null;
  const nodes = new Set(selectedNodes);
  const lit = new Set<string>();
  for (const e of Object.values(edges)) {
    if (selectedEdges.has(e.id) || selectedNodes.has(e.from) || selectedNodes.has(e.to)) {
      lit.add(e.id);
      nodes.add(e.from);
      nodes.add(e.to);
    }
  }
  return { nodes, edges: lit };
}

type PlacedBox = { id: string; x: number; y: number; w: number; h: number };

/**
 * Posiciones de presentación del «Resumen» (spec walkie-live-documentacion, revisión final): las cajas visibles con
 * su orden documentado, sin los huecos que dejan las ocultas. Las cajas que comparten una franja vertical (se tocan
 * en x) forman una columna y las que comparten una horizontal, una fila; columnas y filas se juntan en su mismo orden
 * con `gap` entre ellas y cada caja conserva su lugar dentro de la suya. Así no se inventa otra distribución, no se
 * encima nada que no estuviera encimado y, al volver a «Completa», se usan otra vez las posiciones guardadas (esto
 * nunca se guarda).
 */
export function compactPositions(
  boxes: readonly PlacedBox[],
  gap: { x: number; y: number } = { x: 120, y: 72 },
): Record<string, { x: number; y: number }> {
  const along = (axis: 'x' | 'y') => {
    const size = axis === 'x' ? 'w' : 'h';
    const sorted = [...boxes].sort((a, b) => a[axis] - b[axis] || a.id.localeCompare(b.id));
    const shift = new Map<string, number>();
    let cursor = 0;
    let i = 0;
    while (i < sorted.length) {
      // Una franja: las cajas cuyos intervalos se tocan, en cadena.
      const start = sorted[i]![axis];
      let end = start + sorted[i]![size];
      let j = i + 1;
      while (j < sorted.length && sorted[j]![axis] < end) {
        end = Math.max(end, sorted[j]![axis] + sorted[j]![size]);
        j++;
      }
      for (let k = i; k < j; k++) shift.set(sorted[k]!.id, cursor - start);
      cursor += end - start + (axis === 'x' ? gap.x : gap.y);
      i = j;
    }
    return shift;
  };
  const dx = along('x');
  const dy = along('y');
  const snap = (v: number) => Math.round(v / 8) * 8 || 0;
  return Object.fromEntries(boxes.map((b) => [b.id, { x: snap(b.x + dx.get(b.id)!), y: snap(b.y + dy.get(b.id)!) }]));
}
