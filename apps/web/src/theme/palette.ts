import type { Node } from '../schema/walkie-graph';

/** Paleta pixel v0. Colores planos: sin gradientes ni sombras difusas. */
export const palette = {
  ink: '#1b1c33',
  paper: '#f4f0e6',
  grid: '#d9d2c1',
  accent: '#e85d3f',
  ok: '#3f8f5a',
  warn: '#d9a32b',
} as const;

/** Color de borde por tipo de nodo. */
export const nodeColors: Record<Node['type'], string> = {
  actor: '#8f5ad9',
  screen: '#3f7fd9',
  rule: '#d9a32b',
  api: '#e85d3f',
  service: '#3f8f5a',
  database: '#5a6b8f',
  ref: '#7a7a7a',
  portal: '#c2409a',
};

/** Tamaño de la grilla en px; todo se alinea a múltiplos de este valor. */
export const GRID = 8;
