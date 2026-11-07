import { useCallback, useMemo, useState, type DragEvent } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { StoreApi } from 'zustand/vanilla';
import { edgeTypes } from '../edges/edgeTypes';
import type { WalkieFlowEdge } from '../edges/KindEdge';
import { nodeTypes } from '../nodes/nodeTypes';
import type { WalkieFlowNode } from '../nodes/PixelNode';
import type { GraphStore, NodeType } from '../store/graphStore';
import { GraphStoreProvider } from '../store/GraphStoreProvider';
import { useGraphStore } from '../store/useGraphStore';
import { GRID, palette } from '../theme/palette';
import { Palette } from './Palette';
import { PALETTE_MIME, PALETTE_TYPES } from './paletteTypes';
import './canvas.css';

/** Lienzo de una feature. Todo cambio del grafo pasa por las acciones del store. */
export function Canvas({ store }: { store: StoreApi<GraphStore> }) {
  return (
    <GraphStoreProvider store={store}>
      <ReactFlowProvider>
        <CanvasInner />
      </ReactFlowProvider>
    </GraphStoreProvider>
  );
}

function CanvasInner() {
  const graphNodes = useGraphStore((s) => s.nodes);
  const layout = useGraphStore((s) => s.layout);
  const graphEdges = useGraphStore((s) => s.edges);
  const { addNode, moveNode, removeNode, connect, removeEdge } = useGraphStore((s) => s);
  const { screenToFlowPosition } = useReactFlow();
  // fitView solo si el lienzo ya trae nodos al montarse: con un lienzo vacío, React Flow
  // ajustaría el zoom al aparecer el primer nodo y los siguientes caerían en otro lugar.
  const [fitOnMount] = useState(() => Object.keys(graphNodes).length > 0);

  // La selección es estado de UI, no del grafo: vive aquí y no en el store.
  const [selectedNodes, setSelectedNodes] = useState<ReadonlySet<string>>(new Set());
  const [selectedEdges, setSelectedEdges] = useState<ReadonlySet<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  // Medidas que reporta React Flow. Si no se devuelven en `measured`, al reconstruir los nodos
  // React Flow los oculta un instante para medirlos otra vez y se pierden clics (ej. doble clic).
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({});
  const stopEditing = useCallback(() => setEditingId(null), []);

  const nodes = useMemo<WalkieFlowNode[]>(
    () =>
      Object.values(graphNodes).map((node) => ({
        id: node.id,
        type: node.type,
        position: layout[node.id] ?? { x: 0, y: 0 },
        data: { node, editing: editingId === node.id, onEditDone: stopEditing },
        selected: selectedNodes.has(node.id),
        measured: measured[node.id],
      })),
    [graphNodes, layout, selectedNodes, editingId, stopEditing, measured],
  );

  const edges = useMemo<WalkieFlowEdge[]>(
    () =>
      Object.values(graphEdges).map((edge) => ({
        id: edge.id,
        source: edge.from,
        target: edge.to,
        type: 'kind',
        data: { kind: edge.kind },
        selected: selectedEdges.has(edge.id),
      })),
    [graphEdges, selectedEdges],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<WalkieFlowNode>[]) => {
      for (const change of changes) {
        if (change.type === 'position' && change.position) moveNode(change.id, change.position);
        if (change.type === 'remove') removeNode(change.id);
        if (change.type === 'select') setSelectedNodes((s) => toggle(s, change.id, change.selected));
        if (change.type === 'dimensions' && change.dimensions) {
          const { width, height } = change.dimensions;
          setMeasured((m) =>
            m[change.id]?.width === width && m[change.id]?.height === height ? m : { ...m, [change.id]: { width, height } },
          );
        }
      }
    },
    [moveNode, removeNode],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<WalkieFlowEdge>[]) => {
      for (const change of changes) {
        if (change.type === 'remove') removeEdge(change.id);
        if (change.type === 'select') setSelectedEdges((s) => toggle(s, change.id, change.selected));
      }
    },
    [removeEdge],
  );

  const onConnect = useCallback((c: Connection) => void connect(c.source, c.target), [connect]);

  const addAt = useCallback(
    (type: NodeType, clientX: number, clientY: number) => {
      const id = addNode(type, screenToFlowPosition({ x: clientX, y: clientY }));
      setSelectedNodes(new Set([id]));
    },
    [addNode, screenToFlowPosition],
  );

  function onDrop(event: DragEvent) {
    event.preventDefault();
    const type = event.dataTransfer.getData(PALETTE_MIME) as NodeType;
    if (PALETTE_TYPES.includes(type)) addAt(type, event.clientX, event.clientY);
  }

  function onPaletteClick(type: NodeType) {
    const pane = document.querySelector('.canvas-flow')?.getBoundingClientRect();
    addAt(type, pane ? pane.left + pane.width / 2 : 0, pane ? pane.top + pane.height / 2 : 0);
  }

  return (
    <div className="canvas">
      <Palette onAdd={onPaletteClick} />
      <div
        className="canvas-flow"
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }}
        onDrop={onDrop}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDoubleClick={(_, node) => setEditingId(node.id)}
          zoomOnDoubleClick={false}
          connectOnClick={false}
          snapToGrid
          snapGrid={[GRID, GRID]}
          deleteKeyCode={['Delete', 'Backspace']}
          fitView={fitOnMount}
          defaultViewport={{ x: 0, y: 0, zoom: 1 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={GRID * 3} color={palette.grid} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}

function toggle(set: ReadonlySet<string>, id: string, on: boolean): ReadonlySet<string> {
  if (set.has(id) === on) return set;
  const next = new Set(set);
  if (on) next.add(id);
  else next.delete(id);
  return next;
}
