import type { EdgeKind } from '../store/graphStore';

/** Tipos que el usuario puede elegir (spec, criterio 5). `uses` solo aparece como valor por defecto. */
export const SELECTABLE_KINDS: EdgeKind[] = ['navigation', 'request', 'response', 'reads', 'writes'];

export const KIND_LABELS: Record<EdgeKind, string> = {
  navigation: 'navega',
  request: 'llama',
  response: 'responde',
  reads: 'lee',
  writes: 'escribe',
  uses: 'usa',
};
