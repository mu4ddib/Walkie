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
import { CatalogContext, effectiveType, portalTarget, refTarget, type CanvasCatalog } from '../catalog/catalogContext';
import { edgeTypes } from '../edges/edgeTypes';
import type { WalkieFlowEdge } from '../edges/KindEdge';
import { nodeTypes } from '../nodes/nodeTypes';
import { PropertiesPanel } from '../panel/PropertiesPanel';
import { SharedTours } from '../tours/SharedTours';
import { TourPlayer } from '../tours/TourPlayer';
import type { WalkieFlowNode } from '../nodes/PixelNode';
import type { GroupFlowNode } from '../nodes/GroupNode';
import type { StickyFlowNode } from '../nodes/StickyNoteNode';
import { COLLAPSED_GROUP } from '../nodes/groupMeta';
import { GROUP_MIN, defaultEdgeKind, type Box, type GraphStore, type NodeType, type Position } from '../store/graphStore';
import { GraphStoreProvider } from '../store/GraphStoreProvider';
import { useGraphStore } from '../store/useGraphStore';
import { GRID, palette } from '../theme/palette';
import { Palette } from './Palette';
import { PALETTE_MIME, PALETTE_REF_MIME, PALETTE_TYPES } from './paletteTypes';
import { useOpenFeature } from './useOpenFeature';
import {
  getEdgeMotion,
  getInspectorOpen,
  getSavedViewport,
  saveViewport,
  setEdgeMotion,
  setInspectorOpen,
} from '../workspace/session';
import { EdgeMarkers } from '../edges/EdgeMarkers';
import { edgeDisplay, edgeDisplayText, interactionEdges } from '../edges/edgeMeta';
import { NodeMenu } from './NodeMenu';
import { OPEN_HELP_EVENT, isTyping } from './canvasShortcuts';
import { EmptyCanvasGuide } from './EmptyCanvasGuide';
import { ShortcutsDialog } from './ShortcutsDialog';
import { ZoomControls } from './ZoomControls';
import './canvas.css';

