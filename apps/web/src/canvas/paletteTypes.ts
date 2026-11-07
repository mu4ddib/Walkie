import type { NodeType } from '../store/graphStore';

/** Tipo MIME del arrastre desde la paleta al lienzo. */
export const PALETTE_MIME = 'application/x-walkie-node';

/** Tipos disponibles en la fase 1 (spec lienzo-base). */
export const PALETTE_TYPES: NodeType[] = ['screen', 'api', 'database'];
