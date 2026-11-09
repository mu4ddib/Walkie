import type { EdgeKind } from '../store/graphStore';

/** Tipos que el usuario puede elegir (spec, criterio 5). `uses` solo aparece como valor por defecto. */
export const SELECTABLE_KINDS: EdgeKind[] = ['navigation', 'request', 'response', 'event', 'reads', 'writes'];

export const KIND_LABELS: Record<EdgeKind, string> = {
  navigation: 'navega',
  request: 'llama',
  response: 'responde',
  event: 'emite',
  reads: 'lee',
  writes: 'escribe',
  uses: 'usa',
};

/**
 * Trazo y punta por tipo (spec espacio-de-trabajo, criterio 22): solicitudes, respuestas, eventos y accesos a
 * datos se distinguen sin depender del color. La animación sigue el sentido de la conexión.
 */
export const KIND_STYLES: Record<EdgeKind, { marker: 'closed' | 'open' | 'none'; description: string }> = {
  navigation: { marker: 'open', description: 'línea continua fina, punta abierta' },
  request: { marker: 'closed', description: 'línea continua, punta cerrada' },
  response: { marker: 'open', description: 'línea discontinua, punta abierta' },
  event: { marker: 'closed', description: 'línea de raya y punto, punta cerrada' },
  reads: { marker: 'closed', description: 'línea punteada, punta cerrada' },
  writes: { marker: 'closed', description: 'línea gruesa, punta cerrada' },
  uses: { marker: 'none', description: 'línea continua clara, sin punta' },
};
