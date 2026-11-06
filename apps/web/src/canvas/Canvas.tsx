import { Background, BackgroundVariant, Controls, ReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { GRID, palette } from '../theme/palette';

/** Lienzo vacío de la feature. Los nodos llegan en la fase 1 (docs/features/lienzo-base). */
export function Canvas() {
  return (
    <ReactFlow nodes={[]} edges={[]} snapToGrid snapGrid={[GRID, GRID]} fitView proOptions={{ hideAttribution: true }}>
      <Background variant={BackgroundVariant.Dots} gap={GRID * 3} color={palette.grid} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
