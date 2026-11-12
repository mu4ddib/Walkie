import type { NodeTypes } from '@xyflow/react';
import { GroupNode } from './GroupNode';
import { PixelNode } from './PixelNode';
import { StickyNoteNode } from './StickyNoteNode';

/**
 * Un componente por tipo de nodo (apps/web/CLAUDE.md). En la fase 1 todos comparten `PixelNode`;
 * cuando un tipo necesite contenido propio (inputs, request/response), se separa aquí.
 */
export const nodeTypes: NodeTypes = {
  screen: PixelNode,
  api: PixelNode,
  database: PixelNode,
  actor: PixelNode,
  rule: PixelNode,
  service: PixelNode,
  resource: PixelNode,
  ref: PixelNode,
  portal: PixelNode,
  // Grupos de infraestructura (no son nodos del grafo: viven en `groups`).
  infraGroup: GroupNode,
  // Notas adhesivas (anotaciones: viven en `stickyNotes`).
  stickyNote: StickyNoteNode,
};