const NO_CATALOG: CanvasCatalog = { appId: '', items: {} };
/** Tamaño de una caja sin medir (el mínimo de `.pixel-node`). */
const NODE_SIZE = { width: 184, height: 72 } as const;
/** Separación entre conexiones que unen el mismo par (px): cada una va por su carril, con su etiqueta. */
const LANE_GAP = 24;
/** Lo que dura cada tramo de "Previsualizar interacción" (la ida, luego la vuelta). */
const PREVIEW_STEP_MS = 1800;
/** Hueco mínimo para que una conexión hacia la izquierda salga por el lado izquierdo en vez de rodear las cajas. */
const BACKWARD_GAP = 16;
type CanvasFlowNode = WalkieFlowNode | GroupFlowNode | StickyFlowNode;

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
  const groups = useGraphStore((s) => s.groups);
  const stickyNotes = useGraphStore((s) => s.stickyNotes);
  const { addNode, addRef, moveNode, removeNode, connect, removeEdge, duplicateNode } = useGraphStore((s) => s);
  const { addStickyNote, moveStickyNote, removeStickyNote, duplicateStickyNote } = useGraphStore((s) => s);
  const { addGroup, moveGroup, resizeGroup, setNodeGroup, removeGroup, updateGroup } = useGraphStore((s) => s);
  const { screenToFlowPosition, zoomIn, zoomOut, fitView, getViewport } = useReactFlow();
  const openFeature = useOpenFeature();
  // La vista se recuerda por feature (spec espacio-de-trabajo, criterio 1). Sin vista guardada, fitView
  // solo si el lienzo ya trae nodos: con uno vacío, React Flow ajustaría el zoom al aparecer el primero
  // y los siguientes caerían en otro lugar.
  const [savedViewport] = useState(() => (catalog.featureId ? getSavedViewport(catalog.featureId) : null));
  const [fitOnMount] = useState(() => !savedViewport && Object.keys(graphNodes).length > 0);
  const [inspectorOpen, setInspectorOpenState] = useState(getInspectorOpen);
  const [helpOpen, setHelpOpen] = useState(false);
  // Animación del sentido de las conexiones (criterio 21): se recuerda; con movimiento reducido no anima (CSS).
  const [edgeMotion, setEdgeMotionState] = useState(getEdgeMotion);
  const toggleEdgeMotion = useCallback(() => {
    setEdgeMotionState((on) => {
      setEdgeMotion(!on);
      return !on;
    });
  }, []);
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
  // Menú contextual de una caja o nota (clic derecho): duplicar, editar, eliminar.
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  // "Previsualizar interacción": las conexiones del intercambio, en orden (ida y vueltas), y la que se recorre ahora.
  const [preview, setPreview] = useState<{ ids: string[]; index: number } | null>(null);
  const previewId = preview?.ids[preview.index] ?? null;
  // Modo tour (spec modo-tour): qué tour y en qué paso; el lienzo queda de solo lectura.
  const [playing, setPlaying] = useState<{ tourId: string; step: number } | null>(null);
  const tours = useGraphStore((s) => s.tours);
  const tourNodeId = playing ? tours[playing.tourId]?.steps[playing.step]?.nodeId : undefined;
  const nextTourNodeId = playing ? tours[playing.tourId]?.steps[playing.step + 1]?.nodeId : undefined;
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

  const startPreview = useCallback(
    (edgeId: string) => {
      const ids = interactionEdges(graphEdges, edgeId);
      setPreview(ids.length > 0 ? { ids, index: 0 } : null);
    },
    [graphEdges],
  );
  const stopPreview = useCallback(() => setPreview(null), []);
  // Cada tramo se muestra un momento y pasa al siguiente; tras el último, la previsualización termina sola.
  useEffect(() => {
    if (!preview) return;
    const timer = setTimeout(
      () => setPreview((p) => (p && p.index + 1 < p.ids.length ? { ...p, index: p.index + 1 } : null)),
      PREVIEW_STEP_MS,
    );
    return () => clearTimeout(timer);
  }, [preview]);

  const startTour = useCallback((tourId: string) => {
    setPreview(null);
    setSelectedNodes(new Set());
    setSelectedEdges(new Set());
    setEditingId(null);
    setPlaying({ tourId, step: 0 });
  }, []);
  // Medidas que reporta React Flow. Si no se devuelven en `measured`, al reconstruir los nodos
  // React Flow los oculta un instante para medirlos otra vez y se pierden clics (ej. doble clic).
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({});
  const stopEditing = useCallback(() => setEditingId(null), []);

  // Grupos plegados (spec espacio-de-trabajo, criterio 19): sus nodos se ocultan y sus conexiones llegan a la caja.
  // En un tour todo se ve desplegado: el paso puede estar dentro de un grupo.
  const collapsedGroups = useMemo(
    () => new Set(playing ? [] : Object.values(groups).filter((g) => g.collapsed).map((g) => g.id)),
    [groups, playing],
  );

  const nodes = useMemo<CanvasFlowNode[]>(() => {
    // En una previsualización se destacan los extremos del intercambio.
    const previewEdges = (preview?.ids ?? []).map((id) => graphEdges[id]).filter((e) => !!e);
    const previewNodes = new Set(previewEdges.flatMap((e) => [e.from, e.to]));
    const stateClass = (id: string) =>
      playing
        ? id === tourNodeId
          ? 'tour-current'
          : 'tour-dim'
        : preview
          ? previewNodes.has(id)
            ? 'preview-node'
            : 'preview-dim'
          : undefined;
    const counts: Record<string, number> = {};
    for (const node of Object.values(graphNodes)) if (node.groupId) counts[node.groupId] = (counts[node.groupId] ?? 0) + 1;
    // Los grupos van primero y detrás (zIndex −1): React Flow dibuja en orden.
    const groupNodes: GroupFlowNode[] = Object.values(groups).map((group) => {
      const box = layout[group.id] ?? { x: 0, y: 0, w: GROUP_MIN.w, h: GROUP_MIN.h };
      const collapsed = collapsedGroups.has(group.id);
      return {
        id: group.id,
        type: 'infraGroup',
        position: { x: box.x, y: box.y },
        width: collapsed ? COLLAPSED_GROUP.width : (box.w ?? GROUP_MIN.w),
        height: collapsed ? COLLAPSED_GROUP.height : (box.h ?? GROUP_MIN.h),
        zIndex: collapsed ? 0 : -1,
        dragHandle: '.group-node-header',
        data: {
          group: { ...group, collapsed: collapsed || undefined },
          count: counts[group.id] ?? 0,
          onToggle: locked ? undefined : () => updateGroup(group.id, { collapsed: !group.collapsed }),
          resizable: !locked,
        },
        selected: selectedNodes.has(group.id),
        className: playing ? 'tour-dim' : preview ? 'preview-dim' : undefined,
      };
    });
    // Notas adhesivas: anotaciones sin conexiones, por encima de los grupos y debajo de las cajas.
    const noteNodes: StickyFlowNode[] = Object.values(stickyNotes).map((note) => ({
      id: note.id,
      type: 'stickyNote',
      position: layout[note.id] ?? { x: 0, y: 0 },
      data: { note, editing: editingId === note.id, onEditDone: stopEditing, readOnly: locked },
      selected: selectedNodes.has(note.id),
      measured: measured[note.id],
      connectable: false,
      className: playing ? 'tour-dim' : preview ? 'preview-dim' : undefined,
    }));
    const graphFlowNodes: WalkieFlowNode[] = Object.values(graphNodes).map((node) => ({
      id: node.id,
      type: node.type,
      position: layout[node.id] ?? { x: 0, y: 0 },
      data: { node, editing: editingId === node.id, onEditDone: stopEditing },
      selected: selectedNodes.has(node.id),
      measured: measured[node.id],
      hidden: !!node.groupId && collapsedGroups.has(node.groupId),
      className: stateClass(node.id),
    }));
    return [...groupNodes, ...noteNodes, ...graphFlowNodes];
  }, [
    graphNodes,
    graphEdges,
    preview,
    stickyNotes,
    groups,
    collapsedGroups,
    layout,
    selectedNodes,
    editingId,
    stopEditing,
    measured,
    playing,
    tourNodeId,
    locked,
    updateGroup,
  ]);

  const edges = useMemo<WalkieFlowEdge[]>(() => {
    // Un extremo dentro de un grupo plegado llega a la caja del grupo.
    const end = (id: string) => {
      const group = graphNodes[id]?.groupId;
      return group && collapsedGroups.has(group) ? group : id;
    };
    // En un tour (criterio 23): resaltar las conexiones del paso y animar la que lleva al siguiente.
    const tourClass = (from: string, to: string) => {
      if (!playing || !tourNodeId) return undefined;
      const touches = from === tourNodeId || to === tourNodeId;
      if (!touches) return 'tour-edge-dim';
      const next = nextTourNodeId && (from === nextTourNodeId || to === nextTourNodeId);
      return next ? 'tour-edge tour-edge-next' : 'tour-edge';
    };
    /** Caja con la que se dibuja un extremo: el nodo (medido) o su grupo plegado. */
    const boxOf = (id: string) => {
      const at = layout[id];
      if (!at) return null;
      if (groups[id]) return { x: at.x, y: at.y, w: COLLAPSED_GROUP.width, h: COLLAPSED_GROUP.height };
      const size = measured[id] ?? NODE_SIZE;
      return { x: at.x, y: at.y, w: size.width, h: size.height };
    };
    const all = Object.values(graphEdges);
    const position = new Map(all.map((edge, i) => [edge.id, i]));
    // Una respuesta va justo después de su solicitud: en el lienzo queda en el carril siguiente.
    const order = (edge: (typeof all)[number]) => {
      const request = edge.replyTo ? position.get(edge.replyTo) : undefined;
      return request === undefined ? position.get(edge.id)! : request + 0.5;
    };
    const visible = [...all]
      .sort((a, b) => order(a) - order(b) || position.get(a.id)! - position.get(b.id)!)
      .map((edge) => ({ edge, source: end(edge.from), target: end(edge.to) }))
      .filter(({ source, target }) => source !== target);
    // Conexiones que unen el mismo par (también las que llegan a un grupo plegado): cada una por su carril,
    // con la etiqueta junto a su trazo, para poder leerlas y seleccionarlas (criterio 22).
    const pairs: Record<string, number> = {};
    const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    for (const { source, target } of visible) pairs[pairKey(source, target)] = (pairs[pairKey(source, target)] ?? 0) + 1;
    const seen: Record<string, number> = {};
    // Ramas de una misma decisión: cada una dobla en su propia x (las que suben, de arriba abajo; las que bajan,
    // al revés) para que los tramos verticales no se pisen y cada etiqueta quede sobre su rama.
    const bends = new Map<string, number>();
    const byDecision: Record<string, { id: string; index: number; up: boolean }[]> = {};
    for (const { edge, source, target } of visible) {
      const origin = graphNodes[edge.from];
      const index = origin?.branches?.findIndex((b) => b.id === edge.branch) ?? -1;
      const from = boxOf(source);
      const to = boxOf(target);
      if (index < 0 || source !== edge.from || !from || !to || to.x < from.x + from.w + GRID * 8) continue;
      (byDecision[source] ??= []).push({ id: edge.id, index, up: to.y + to.h / 2 < from.y + from.h / 2 });
    }
    for (const [source, list] of Object.entries(byDecision)) {
      const from = boxOf(source)!;
      const up = list.filter((e) => e.up).sort((a, b) => a.index - b.index);
      const down = list.filter((e) => !e.up).sort((a, b) => b.index - a.index);
      [...up, ...down].forEach((e, i) => bends.set(e.id, from.x + from.w + GRID * 4 + i * GRID * 2));
    }
    return visible.map(({ edge, source, target }) => {
      const key = pairKey(source, target);
      const count = pairs[key] ?? 1;
      const index = (seen[key] = (seen[key] ?? -1) + 1);
      const lane = index - (count - 1) / 2;
      const from = boxOf(source);
      const to = boxOf(target);
      // Los carriles no se salen de la caja más baja del par.
      const room = Math.min(from?.h ?? NODE_SIZE.height, to?.h ?? NODE_SIZE.height) - GRID * 3;
      const gap = count > 1 ? Math.min(LANE_GAP, Math.max(GRID, room / (count - 1))) : 0;
      const backward =
        from && to && to.x + to.w + BACKWARD_GAP <= from.x ? { sourceX: from.x, targetX: to.x + to.w } : undefined;
      const sourceNode = graphNodes[edge.from];
      const targetNode = graphNodes[edge.to];
      const branch = edge.branch ? sourceNode?.branches?.find((b) => b.id === edge.branch) : undefined;
      const display = edgeDisplay(edge, {
        branchLabel: branch?.label,
        targetHttp: targetNode && (refTarget(targetNode, catalog.items)?.http ?? targetNode.http),
      });
      const step = preview ? preview.ids.indexOf(edge.id) : -1;
      return {
        id: edge.id,
        source,
        target,
        // Una rama sale del punto de su salida en la decisión (si la decisión no está dentro de un grupo plegado).
        sourceHandle: branch && source === edge.from ? branch.id : undefined,
        type: 'kind',
        data: {
          kind: edge.kind,
          label: edge.label,
          when: edge.when,
          display,
          // La etiqueta va sobre su propio trazo; si los carriles quedan muy juntos, se abre lo que falte.
          labelOffset: lane * Math.max(0, 26 - gap),
          laneOffset: lane * gap,
          backward,
          bendX: count === 1 ? bends.get(edge.id) : undefined,
          step: step >= 0 && preview!.ids.length > 1 ? step + 1 : undefined,
        },
        selected: selectedEdges.has(edge.id),
        className: preview
          ? step < 0
            ? 'edge-preview-dim'
            : edge.id === previewId
              ? 'edge-preview edge-preview-active'
              : 'edge-preview'
          : tourClass(edge.from, edge.to),
      };
    });
  }, [
    graphEdges,
    graphNodes,
    groups,
    layout,
    measured,
    catalog.items,
    collapsedGroups,
    selectedEdges,
    playing,
    tourNodeId,
    nextTourNodeId,
    preview,
    previewId,
  ]);

  /** Grupo desplegado que contiene el punto (el más chico si hay varios), para incluir un nodo al soltarlo. */
  const groupAt = useCallback(
    (point: Position) => {
      let found: { id: string; area: number } | null = null;
      for (const group of Object.values(groups)) {
        const box = layout[group.id];
        if (!box?.w || !box.h || group.collapsed) continue;
        const inside = point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h;
        if (inside && (!found || box.w * box.h < found.area)) found = { id: group.id, area: box.w * box.h };
      }
      return found?.id ?? null;
    },
    [groups, layout],
  );

  /** Centro de un nodo del grafo (con su tamaño medido, o el mínimo de una caja). */
  const centerOf = useCallback(
    (id: string): Position | null => {
      const at = layout[id];
      if (!at) return null;
      const size = measured[id] ?? { width: NODE_SIZE.width, height: NODE_SIZE.height };
      return { x: at.x + size.width / 2, y: at.y + size.height / 2 };
    },
    [layout, measured],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<CanvasFlowNode>[]) => {
      for (const change of changes) {
        const isGroup = change.type !== 'add' && change.id in groups;
        const isNote = change.type !== 'add' && change.id in stickyNotes;
        if (change.type === 'position' && change.position) {
          if (isNote) moveStickyNote(change.id, change.position);
          else if (!isGroup) moveNode(change.id, change.position);
          // Arrastrar un grupo mueve sus nodos; redimensionarlo desde arriba o la izquierda solo mueve la caja.
          else if (change.dragging) moveGroup(change.id, change.position);
          else {
            const box = layout[change.id];
            if (box?.w && box.h) resizeGroup(change.id, { x: change.position.x, y: change.position.y, w: box.w, h: box.h });
          }
        }
        if (change.type === 'dimensions' && isGroup && change.resizing && change.dimensions) {
          const box = layout[change.id];
          if (box) resizeGroup(change.id, { x: box.x, y: box.y, w: change.dimensions.width, h: change.dimensions.height });
          continue;
        }
        if (change.type === 'remove') {
          if (isGroup) removeGroup(change.id);
          else if (isNote) removeStickyNote(change.id);
          else removeNode(change.id);
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
    [moveNode, removeNode, groups, stickyNotes, layout, moveGroup, resizeGroup, removeGroup, moveStickyNote, removeStickyNote],
  );

  // Soltar un nodo dentro de un grupo lo incluye; soltarlo fuera lo saca (criterio 18).
  const onNodeDragStop = useCallback(
    (_: unknown, __: unknown, dragged: { id: string }[]) => {
      for (const { id } of dragged) {
        if (id in groups || id in stickyNotes) continue;
        const center = centerOf(id);
        if (center) setNodeGroup(id, groupAt(center));
      }
    },
    [groups, stickyNotes, centerOf, groupAt, setNodeGroup],
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
  const liveGroups = [...selectedNodes].filter((id) => groups[id]);
  const liveNotes = [...selectedNodes].filter((id) => stickyNotes[id]);
  const liveEdges = [...selectedEdges].filter((id) => graphEdges[id]);
  const single = liveNodes.length + liveGroups.length + liveNotes.length + liveEdges.length === 1;
  const panelNoteId = single ? (liveNotes[0] ?? null) : null;
  const panelNodeId = single ? (liveNodes[0] ?? null) : null;
  const panelGroupId = single ? (liveGroups[0] ?? null) : null;
  const panelEdgeId = single ? (liveEdges[0] ?? null) : null;
  const panelSelected = Boolean(panelNodeId || panelEdgeId || panelGroupId || panelNoteId);

  // Un `ref` conecta como su elemento del catálogo (spec catalogo, criterio 9).
  const onConnect = useCallback(
    (c: Connection) => {
      const source = graphNodes[c.source];
      const target = graphNodes[c.target];
      const kind =
        source && target
          ? defaultEdgeKind(effectiveType(source, catalog.items), effectiveType(target, catalog.items))
          : undefined;
      // Desde el punto de una salida de decisión, la conexión nace como esa rama.
      connect(c.source, c.target, kind, { branch: c.sourceHandle });
    },
    [connect, graphNodes, catalog.items],
  );

  const addAt = useCallback(
    (create: (position: Position) => string, clientX: number, clientY: number) => {
      const position = screenToFlowPosition({ x: clientX, y: clientY });
      const id = create(position);
      // Un nodo que cae dentro de un grupo queda en él.
      const group = groupAt({ x: position.x + NODE_SIZE.width / 2, y: position.y + NODE_SIZE.height / 2 });
      if (group) setNodeGroup(id, group);
      setSelectedNodes(new Set([id]));
    },
    [screenToFlowPosition, groupAt, setNodeGroup],
  );

  /**
   * "Grupo" (criterio 18): con cajas seleccionadas, las rodea y las incluye; si no, uno vacío en el centro.
   */
  function createGroup() {
    const members = [...selectedNodes].filter((id) => graphNodes[id] && layout[id]);
    let box: Box;
    if (members.length > 0) {
      const rects = members.map((id) => {
        const at = layout[id]!;
        const size = measured[id] ?? NODE_SIZE;
        return { x: at.x, y: at.y, r: at.x + size.width, b: at.y + size.height };
      });
      const x = Math.min(...rects.map((r) => r.x)) - GRID * 4;
      const y = Math.min(...rects.map((r) => r.y)) - GRID * 7;
      box = { x, y, w: Math.max(...rects.map((r) => r.r)) + GRID * 4 - x, h: Math.max(...rects.map((r) => r.b)) + GRID * 4 - y };
    } else {
      const rect = flowRef.current?.getBoundingClientRect();
      const center = screenToFlowPosition({
        x: rect ? rect.left + rect.width / 2 : 0,
        y: rect ? rect.top + rect.height / 2 : 0,
      });
      box = { x: center.x - 240, y: center.y - 160, w: 480, h: 320 };
    }
    const id = addGroup(box, { members });
    setSelectedNodes(new Set([id]));
    setSelectedEdges(new Set());
  }

  /** Selecciona desde el inspector (ir de una solicitud a su respuesta, o al contrato de la API). */
  const selectFromPanel = useCallback((target: { nodeId?: string; edgeId?: string }) => {
    setSelectedNodes(new Set(target.nodeId ? [target.nodeId] : []));
    setSelectedEdges(new Set(target.edgeId ? [target.edgeId] : []));
  }, []);

  /**
   * Duplicar (Ctrl+D o el menú contextual): copia las cajas y notas seleccionadas con un ligero desplazamiento
   * y deja seleccionadas las copias. Una copia empieza sin conexiones.
   */
  function duplicate(ids: readonly string[]) {
    const copies: string[] = [];
    for (const id of ids) {
      const copy = graphNodes[id] ? duplicateNode(id) : stickyNotes[id] ? duplicateStickyNote(id) : null;
      if (copy) copies.push(copy);
    }
    if (copies.length === 0) return;
    setSelectedNodes(new Set(copies));
    setSelectedEdges(new Set());
    setEditingId(null);
  }

  function removeFromMenu(id: string) {
    if (graphNodes[id]) removeNode(id);
    else removeStickyNote(id);
    setSelectedNodes((s) => toggle(s, id, false));
  }

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

  /** Nota adhesiva en el centro, lista para escribir. */
  function addNote() {
    addAtCenter((p) => {
      const id = addStickyNote(p);
      setEditingId(id);
      return id;
    });
  }

  // Atajos (spec espacio-de-trabajo, criterio 5): 1–7 agregan, + − 0 zoom, I inspector, ? ayuda.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Ctrl+D / Cmd+D duplica lo seleccionado. Mientras se escribe (inspector, título, nota) no hace nada aquí.
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'd') {
        if (isTyping(event.target) || locked) return;
        const ids = [...selectedNodes].filter((id) => graphNodes[id] || stickyNotes[id]);
        if (ids.length === 0) return;
        event.preventDefault();
        duplicate(ids);
        return;
      }
      if (event.key === 'Escape' && (preview || menu)) {
        setPreview(null);
        setMenu(null);
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target) || playing) return;
      const digit = Number(event.key);
      if (!readOnly && Number.isInteger(digit) && digit >= 1 && digit <= PALETTE_TYPES.length) {
        addAtCenter((p) => addNode(PALETTE_TYPES[digit - 1]!, p));
      } else if (event.key === '+' || event.key === '=') void zoomIn();
      else if (event.key === '-') void zoomOut();
      else if (event.key === '0') void fitView({ padding: fitPadding, duration: 200 });
      else if (!readOnly && event.key.toLowerCase() === 'i') toggleInspector();
      else if (!readOnly && event.key.toLowerCase() === 'g') createGroup();
      else if (!readOnly && event.key.toLowerCase() === 'n') addNote();
      else if (event.key.toLowerCase() === 'm') toggleEdgeMotion();
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

  // Las ayudas de uso viven en "?" (atajos y gestos) y en los tooltips; aquí solo lo que cambia el modo del lienzo.
  const previewEdge = previewId ? edges.find((e) => e.id === previewId) : undefined;
  const hint = playing
    ? null
    : preview && previewEdge?.data?.display
      ? `Previsualizando${preview.ids.length > 1 ? ` · ${preview.index + 1} de ${preview.ids.length}` : ''}: ${
          graphNodes[graphEdges[previewEdge.id]!.from]?.title ?? ''
        } → ${graphNodes[graphEdges[previewEdge.id]!.to]?.title ?? ''} (${edgeDisplayText(previewEdge.data.display)}) · Esc termina`
      : readOnly
        ? 'Solo lectura: desplázate, acerca y recorre los tours.'
        : null;

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
        preview && 'canvas-previewing',
        readOnly && 'canvas-readonly',
        playing && 'canvas-touring',
        edgeMotion && 'edge-motion',
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
          onNodeDragStop={onNodeDragStop}
          // El título de un `ref` se edita en el catálogo; el doble clic en un `portal` abre su destino.
          onNodeDoubleClick={(_, flowNode) => {
            if (locked) return;
            if (stickyNotes[flowNode.id]) return setEditingId(flowNode.id);
            const node = graphNodes[flowNode.id];
            if (!node || node.type === 'ref') return;
            if (node.type === 'portal') {
              const target = portalTarget(node, catalog.features);
              if (target) openFeature(target.id);
              return;
            }
            setEditingId(node.id);
          }}
          onNodeContextMenu={(event, flowNode) => {
            if (locked || !(graphNodes[flowNode.id] || stickyNotes[flowNode.id])) return;
            event.preventDefault();
            if (!selectedNodes.has(flowNode.id)) {
              setSelectedNodes(new Set([flowNode.id]));
              setSelectedEdges(new Set());
            }
            setMenu({ id: flowNode.id, x: event.clientX, y: event.clientY });
          }}
          onPaneClick={() => setMenu(null)}
          onMoveStart={() => setMenu(null)}
          zoomOnDoubleClick={false}
          // Mayús, Ctrl o Cmd + clic suman cajas a la selección (para agruparlas con G).
          multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
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
          <Palette
            onAdd={(type) => addAtCenter((p) => addNode(type, p))}
            onAddGroup={createGroup}
            onAddNote={addNote}
            catalog={paletteCatalog}
          />
        )}
        <EdgeMarkers />
        {!playing && <ZoomControls fitPadding={fitPadding} motion={{ on: edgeMotion, onToggle: toggleEdgeMotion }} />}
        {!readOnly && !playing && empty && (
          <EmptyCanvasGuide onAdd={(type) => addAtCenter((p) => addNode(type, p))} onHelp={() => setHelpOpen(true)} />
        )}
        {hint && (
          <p className="canvas-hint" aria-live="polite">
            {hint}
          </p>
        )}
        {menu && !locked && (
          <NodeMenu
            x={menu.x}
            y={menu.y}
            // Con varias cajas seleccionadas, "Duplicar" las copia todas.
            count={selectedNodes.has(menu.id) ? [...selectedNodes].filter((id) => graphNodes[id] || stickyNotes[id]).length : 1}
            editLabel={
              stickyNotes[menu.id]
                ? 'Editar texto'
                : graphNodes[menu.id]?.type === 'ref' || graphNodes[menu.id]?.type === 'portal'
                  ? null
                  : 'Editar título'
            }
            onDuplicate={() =>
              duplicate(
                selectedNodes.has(menu.id) ? [...selectedNodes].filter((id) => graphNodes[id] || stickyNotes[id]) : [menu.id],
              )
            }
            onEdit={() => setEditingId(menu.id)}
            onRemove={() => removeFromMenu(menu.id)}
            onClose={() => setMenu(null)}
          />
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
            <span className="inspector-title">{panelSelected ? 'Propiedades' : 'Lienzo'}</span>
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
            groupId={panelGroupId}
            noteId={panelNoteId}
            onSelect={selectFromPanel}
            preview={{ activeEdgeId: previewId, onStart: startPreview, onStop: stopPreview }}
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
          ⇤ {panelSelected ? 'Propiedades' : 'Inspector'}
          {panelSelected && <span className="inspector-dot" aria-hidden="true" />}
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
