import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type FitViewOptions,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { StoreApi } from 'zustand/vanilla';
import type { CatalogItem, NewCatalogItem } from '../api/client';
import { CatalogContext, effectiveType, portalTarget, type CanvasCatalog } from '../catalog/catalogContext';
import { edgeTypes } from '../edges/edgeTypes';
import type { WalkieFlowEdge } from '../edges/KindEdge';
import { nodeTypes } from '../nodes/nodeTypes';
import { PropertiesPanel } from '../panel/PropertiesPanel';
import { SharedTours } from '../tours/SharedTours';
import { TourPlayer } from '../tours/TourPlayer';
import type { WalkieFlowNode } from '../nodes/PixelNode';
import { defaultEdgeKind, type GraphStore, type NodeType, type Position } from '../store/graphStore';
import { GraphStoreProvider } from '../store/GraphStoreProvider';
import { useGraphStore } from '../store/useGraphStore';
import { GRID, palette } from '../theme/palette';
import { Palette } from './Palette';
import { PALETTE_MIME, PALETTE_REF_MIME, PALETTE_TYPES } from './paletteTypes';
import { useOpenFeature } from './useOpenFeature';
import { getInspectorOpen, getSavedViewport, saveViewport, setInspectorOpen } from '../workspace/session';
import { OPEN_HELP_EVENT, isTyping } from './canvasShortcuts';
import { EmptyCanvasGuide } from './EmptyCanvasGuide';
import { ShortcutsDialog } from './ShortcutsDialog';
import { ZoomControls } from './ZoomControls';
import './canvas.css';

const NO_CATALOG: CanvasCatalog = { appId: '', items: {} };

