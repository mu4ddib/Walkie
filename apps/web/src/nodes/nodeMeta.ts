import type { Node } from '../schema/walkie-graph';

/** Etiqueta e ícono (glifo ASCII, sin sprites todavía) por tipo. */
export const NODE_LABELS: Record<Node['type'], { label: string; glyph: string }> = {
  screen: { label: 'Pantalla', glyph: '[ ]' },
  api: { label: 'API', glyph: '</>' },
  database: { label: 'Base de datos', glyph: '(=)' },
  actor: { label: 'Actor', glyph: 'o/' },
  rule: { label: 'Regla', glyph: '§' },
  service: { label: 'Servicio', glyph: '{ }' },
  ref: { label: 'Referencia', glyph: '->' },
  portal: { label: 'Portal', glyph: '@' },
};
