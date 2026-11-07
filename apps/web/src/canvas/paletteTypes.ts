import type { NodeType } from '../store/graphStore';

/** Tipo MIME del arrastre desde la paleta al lienzo. */
export const PALETTE_MIME = 'application/x-walkie-node';
/** Tipo MIME del arrastre de un elemento del catálogo (crea un `ref`); el dato es su id. */
export const PALETTE_REF_MIME = 'application/x-walkie-ref';

/** Tipos de la paleta (lienzo-base + panel-propiedades). `ref` y `portal` llegan con el catálogo. */
export const PALETTE_TYPES: NodeType[] = ['actor', 'screen', 'rule', 'api', 'service', 'database'];