/**
 * Lienzo de una feature. Todo cambio del grafo pasa por las acciones del store. `catalog` es el catálogo
 * de la app: los nodos `ref` lo leen por contexto y la paleta lo ofrece para crear `ref`. Con `catalog.share`
 * (vista de un enlace) queda de solo lectura: sin paleta ni panel, solo la lista de tours.
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
  const { screenToFlowPosition, zoomIn, zoomOut, fitView, getViewport } = useReactFlow();
  const openFeature = useOpenFeature();
  // La vista se recuerda por feature (spec espacio-de-trabajo, criterio 1). Sin vista guardada, fitView
  // solo si el lienzo ya trae nodos: con uno vacío, React Flow ajustaría el zoom al aparecer el primero
  // y los siguientes caerían en otro lugar.
  const [savedViewport] = useState(() => (catalog.featureId ? getSavedViewport(catalog.featureId) : null));
  const [fitOnMount] = useState(() => !savedViewport && Object.keys(graphNodes).length > 0);
  const [inspectorOpen, setInspectorOpenState] = useState(getInspectorOpen);
  const [helpOpen, setHelpOpen] = useState(false);
  const toggleInspector = useCallback(() => {
    setInspectorOpenState((open) => {
      setInspectorOpen(!open);
      return !open;
    });
  }, []);

  // La selección es estado de UI, no del grafo: vive aquí y no en el store.
  const [selectedNodes, setSelectedNodes] = useState<ReadonlySet<string>>(new Set());
  const [selectedEdges, setSelectedEdges] = useState<ReadonlySet<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openTourId, setOpenTourId] = useState<string | null>(null);
  // Modo tour (spec modo-tour): qué tour y en qué paso; el lienzo queda de solo lectura.
  const [playing, setPlaying] = useState<{ tourId: string; step: number } | null>(null);
  const tours = useGraphStore((s) => s.tours);
  const tourNodeId = playing ? tours[playing.tourId]?.steps[playing.step]?.nodeId : undefined;
  // Un enlace de solo lectura (spec enlace-solo-lectura, criterio 6) o el modo tour bloquean la edición.
  const readOnly = Boolean(catalog.share);
  const locked = readOnly || playing !== null;
  const empty = Object.keys(graphNodes).length === 0;
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

  // "Ver todo" deja libres la barra de herramientas y el inspector, que flotan sobre el lienzo.
  const fitPadding = useMemo(
    (): FitViewOptions['padding'] => {
      const docked = inspectorOpen && !catalog.share;
      // Debajo de 900 px el inspector es un panel inferior (canvas.css): ocupa alto, no ancho.
      const narrow = pane.width > 0 && pane.width < 900;
      return {
        top: '72px',
        bottom: docked && narrow ? `${Math.round(pane.height * 0.45) + 24}px` : '72px',
        left: '88px',
        right: docked && !narrow ? '376px' : '56px',
      };
    },
    [inspectorOpen, catalog.share, pane.width, pane.height],
  );

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
    if (locked) return;
    const type = event.dataTransfer.getData(PALETTE_MIME) as NodeType;
    const item = catalog.items[event.dataTransfer.getData(PALETTE_REF_MIME)];
    if (PALETTE_TYPES.includes(type)) addAt((p) => addNode(type, p), event.clientX, event.clientY);
    else if (item) addAt((p) => addRef(item, p), event.clientX, event.clientY);
  }

  /** Agrega en el centro visible; cada alta seguida se corre un poco para no apilar cajas. */
  function addAtCenter(create: (position: Position) => string) {
    const pane = flowRef.current?.getBoundingClientRect();
    const step = (Object.keys(graphNodes).length % 6) * GRID * 3;
    addAt(create, pane ? pane.left + pane.width / 2 - 100 + step : 0, pane ? pane.top + pane.height / 2 - 40 + step : 0);
  }

  // Atajos (spec espacio-de-trabajo, criterio 5): 1–7 agregan, + − 0 zoom, I inspector, ? ayuda.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target) || playing) return;
      const digit = Number(event.key);
      if (!readOnly && Number.isInteger(digit) && digit >= 1 && digit <= PALETTE_TYPES.length) {
        addAtCenter((p) => addNode(PALETTE_TYPES[digit - 1]!, p));
      } else if (event.key === '+' || event.key === '=') void zoomIn();
      else if (event.key === '-') void zoomOut();
      else if (event.key === '0') void fitView({ padding: fitPadding, duration: 200 });
      else if (!readOnly && event.key.toLowerCase() === 'i') toggleInspector();
      else if (event.key === '?') setHelpOpen((open) => !open);
      else return;
      event.preventDefault();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  useEffect(() => {
    const open = () => setHelpOpen(true);
    window.addEventListener(OPEN_HELP_EVENT, open);
    return () => window.removeEventListener(OPEN_HELP_EVENT, open);
  }, []);

  // La vista también se guarda al salir: `onMoveEnd` llega al terminar una animación de zoom, y quien
  // cierra o recarga la página antes perdería el último movimiento.
  useEffect(() => {
    if (!catalog.featureId || readOnly) return;
    const featureId = catalog.featureId;
    const save = () => saveViewport(featureId, getViewport());
    window.addEventListener('pagehide', save);
    return () => {
      window.removeEventListener('pagehide', save);
      save();
    };
  }, [catalog.featureId, readOnly, getViewport]);

  const onMoveEnd = useCallback(
    (_: unknown, viewport: Viewport) => {
      if (catalog.featureId && !readOnly) saveViewport(catalog.featureId, viewport);
    },
    [catalog.featureId, readOnly],
  );

  const selectedNode = panelNodeId ? graphNodes[panelNodeId] : undefined;
  const hint = playing
    ? null
    : readOnly
      ? 'Solo lectura: desplázate, acerca y recorre los tours.'
      : selectedNode?.type === 'ref'
        ? 'Componente: su definición se edita en el inspector y cambia en todos los lienzos · Supr lo quita de aquí'
        : selectedNode
          ? 'Arrastra el punto derecho hasta otra caja para conectarlas · Doble clic edita el título · Supr borra'
          : panelEdgeId
            ? 'Edita el tipo, la etiqueta y la condición de la conexión en el inspector · Supr la borra'
            : empty
              ? null
              : 'Clic en una caja para ver sus propiedades · Arrastra el fondo para moverte · ? atajos';

  const paletteCatalog = catalog.appId
    ? {
        appId: catalog.appId,
        items: Object.values(catalog.items),
        onAddRef: (item: CatalogItem) => addAtCenter((p) => addRef(item, p)),
        onCreate: catalog.createItem
          ? async (item: NewCatalogItem) => {
              const created = await catalog.createItem!(item);
              addAtCenter((p) => addRef(created, p));
            }
          : undefined,
      }
    : undefined;

  return (
    <div
      className={[
        'canvas',
        readOnly && 'canvas-readonly',
        playing && 'canvas-touring',
        !readOnly && inspectorOpen && 'has-inspector',
      ]
        .filter(Boolean)
        .join(' ')}
    >
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
            if (locked) return;
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
          deleteKeyCode={locked ? null : ['Delete', 'Backspace']}
          nodesDraggable={!locked}
          nodesConnectable={!locked}
          elementsSelectable={!locked}
          fitView={fitOnMount}
          fitViewOptions={{ padding: fitPadding }}
          defaultViewport={savedViewport ?? { x: 0, y: 0, zoom: 1 }}
          onMoveEnd={onMoveEnd}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={GRID * 3} size={1.5} color={palette.grid} />
        </ReactFlow>
        {!readOnly && !playing && (
          <Palette onAdd={(type) => addAtCenter((p) => addNode(type, p))} catalog={paletteCatalog} />
        )}
        {!playing && <ZoomControls fitPadding={fitPadding} />}
        {!readOnly && !playing && empty && (
          <EmptyCanvasGuide onAdd={(type) => addAtCenter((p) => addNode(type, p))} onHelp={() => setHelpOpen(true)} />
        )}
        {hint && (
          <p className="canvas-hint" aria-live="polite">
            {hint}
          </p>
        )}
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
      {readOnly ? (
        <SharedTours onPlay={startTour} />
      ) : inspectorOpen ? (
        <div className="inspector floating">
          <div className="inspector-header">
            <span className="inspector-title">{panelNodeId || panelEdgeId ? 'Propiedades' : 'Lienzo'}</span>
            <button
              type="button"
              className="pixel-button is-ghost icon-button"
              aria-label="Ocultar inspector"
              data-tip="Ocultar · I"
              onClick={toggleInspector}
            >
              ⇥
            </button>
          </div>
          <PropertiesPanel
            nodeId={panelNodeId}
            edgeId={panelEdgeId}
            tours={{ openTourId, onOpen: setOpenTourId, onPlay: startTour }}
          />
        </div>
      ) : (
        <button
          type="button"
          className="pixel-button inspector-reopen floating"
          aria-label="Mostrar inspector"
          onClick={toggleInspector}
        >
          ⇤ {panelNodeId || panelEdgeId ? 'Propiedades' : 'Inspector'}
          {(panelNodeId || panelEdgeId) && <span className="inspector-dot" aria-hidden="true" />}
        </button>
      )}
      {helpOpen && <ShortcutsDialog onClose={() => setHelpOpen(false)} />}
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
