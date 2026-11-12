import type { NodeType } from '../store/graphStore';

/** Tipo MIME del arrastre desde la paleta al lienzo. */
export const PALETTE_MIME = 'application/x-walkie-node';
/** Tipo MIME del arrastre de un elemento del catálogo (crea un `ref`); el dato es su id. */
export const PALETTE_REF_MIME = 'application/x-walkie-ref';

/** Tipo MIME del arrastre de un subtipo de recurso (spec nodos-de-infraestructura); el dato es el subtipo. */
export const PALETTE_RESOURCE_MIME = 'application/x-walkie-resource';
/** Tecla que abre la lista de recursos (después de los tipos 1–7). */
export const RESOURCE_KEY = '8';

/** Tipos de la paleta. Los `ref` salen de la sección "Catálogo". */
export const PALETTE_TYPES: NodeType[] = ['actor', 'screen', 'rule', 'api', 'service', 'database', 'portal'];
