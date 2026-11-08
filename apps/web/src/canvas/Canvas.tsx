import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
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
import { TourPlayer } from '../tours/TourPlayer';
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
export function Canvas({ store, catalog = NO_CATALOG }: { store: StoreApi<GraphStore>; catalog?: CanvasCatalog }) {
  return (
    <GraphStoreProvider store={store}>
      <CatalogContext.Provider value={catalog}>
        <ReactFlowProvider>
          <CanvasInner catalog={catalog} />
        </ReactFlowProvider>
      </CatalogContext.Provider>
    </GraphStoreProvider>
  );
}

function CanvasInner({ catalog }: { catalog: CanvasCatalog }) {
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
  // Modo tour (spec modo-tour): qué tour y en qué paso; el lienzo queda de solo lectura.
  const [playing, setPlaying] = useState<{ tourId: string; step: number } | null>(null);
  const tours = useGraphStore((s) => s.tours);
  const tourNodeId = playing ? tours[playing.tourId]?.steps[playing.step]?.nodeId : undefined;
  const flowRef = useRef<HTMLDivElement>(null);
  const [pane, setPane] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = flowRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setPane({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const startTour = useCallback((tourId: string) => {
    setSelectedNodes(new Set());
    setSelectedEdges(new Set());
    setEditingId(null);
    setPlaying({ tourId, step: 0 });
  }, []);
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
        className: playing ? (node.id === tourNodeId ? 'tour-current' : 'tour-dim') : undefined,
      })),
    [graphNodes, layout, selectedNodes, editingId, stopEditing, measured, playing, tourNodeId],
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
    <div className={playing ? 'canvas canvas-touring' : 'canvas'}>
      <Palette onAdd={(type) => addAtCenter((p) => addNode(type, p))} catalog={paletteCatalog} />
      <div
        ref={flowRef}
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
            if (playing) return;
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
          deleteKeyCode={playing ? null : ['Delete', 'Backspace']}
          nodesDraggable={!playing}
          nodesConnectable={!playing}
          elementsSelectable={!playing}
          fitView={fitOnMount}
          defaultViewport={{ x: 0, y: 0, zoom: 1 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={GRID * 3} color={palette.grid} />
          <Controls showInteractive={false} />
        </ReactFlow>
        {playing && (
          <TourPlayer
            tourId={playing.tourId}
            step={playing.step}
            sizes={measured}
            pane={pane}
            onStep={(step) => setPlaying((p) => p && { ...p, step })}
            onExit={() => setPlaying(null)}
          />
        )}
      </div>
      <PropertiesPanel
        nodeId={panelNodeId}
        edgeId={panelEdgeId}
        tours={{ openTourId, onOpen: setOpenTourId, onPlay: startTour }}
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
