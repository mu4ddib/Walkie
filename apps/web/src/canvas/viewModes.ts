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
