import type { Node } from '../schema/walkie-graph';

/** Paleta del lienzo (los tokens CSS viven en `theme/global.css`; aquí lo que React Flow necesita en JS). */
export const palette = {
  ink: '#2b241d',
  paper: '#f6efe3',
  grid: '#d8c7a6',
  accent: '#a9581a',
  ok: '#4f7a45',
  warn: '#b7861f',
} as const;

/** Color de borde por tipo de nodo. */
/** Color semántico por tipo: se conserva la familia de siempre, afinada para convivir con la arena. */
export const nodeColors: Record<Node['type'], string> = {
  actor: '#7d55b8',
  screen: '#3a70c0',
  rule: '#b58316',
  api: '#c4502b',
  service: '#3f8358',
  database: '#4d6485',
  resource: '#2f7f86',
  ref: '#857867',
  portal: '#ad3f7c',
};

/** Tamaño de la grilla en px; todo se alinea a múltiplos de este valor. */
export const GRID = 8;
