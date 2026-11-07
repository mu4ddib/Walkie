import type { NodeTypes } from '@xyflow/react';
import { PixelNode } from './PixelNode';

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
  ref: PixelNode,
  portal: PixelNode,
};
