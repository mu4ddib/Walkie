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
import type { CatalogItem } from '../api/client';
import { CatalogContext, effectiveType, portalTarget, type CanvasCatalog } from '../catalog/catalogContext';
import { edgeTypes } from '../edges/edgeTypes';
import type { WalkieFlowEdge } from '../edges/KindEdge';
import { nodeTypes } from '../nodes/nodeTypes';
import { PropertiesPanel } from '../panel/PropertiesPanel';
import type { WalkieFlowNode } from '../nodes/PixelNode';
import { defaultEdgeKind, type GraphStore, type NodeType, type Position } from '../store/graphStore';
import { GraphStoreProvider } from '../store/GraphStoreProvider';
import { useGraphStore } from '../store/useGraphStore';
import { GRID, palette } from '../theme/palette';
import { Palette } from './Palette';
import { PALETTE_MIME, PALETTE_REF_MIME, PALETTE_TYPES } from './paletteTypes';
import { useOpenFeature } from './useOpenFeature';
import './canvas.css';

const NO_CATALOG: CanvasCatalog = { appId: '', items: {} };

/**
 * Lienzo de una feature. Todo cambio del grafo pasa por las acciones del store. `catalog` es el catálogo
 * de la app: los nodos `ref` lo leen por contexto y la paleta lo ofrece para crear `ref`.
 */
export function Canvas({
  store,
  catalog = NO_CATALOG,
  onPlayTour,
}: {
  store: StoreApi<GraphStore>;
  catalog?: CanvasCatalog;
  /** "Ver tour" en la sección de tours del panel (modo tour). */
  onPlayTour?: (tourId: string) => void;
}) {
  return (
    <GraphStoreProvider store={store}>
      <CatalogContext.Provider value={catalog}>
        <ReactFlowProvider>
          <CanvasInner catalog={catalog} onPlay={onPlayTour} />
        </ReactFlowProvider>
      </CatalogContext.Provider>
    </GraphStoreProvider>
  );
}

function CanvasInner({ catalog, onPlay }: { catalog: CanvasCatalog; onPlay?: (tourId: string) => void }) {
  const graphNodes = useGraphStore((s) => s.nodes);
  const layout = useGraphStore((s) => s.layout);
  const graphEdges = useGraphStore((s) => s.edges);
  const { addNode, addRef, moveNode, removeNode, connect, removeEdge } = useGraphStore((s) => s);
  const { screenToFlowPosition } = useReactFlow();
  const openFeature = useOpenFeature();
  // fitView solo si el lienzo ya trae nodos al montarse: con un lienzo vacío, React Flow
  // ajustaría el zoom al aparecer el primer nodo y los siguientes caerían en otro lugar.
  const [fitOnMount] = useState(() => Object.keys(graphNodes).length > 0);

  // La selección es estado de UI, no del grafo: vive aquí y no en el store.
  const [selectedNodes, setSelectedNodes] = useState<ReadonlySet<string>>(new Set());
  const [selectedEdges, setSelectedEdges] = useState<ReadonlySet<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openTourId, setOpenTourId] = useState<string | null>(null);
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
        data: { kind: edge.kind, label: edge.label, when: edge.when },
        selected: selectedEdges.has(edge.id),
      })),
    [graphEdges, selectedEdges],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<WalkieFlowNode>[]) => {
      for (const change of changes) {
        if (change.type === 'position' && change.position) moveNode(change.id, change.position);
        if (change.type === 'remove') {
          removeNode(change.id);
          setSelectedNodes((s) => toggle(s, change.id, false));
        }
        if (change.type === 'select') setSelectedNodes((s) => toggle(s, change.id, change.selected));
        if (change.type === 'dimensions' && change.dimensions) {
          const { width, height } = change.dimensions;
          setMeasured((m) =>
            m[change.id]?.width === width && m[change.id]?.height === height
              ? m
              : { ...m, [change.id]: { width, height } },
          );
        }
      }
    },
    [moveNode, removeNode],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<WalkieFlowEdge>[]) => {
      for (const change of changes) {
        if (change.type === 'remove') {
          removeEdge(change.id);
          setSelectedEdges((s) => toggle(s, change.id, false));
        }
        if (change.type === 'select') setSelectedEdges((s) => toggle(s, change.id, change.selected));
      }
    },
    [removeEdge],
  );

  // Panel de propiedades: solo con un único elemento seleccionado (nodo o conexión). Se filtra por lo
  // que existe: React Flow no deselecciona lo que se borra (ni las conexiones que caen en cascada).
  const liveNodes = [...selectedNodes].filter((id) => graphNodes[id]);
  const liveEdges = [...selectedEdges].filter((id) => graphEdges[id]);
  const single = liveNodes.length + liveEdges.length === 1;
  const panelNodeId = single ? (liveNodes[0] ?? null) : null;
  const panelEdgeId = single ? (liveEdges[0] ?? null) : null;

  // Un `ref` conecta como su elemento del catálogo (spec catalogo, criterio 9).
  const onConnect = useCallback(
    (c: Connection) => {
      const source = graphNodes[c.source];
      const target = graphNodes[c.target];
      const kind =
        source && target
          ? defaultEdgeKind(effectiveType(source, catalog.items), effectiveType(target, catalog.items))
          : undefined;
      connect(c.source, c.target, kind);
    },
    [connect, graphNodes, catalog.items],
  );

  const addAt = useCallback(
    (create: (position: Position) => string, clientX: number, clientY: number) => {
      const id = create(screenToFlowPosition({ x: clientX, y: clientY }));
      setSelectedNodes(new Set([id]));
    },
    [screenToFlowPosition],
  );

  function onDrop(event: DragEvent) {
    event.preventDefault();
    const type = event.dataTransfer.getData(PALETTE_MIME) as NodeType;
    const item = catalog.items[event.dataTransfer.getData(PALETTE_REF_MIME)];
    if (PALETTE_TYPES.includes(type)) addAt((p) => addNode(type, p), event.clientX, event.clientY);
    else if (item) addAt((p) => addRef(item, p), event.clientX, event.clientY);
  }

  function addAtCenter(create: (position: Position) => string) {
    const pane = document.querySelector('.canvas-flow')?.getBoundingClientRect();
    addAt(create, pane ? pane.left + pane.width / 2 : 0, pane ? pane.top + pane.height / 2 : 0);
  }

  const paletteCatalog = catalog.appId
    ? {
        appId: catalog.appId,
        items: Object.values(catalog.items),
        onAddRef: (item: CatalogItem) => addAtCenter((p) => addRef(item, p)),
      }
    : undefined;

  return (
    <div className="canvas">
      <Palette onAdd={(type) => addAtCenter((p) => addNode(type, p))} catalog={paletteCatalog} />
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
          // El título de un `ref` se edita en el catálogo; el doble clic en un `portal` abre su destino.
          onNodeDoubleClick={(_, flowNode) => {
            const node = graphNodes[flowNode.id];
            if (!node || node.type === 'ref') return;
            if (node.type === 'portal') {
              const target = portalTarget(node, catalog.features);
              if (target) openFeature(target.id);
              return;
            }
            setEditingId(node.id);
          }}
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
      <PropertiesPanel
        nodeId={panelNodeId}
        edgeId={panelEdgeId}
        tours={{ openTourId, onOpen: setOpenTourId, onPlay }}
      />
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
