import type { Node } from '../schema/walkie-graph';
import { resourceLabel } from './resourceMeta';

/** Etiqueta e ícono (glifo ASCII, sin sprites todavía) por tipo. */
export const NODE_LABELS: Record<Node['type'], { label: string; glyph: string }> = {
  screen: { label: 'Pantalla', glyph: '[ ]' },
  api: { label: 'API', glyph: '</>' },
  database: { label: 'Base de datos', glyph: '(=)' },
  actor: { label: 'Actor', glyph: 'o/' },
  rule: { label: 'Regla', glyph: '§' },
  service: { label: 'Servicio', glyph: '{ }' },
  // Recurso de infraestructura (spec nodos-de-infraestructura); cada subtipo tendrá su glifo (tarea 2).
  resource: { label: 'Recurso', glyph: '<#>' },
  ref: { label: 'Referencia', glyph: '->' },
  portal: { label: 'Portal', glyph: '@' },
  // Referencia a un módulo compartido (spec modulos-compartidos).
  module: { label: 'Módulo', glyph: '[≡]' },
};

/** Una regla en modo decisión (bifurcación con salidas): mismo tipo y color, otro encabezado. */
export const DECISION_LABEL = { label: 'Decisión', glyph: '◇' } as const;

/** Etiqueta y glifo de un nodo concreto (una regla puede ser una decisión; un recurso dice su subtipo). */
export function nodeLabel(node: Pick<Node, 'type' | 'mode' | 'resource'>): { label: string; glyph: string } {
  if (node.type === 'resource') return resourceLabel(node.resource);
  return node.type === 'rule' && node.mode === 'decision' ? DECISION_LABEL : NODE_LABELS[node.type];
}
