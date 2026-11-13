import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
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
import type { CatalogItem, ModuleSummary, NewCatalogItem } from '../api/client';
import {
  CatalogContext,
  effectiveResource,
  endType,
  interfaceTarget,
  moduleTarget,
  portalTarget,
  refTarget,
  type CanvasCatalog,
} from '../catalog/catalogContext';
import { InterfacePicker, type InterfaceChoice } from '../modules/InterfacePicker';
import { ExtractModuleDialog } from '../modules/ExtractModuleDialog';
import { placeableModules } from '../modules/moduleMeta';
import type { InterfaceRef } from '../schema/walkie-graph';
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
import { DUPLICATE_OFFSET, GROUP_MIN, defaultEdgeKind, type Box, type GraphStore, type NodeType, type Position } from '../store/graphStore';
import {
  ancestorsOf,
  canNest,
  commonOwner,
  descendantsOf,
  depthOf,
  isHidden,
  isInside,
  ownerOf,
  visibleEnd,
  type Hierarchy,
} from '../store/hierarchy';
import { FlowPlayer, type Rect } from '../tours/FlowPlayer';
import { FLOW_TIMING, firstPhase, goTo, type Playing } from '../tours/flowPlayback';
import { EMPTY_TOURS_UI, type ToursUi } from '../panel/tours/toursUi';
import { isFlowTour, lastEnd, suggestOrder, tourNodes, type TourKind, type TourStep } from '../tours/flows';
import { GraphStoreProvider } from '../store/GraphStoreProvider';
import { useGraphStore } from '../store/useGraphStore';
import { GRID, palette } from '../theme/palette';
import { Palette } from './Palette';
import { PALETTE_MIME, PALETTE_MODULE_MIME, PALETTE_REF_MIME, PALETTE_RESOURCE_MIME, PALETTE_TYPES, RESOURCE_KEY } from './paletteTypes';
import { RESOURCE_KINDS, type ResourceKind } from '../nodes/resourceMeta';
import { useOpenFeature } from './useOpenFeature';
import { useOpenModule } from './useOpenModule';
import {
  getEdgeMotion,
  getFlowSpeed,
  getInspectorOpen,
  getSavedViewport,
  saveViewport,
  setEdgeMotion,
  setInspectorOpen,
} from '../workspace/session';
import { EdgeMarkers } from '../edges/EdgeMarkers';
import { labelSize, placePairLabels, type PlacedLabel } from '../edges/labels';
import { laneOffsets, laneRoute } from '../edges/lanes';
import { computePorts, staggerBends, type Side } from '../edges/ports';
import { defaultRoute, routeAround, type Point } from '../edges/route';
import { edgeDisplay, edgeDisplayText, interactionEdges } from '../edges/edgeMeta';
import { NodeMenu } from './NodeMenu';
import { OPEN_HELP_EVENT, isTyping } from './canvasShortcuts';
import { captureCanvas, framing, onCanvasImageRequest } from './canvasImage';
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
/** Separación mínima (px) entre las etiquetas de conexiones que unen el mismo par. */
const LABEL_GAP = 26;
/** Hueco mínimo para que una conexión hacia la izquierda salga por el lado izquierdo en vez de rodear las cajas. */
const BACKWARD_GAP = 16;
/** Cuánto se ve el aviso de lo que pasó (al soltar en un grupo, al borrar una conexión usada). */
const NOTICE_MS = 4000;
/** Punto de un grupo que decide dónde cae al soltarlo: su asa (el encabezado), por donde se arrastra. */
const GROUP_GRIP = { x: 24, y: 16 } as const;
type CanvasFlowNode = WalkieFlowNode | GroupFlowNode | StickyFlowNode;

/**
 * Lienzo de una feature. Todo cambio del grafo pasa por las acciones del store. `catalog` es el catálogo
 * de la app: los nodos `ref` lo leen por contexto y la paleta lo ofrece para crear `ref`. Con `catalog.share`
 * (vista de un enlace) queda de solo lectura: sin paleta ni panel, solo la lista de tours.
 */
export function Canvas({
  store,
  catalog = NO_CATALOG,
  focusId,
  focusCenter = true,
  initialPlay,
}: {
  store: StoreApi<GraphStore>;
  catalog?: CanvasCatalog;
  /** Caja con la que se abre el lienzo: seleccionada y centrada (ej. un portal desde el mapa de la app). */
  focusId?: string;
  /** `false`: la caja se selecciona sin mover la vista (al volver de un módulo, la vista recordada manda). */
  focusCenter?: boolean;
  /** Tour o recorrido que se reproduce al abrir, desde un paso (entrar a un módulo o volver de él). */
  initialPlay?: { tourId: string; step: number };
}) {
  return (
    <GraphStoreProvider store={store}>
      <CatalogContext.Provider value={catalog}>
        <ReactFlowProvider>
          <CanvasInner catalog={catalog} focusId={focusId} focusCenter={focusCenter} initialPlay={initialPlay} />
        </ReactFlowProvider>
      </CatalogContext.Provider>
    </GraphStoreProvider>
  );
}

function CanvasInner({
  catalog,
  focusId,
  focusCenter,
  initialPlay,
}: {
  catalog: CanvasCatalog;
  focusId?: string;
  focusCenter: boolean;
  initialPlay?: { tourId: string; step: number };
}) {
  const graphNodes = useGraphStore((s) => s.nodes);
  const layout = useGraphStore((s) => s.layout);
  const graphEdges = useGraphStore((s) => s.edges);
  const groups = useGraphStore((s) => s.groups);
  const stickyNotes = useGraphStore((s) => s.stickyNotes);
  const moduleInterfaces = useGraphStore((s) => s.interfaces);
  const { addNode, addResource, addRef, moveNode, removeNode, connect, removeEdge, duplicateNode } = useGraphStore((s) => s);
  const { addModuleRef, resizeNode } = useGraphStore((s) => s);
  const { addStickyNote, moveStickyNote, removeStickyNote, duplicateStickyNote } = useGraphStore((s) => s);
  const { addGroup, moveGroup, resizeGroup, setParent, removeGroup, updateGroup } = useGraphStore((s) => s);
  const { addFlowTour, addEdgeStep } = useGraphStore((s) => s);
  const { undo, redo, beginBatch, endBatch, growGroup, canUndo, canRedo } = useGraphStore((s) => s);
  const { screenToFlowPosition, zoomIn, zoomOut, fitView, getViewport, setCenter, getNodes, getNodesBounds } = useReactFlow();
  const openFeature = useOpenFeature();
  const openModule = useOpenModule();
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
  const [selectedNodes, setSelectedNodes] = useState<ReadonlySet<string>>(
    () => new Set(focusId && graphNodes[focusId] ? [focusId] : []),
  );
  const [selectedEdges, setSelectedEdges] = useState<ReadonlySet<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openTourId, setOpenTourId] = useState<string | null>(null);
  // Pestaña de la sección Tours y recorridos (spec tours-y-recorridos): se recuerda al seleccionar cajas.
  const [toursTab, setToursTab] = useState<TourKind>('guide');
  // Estado de interfaz de la sección de tours (pasos abiertos, búsquedas, desplazamiento): nunca va al store.
  const [toursUi, setToursUi] = useState<ToursUi>(EMPTY_TOURS_UI);
  // Lista de subtipos de recurso de la barra (tecla 8): estado de interfaz, no del documento.
  const [resourcesOpen, setResourcesOpen] = useState(false);
  // «Localizar en lienzo»: el nodo o la conexión de un paso se resalta un momento.
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 1800);
    return () => clearTimeout(timer);
  }, [flash]);
  // Menú contextual de una caja o nota (clic derecho): duplicar, editar, eliminar.
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  // "Previsualizar interacción": las conexiones del intercambio, en orden (ida y vueltas), y la que se recorre ahora.
  const [preview, setPreview] = useState<{ ids: string[]; index: number } | null>(null);
  const previewId = preview?.ids[preview.index] ?? null;
  // Modo tour (spec modo-tour) o reproducción de un recorrido: qué tour, en qué paso y fase; el lienzo queda de solo
  // lectura. Es estado de visualización: el store (y el autoguardado) no lo ven.
  const tourAtStart = useGraphStore((s) => (initialPlay ? s.tours[initialPlay.tourId] : undefined));
  const [playing, setPlaying] = useState<Playing | null>(() =>
    initialPlay && tourAtStart && tourAtStart.steps[initialPlay.step]
      ? { tourId: initialPlay.tourId, step: initialPlay.step, phase: firstPhase(tourAtStart, initialPlay.step), mode: 'play' }
      : null,
  );
  const [flowSpeed, setFlowSpeedState] = useState(getFlowSpeed);
  const tours = useGraphStore((s) => s.tours);
  const playingTour = playing ? tours[playing.tourId] : undefined;
  const flowPlaying = !!playing && isFlowTour(playingTour);
  const currentStep = playing ? playingTour?.steps[playing.step] : undefined;
  const currentEdge = currentStep?.edgeId ? graphEdges[currentStep.edgeId] : undefined;
  const tourNodeId = currentStep?.nodeId;
  const nextTourNodeId = playing ? playingTour?.steps[playing.step + 1]?.nodeId : undefined;
  // Recorrido al que se le agregan pasos tocando conexiones en el lienzo (parte 3).
  const [pickingTourId, setPickingTourId] = useState<string | null>(null);
  const pickingTour = pickingTourId ? tours[pickingTourId] : undefined;
  // Recién creado desde la selección: el editor enfoca su nombre.
  const [createdTourId, setCreatedTourId] = useState<string | null>(null);
  // Arrastre: a qué grupo iría lo que se arrastra (indicación de la pertenencia resultante) y aviso al soltar.
  const [dropHint, setDropHint] = useState<{ groupId: string | null; text: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // «Convertir en módulo» (spec modulos-compartidos): lo seleccionado que se convierte, con el diálogo abierto.
  const [extracting, setExtracting] = useState<string[] | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);
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

  const startTour = useCallback(
    (tourId: string) => {
      setPreview(null);
      setPickingTourId(null);
      setSelectedNodes(new Set());
      setSelectedEdges(new Set());
      setEditingId(null);
      setPlaying({ tourId, step: 0, phase: firstPhase(tours[tourId], 0), mode: 'play' });
    },
    [tours],
  );
  // Medidas que reporta React Flow. Si no se devuelven en `measured`, al reconstruir los nodos
  // React Flow los oculta un instante para medirlos otra vez y se pierden clics (ej. doble clic).
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({});
  const stopEditing = useCallback(() => setEditingId(null), []);

  const hierarchy = useMemo<Hierarchy>(
    () => ({ nodes: graphNodes, groups, stickyNotes }),
    [graphNodes, groups, stickyNotes],
  );
  // Durante un tour o un recorrido, los grupos que contienen el paso activo se despliegan solo en la vista (no en el
  // grafo); al cambiar de paso o al detener, vuelven a verse como estaban.
  const activeIds = currentEdge ? [currentEdge.from, currentEdge.to] : tourNodeId ? [tourNodeId] : [];
  const activeKey = activeIds.join('|');
  const tempExpanded = useMemo(
    () => new Set(activeKey ? activeKey.split('|').flatMap((id) => ancestorsOf(hierarchy, id)) : []),
    [activeKey, hierarchy],
  );
  // Grupos plegados (spec espacio-de-trabajo, criterio 19; spec recorridos-y-grupos, parte 1): todo lo de dentro se
  // oculta, a cualquier profundidad, y sus conexiones llegan a la caja visible más externa.
  const collapsedGroups = useMemo(
    () => new Set(Object.values(groups).filter((g) => g.collapsed && !tempExpanded.has(g.id)).map((g) => g.id)),
    [groups, tempExpanded],
  );

  /** Caja con la que se dibuja `id` (nodo medido, nota, grupo desplegado o plegado). */
  const boxOf = useCallback(
    (id: string): Rect | null => {
      const at = layout[id];
      if (!at) return null;
      if (groups[id]) {
        return collapsedGroups.has(id)
          ? { x: at.x, y: at.y, w: COLLAPSED_GROUP.width, h: COLLAPSED_GROUP.height }
          : { x: at.x, y: at.y, w: at.w ?? GROUP_MIN.w, h: at.h ?? GROUP_MIN.h };
      }
      const size = measured[id] ?? NODE_SIZE;
      return { x: at.x, y: at.y, w: size.width, h: size.height };
    },
    [layout, groups, collapsedGroups, measured],
  );

  /** Caja completa de `id`: la de un grupo aunque se vea plegado (es lo que ocupará al desplegarlo). */
  function fullBoxOf(id: string): Rect | null {
    const at = layout[id];
    if (groups[id] && at?.w && at.h) return { x: at.x, y: at.y, w: at.w, h: at.h };
    return boxOf(id);
  }

  // Pasos del recorrido que se muestra (el que se reproduce, o el abierto en el editor): número de paso por conexión.
  const shownFlow = flowPlaying
    ? playingTour
    : !playing && openTourId && isFlowTour(tours[openTourId]) && inspectorOpen
      ? tours[openTourId]
      : undefined;
  const flowSteps = useMemo(() => {
    const map = new Map<string, number[]>();
    shownFlow?.steps.forEach((step, i) => {
      if (step.edgeId) map.set(step.edgeId, [...(map.get(step.edgeId) ?? []), i]);
    });
    return map;
  }, [shownFlow]);
  const participants = useMemo(() => tourNodes(playingTour, graphEdges), [playingTour, graphEdges]);
  // Al elegir pasos desde el lienzo, se destacan las conexiones que continúan desde donde quedó el recorrido.
  const pickFrom = pickingTour ? lastEnd(pickingTour, graphEdges) : null;

  const nodes = useMemo<CanvasFlowNode[]>(() => {
    // En una previsualización se destacan los extremos del intercambio.
    const previewEdges = (preview?.ids ?? []).map((id) => graphEdges[id]).filter((e) => !!e);
    const previewNodes = new Set(previewEdges.flatMap((e) => [e.from, e.to]));
    /** Reproducción de un recorrido: origen del paso, destino al terminar, participantes y el resto atenuado. */
    const flowClass = (id: string) => {
      if (currentEdge) {
        if (id === currentEdge.from && playing!.phase !== 'target') return 'flow-source';
        if (id === currentEdge.to && playing!.phase === 'target') return 'flow-target';
        if (id === currentEdge.to) return 'flow-next';
      } else if (id === tourNodeId) return 'flow-target';
      return participants.has(id) ? 'flow-member' : 'flow-dim';
    };
    const stateClass = (id: string) =>
      flowPlaying
        ? flowClass(id)
        : playing
          ? id === tourNodeId
            ? 'tour-current'
            : 'tour-dim'
          : preview
            ? previewNodes.has(id)
              ? 'preview-node'
              : 'preview-dim'
            : undefined;
    /** Un grupo no se atenúa si contiene algo del paso o del recorrido. */
    const groupClass = (id: string) => {
      if (flowPlaying) return [...participants].some((p) => isInside(hierarchy, p, id)) ? 'flow-member' : 'flow-dim';
      if (playing) return tourNodeId && isInside(hierarchy, tourNodeId, id) ? undefined : 'tour-dim';
      if (preview) return [...previewNodes].some((p) => isInside(hierarchy, p, id)) ? undefined : 'preview-dim';
      return undefined;
    };
    const area = (id: string) => (layout[id]?.w ?? 0) * (layout[id]?.h ?? 0);
    const dimClass = flowPlaying ? 'flow-dim' : playing ? 'tour-dim' : preview ? 'preview-dim' : undefined;
    // Los grupos van primero y detrás, los de fuera antes que los de dentro: React Flow dibuja en orden y cada nivel
    // queda sobre el que lo contiene.
    const groupNodes: GroupFlowNode[] = Object.values(groups)
      .map((group) => ({ group, depth: depthOf(hierarchy, group.id) }))
      // A igual profundidad, los grandes primero: uno chico que se les superpone queda encima.
      .sort((a, b) => a.depth - b.depth || area(b.group.id) - area(a.group.id))
      .map(({ group, depth }) => {
        const box = layout[group.id] ?? { x: 0, y: 0, w: GROUP_MIN.w, h: GROUP_MIN.h };
        const collapsed = collapsedGroups.has(group.id);
        const inside = descendantsOf(hierarchy, group.id);
        return {
          id: group.id,
          type: 'infraGroup',
          position: { x: box.x, y: box.y },
          width: collapsed ? COLLAPSED_GROUP.width : (box.w ?? GROUP_MIN.w),
          height: collapsed ? COLLAPSED_GROUP.height : (box.h ?? GROUP_MIN.h),
          zIndex: collapsed ? 0 : -20 + Math.min(depth, 18),
          hidden: isHidden(hierarchy, group.id, collapsedGroups),
          dragHandle: '.group-node-header',
          data: {
            group: { ...group, collapsed: collapsed || undefined },
            count: inside.nodes.length,
            subgroups: inside.groups.length,
            dropTarget: dropHint?.groupId === group.id,
            onToggle: locked ? undefined : () => updateGroup(group.id, { collapsed: !group.collapsed }),
            resizable: !locked,
          },
          selected: selectedNodes.has(group.id),
          className: [groupClass(group.id), flash === group.id && 'locate-flash'].filter(Boolean).join(' ') || undefined,
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
      hidden: isHidden(hierarchy, note.id, collapsedGroups),
      className: dimClass,
    }));
    const graphFlowNodes: WalkieFlowNode[] = Object.values(graphNodes).map((node) => ({
      id: node.id,
      type: node.type,
      position: layout[node.id] ?? { x: 0, y: 0 },
      // La caja de un módulo conserva su ancho en este lienzo (spec modulos-compartidos, criterio 3).
      width: node.type === 'module' ? layout[node.id]?.w : undefined,
      data: { node, editing: editingId === node.id, onEditDone: stopEditing },
      selected: selectedNodes.has(node.id),
      measured: measured[node.id],
      hidden: isHidden(hierarchy, node.id, collapsedGroups),
      className: [stateClass(node.id), flash === node.id && 'locate-flash'].filter(Boolean).join(' ') || undefined,
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
    hierarchy,
    flowPlaying,
    currentEdge,
    participants,
    dropHint,
    flash,
  ]);

  const edges = useMemo<WalkieFlowEdge[]>(() => {
    // Un extremo oculto (a cualquier profundidad) llega a la caja del grupo plegado visible que lo contiene.
    const end = (id: string) => visibleEnd(hierarchy, id, collapsedGroups);
    // En un tour (criterio 23): resaltar las conexiones del paso y animar la que lleva al siguiente.
    const tourClass = (from: string, to: string) => {
      if (!playing || !tourNodeId) return undefined;
      const touches = from === tourNodeId || to === tourNodeId;
      if (!touches) return 'tour-edge-dim';
      const next = nextTourNodeId && (from === nextTourNodeId || to === nextTourNodeId);
      return next ? 'tour-edge tour-edge-next' : 'tour-edge';
    };
    /** Recorrido: la conexión del paso activo se anima; las ya recorridas y las del recorrido se ven; el resto, tenue. */
    const flowClass = (id: string) => {
      const steps = flowSteps.get(id);
      if (flowPlaying) {
        if (id === currentEdge?.id) return `flow-edge flow-edge-active flow-phase-${playing!.phase}`;
        if (steps?.some((i) => i < playing!.step)) return 'flow-edge flow-edge-done';
        return steps ? 'flow-edge' : 'flow-edge-dim';
      }
      const candidate = pickFrom !== null && graphEdges[id]?.from === pickFrom ? ' flow-candidate' : '';
      return steps ? `flow-edge${candidate}` : candidate.trim() || undefined;
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
    // Puertos (spec puertos-de-conexion): cada conexión sale y entra por el lado que mira al otro extremo, repartida
    // a lo largo de él. Una rama sale de su salida en la decisión (lo dibuja React Flow): solo se reparte su llegada;
    // para ordenarla se toma un punto aproximado en el lado derecho de la decisión.
    const rects: Record<string, Rect> = {};
    for (const { source, target } of visible) {
      for (const id of [source, target]) {
        const r = boxOf(id);
        if (r) rects[id] = r;
      }
    }
    const ports = computePorts(
      visible.map(({ edge, source, target }) => {
        const branches = source === edge.from ? (graphNodes[edge.from]?.branches ?? []) : [];
        const index = branches.findIndex((b) => b.id === edge.branch);
        const from = rects[source];
        const fixedSource =
          index >= 0 && from
            ? { x: from.x + from.w, y: from.y + from.h - (branches.length - index) * 16 - 4, side: 'right' as const }
            : undefined;
        return { id: edge.id, source, target, fixedSource };
      }),
      rects,
    );
    // Las que comparten lado de salida doblan cada una en su línea (las ramas de una decisión ya tienen la suya).
    const staggered = staggerBends(
      visible.flatMap(({ edge, source }) => {
        const p = ports[edge.id];
        return p && !bends.has(edge.id) ? [{ id: edge.id, box: source, source: p.source, target: p.target }] : [];
      }),
    );
    // Cajas que una conexión esquiva (tarea 4 de puertos-de-conexion): lo que se ve como caja —nodos, grupos plegados
    // y notas—, no los grupos desplegados (se entra en ellos).
    const obstacles: { id: string; rect: Rect }[] = [];
    for (const node of Object.values(graphNodes)) {
      const r = !isHidden(hierarchy, node.id, collapsedGroups) && boxOf(node.id);
      if (r) obstacles.push({ id: node.id, rect: r });
    }
    for (const id of collapsedGroups) {
      const r = !isHidden(hierarchy, id, collapsedGroups) && boxOf(id);
      if (r) obstacles.push({ id, rect: r });
    }
    for (const id of Object.keys(stickyNotes)) {
      const r = !isHidden(hierarchy, id, collapsedGroups) && boxOf(id);
      if (r) obstacles.push({ id, rect: r });
    }
    const routes: Record<string, Point[]> = {};
    for (const { edge, source, target } of visible) {
      const p = ports[edge.id];
      const branchEdge = !!edge.branch && source === edge.from;
      if (!p || branchEdge) continue;
      const others = obstacles.filter((o) => o.id !== source && o.id !== target).map((o) => o.rect);
      const single = (pairs[pairKey(source, target)] ?? 1) === 1;
      const route = routeAround(p.source, p.target, others, single ? staggered[edge.id] : undefined);
      if (route) routes[edge.id] = route;
    }
    // Conexiones entre el mismo par (una solicitud y sus respuestas, u otras): un solo corredor para todas —el de la
    // primera, rodeando cajas si hace falta— y cada una en su carril, para que no compartan tramos (spec
    // conexiones-ida-y-vuelta). Las ramas de una decisión ya tienen su doblez propio.
    const laneEdges = visible.flatMap(({ edge, source, target }) => {
      const p = ports[edge.id];
      const branchEdge = !!edge.branch && source === edge.from;
      return p && !branchEdge && (pairs[pairKey(source, target)] ?? 1) > 1 ? [{ id: edge.id, source, target, ports: p }] : [];
    });
    const lanes = laneOffsets(laneEdges);
    const corridors = new Map<string, { points: Point[]; start: Side; end: Side }>();
    for (const edge of laneEdges) {
      const canonical = edge.source < edge.target;
      const [start, end] = canonical ? [edge.ports.source, edge.ports.target] : [edge.ports.target, edge.ports.source];
      const key = pairKey(edge.source, edge.target);
      let base = corridors.get(key);
      if (!base) {
        // Si hay que rodear cajas, el corredor deja lugar a todos los carriles del par (más aire y salidas más largas).
        const widest = Math.max(
          ...laneEdges.filter((e) => pairKey(e.source, e.target) === key).map((e) => Math.abs(lanes[e.id] ?? 0)),
        );
        const others = obstacles.filter((o) => o.id !== edge.source && o.id !== edge.target).map((o) => o.rect);
        const own =
          (routes[edge.id] && routeAround(edge.ports.source, edge.ports.target, others, undefined, widest)) ??
          defaultRoute(edge.ports.source, edge.ports.target);
        base = { points: canonical ? own : [...own].reverse(), start: start.side, end: end.side };
        corridors.set(key, base);
      }
      // Solo si sale y llega por los mismos lados que el corredor.
      const lane =
        base.start === start.side && base.end === end.side ? laneRoute(base.points, start, end, lanes[edge.id] ?? 0) : null;
      if (lane) routes[edge.id] = canonical ? lane : lane.reverse();
      // Cajas enfrentadas: el corredor es una recta y cada conexión ya va derecha desde su puerto (en su carril).
      else if (base.points.length > 0 && !routes[edge.id]) routes[edge.id] = defaultRoute(edge.ports.source, edge.ports.target);
    }
    // Etiquetas de los pares en carriles: cada una sobre su trazo, sin pisar otras etiquetas ni cajas; si no hay
    // lugar, una etiqueta compuesta (spec conexiones-ida-y-vuelta, tarea 2).
    const displayOf = (edge: (typeof visible)[number]['edge']) => {
      const branch = edge.branch ? graphNodes[edge.from]?.branches?.find((b) => b.id === edge.branch) : undefined;
      const targetNode = graphNodes[edge.to];
      // Hacia la interfaz de un módulo: su contrato (método y ruta de su caja) o, sin él, su nombre.
      const toIface = interfaceTarget(targetNode, edge.toInterface, catalog.modules);
      const fromIface = interfaceTarget(graphNodes[edge.from], edge.fromInterface, catalog.modules);
      const viaInterface = toIface ?? (edge.kind === 'response' ? undefined : fromIface);
      return edgeDisplay(edge, {
        branchLabel: branch?.label,
        targetHttp: viaInterface
          ? viaInterface.method || viaInterface.path
            ? { method: viaInterface.method, path: viaInterface.path }
            : undefined
          : targetNode && (refTarget(targetNode, catalog.items)?.http ?? targetNode.http),
        interfaceName: viaInterface?.name ?? edge.toInterface?.name ?? (edge.kind === 'response' ? undefined : edge.fromInterface?.name),
      });
    };
    const pairLabels: Record<string, PlacedLabel> = {};
    const takenLabels: Rect[] = [];
    const laneGroups = new Map<string, typeof laneEdges>();
    for (const e of laneEdges) {
      if (!routes[e.id]) continue;
      const key = pairKey(e.source, e.target);
      laneGroups.set(key, [...(laneGroups.get(key) ?? []), e]);
    }
    for (const list of laneGroups.values()) {
      // Primero la solicitud (así la compuesta se lee «llama ⇄ responde»), después por carril.
      const isResponse = (id: string) => (graphEdges[id]?.kind === 'response' ? 1 : 0);
      const ordered = [...list].sort((a, b) => isResponse(a.id) - isResponse(b.id) || (lanes[a.id] ?? 0) - (lanes[b.id] ?? 0));
      const items = ordered.map((e) => ({
        id: e.id,
        points: routes[e.id]!,
        size: (() => {
          const d = displayOf(graphEdges[e.id]!);
          return labelSize(edgeDisplayText(d), { step: flowSteps.has(e.id), code: d.code !== undefined });
        })(),
      }));
      const placedHere = placePairLabels(items, obstacles.map((o) => o.rect), takenLabels);
      for (const item of items) {
        const at = placedHere[item.id]!;
        pairLabels[item.id] = at;
        takenLabels.push({ x: at.x - item.size.w / 2, y: at.y - item.size.h / 2, w: item.size.w, h: item.size.h });
      }
    }
    // Etiquetas de las conexiones de un mismo par: cada una queda cerca de la altura de sus puertos, pero al menos a
    // LABEL_GAP de la anterior (con cajas bajas los puertos quedan más juntos que lo que mide una etiqueta).
    const labelShift = new Map<string, number>();
    const byPair: Record<string, { id: string; y: number }[]> = {};
    for (const { edge, source, target } of visible) {
      const p = ports[edge.id];
      if (!p || (pairs[pairKey(source, target)] ?? 1) < 2 || pairLabels[edge.id]) continue;
      (byPair[pairKey(source, target)] ??= []).push({ id: edge.id, y: (p.source.y + p.target.y) / 2 });
    }
    for (const list of Object.values(byPair)) {
      const sorted = [...list].sort((a, b) => a.y - b.y);
      const placed: number[] = [];
      for (const [i, item] of sorted.entries()) placed.push(i === 0 ? item.y : Math.max(item.y, placed[i - 1]! + LABEL_GAP));
      const drift = (placed.reduce((a, b) => a + b, 0) - sorted.reduce((a, b) => a + b.y, 0)) / sorted.length;
      sorted.forEach((item, i) => labelShift.set(item.id, placed[i]! - drift - item.y));
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
      const branch = edge.branch ? graphNodes[edge.from]?.branches?.find((b) => b.id === edge.branch) : undefined;
      const display = displayOf(edge);
      const step = preview ? preview.ids.indexOf(edge.id) : -1;
      const flowBadge = flowSteps.get(edge.id)?.map((i) => i + 1).join('·');
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
          labelOffset: labelShift.get(edge.id) ?? lane * Math.max(0, LABEL_GAP - gap),
          laneOffset: lane * gap,
          backward,
          bendX: count === 1 ? (bends.get(edge.id) ?? staggered[edge.id]?.x) : undefined,
          bendY: count === 1 ? staggered[edge.id]?.y : undefined,
          route: routes[edge.id],
          labelAt: pairLabels[edge.id],
          ports: ports[edge.id] && {
            source: branch && source === edge.from ? undefined : ports[edge.id]!.source,
            target: ports[edge.id]!.target,
          },
          step: step >= 0 && preview!.ids.length > 1 ? String(step + 1) : flowBadge,
        },
        selected: selectedEdges.has(edge.id),
        className: preview
          ? step < 0
            ? 'edge-preview-dim'
            : edge.id === previewId
              ? 'edge-preview edge-preview-active'
              : 'edge-preview'
          : [playing && !flowPlaying ? tourClass(edge.from, edge.to) : flowClass(edge.id), flash === edge.id && 'locate-flash']
              .filter(Boolean)
              .join(' ') || undefined,
      };
    });
  }, [
    graphEdges,
    graphNodes,
    stickyNotes,
    boxOf,
    hierarchy,
    flowSteps,
    flowPlaying,
    currentEdge,
    pickFrom,
    flash,
    catalog.items,
    catalog.modules,
    collapsedGroups,
    selectedEdges,
    playing,
    tourNodeId,
    nextTourNodeId,
    preview,
    previewId,
  ]);

  /**
   * Grupo visible y desplegado que contiene el punto (el más chico si hay varios), para incluir algo al soltarlo.
   * Con `movingId`, descarta los grupos donde no puede entrar: él mismo y sus descendientes (sin ciclos).
   */
  const groupAt = useCallback(
    (point: Position, movingId?: string) => {
      let found: { id: string; area: number } | null = null;
      for (const group of Object.values(groups)) {
        const box = layout[group.id];
        if (!box?.w || !box.h || collapsedGroups.has(group.id) || isHidden(hierarchy, group.id, collapsedGroups)) continue;
        if (movingId && !canNest(hierarchy, movingId, group.id)) continue;
        const inside = point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h;
        if (inside && (!found || box.w * box.h < found.area)) found = { id: group.id, area: box.w * box.h };
      }
      return found?.id ?? null;
    },
    [groups, layout, collapsedGroups, hierarchy],
  );

  /** Ruta de un grupo para leer la pertenencia: «AWS › microservicio usuarios». */
  const groupPath = useCallback(
    (id: string) => [...ancestorsOf(hierarchy, id).reverse(), id].map((g) => `«${groups[g]?.title ?? ''}»`).join(' › '),
    [hierarchy, groups],
  );
  const itemTitle = useCallback(
    (id: string) => groups[id]?.title ?? graphNodes[id]?.title ?? (stickyNotes[id] ? 'La nota' : ''),
    [groups, graphNodes, stickyNotes],
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
      // Si se arrastran a la vez un grupo y algo de dentro, lo de dentro ya lo mueve el grupo.
      const draggedGroups = changes.flatMap((c) => (c.type === 'position' && c.dragging && c.id in groups ? [c.id] : []));
      for (const change of changes) {
        const isGroup = change.type !== 'add' && change.id in groups;
        const isNote = change.type !== 'add' && change.id in stickyNotes;
        if (change.type === 'position' && change.position) {
          if (change.dragging && draggedGroups.some((g) => isInside(hierarchy, change.id, g))) continue;
          if (isNote) moveStickyNote(change.id, change.position);
          else if (!isGroup) moveNode(change.id, change.position);
          // Arrastrar un grupo mueve sus nodos; redimensionarlo desde arriba o la izquierda solo mueve la caja.
          else if (change.dragging) moveGroup(change.id, change.position);
          else {
            const box = layout[change.id];
            if (box?.w && box.h) resizeGroup(change.id, { x: change.position.x, y: change.position.y, w: box.w, h: box.h });
          }
        }
        if (change.type === 'dimensions' && change.resizing && change.dimensions && graphNodes[change.id]?.type === 'module') {
          resizeNode(change.id, { w: change.dimensions.width });
        }
        if (change.type === 'dimensions' && isGroup && change.resizing && change.dimensions) {
          const box = layout[change.id];
          if (box) resizeGroup(change.id, { x: box.x, y: box.y, w: change.dimensions.width, h: change.dimensions.height });
          continue;
        }
        if (change.type === 'remove') {
          if (isGroup) removeGroup(change.id);
          else if (isNote) removeStickyNote(change.id);
          else {
            warnAffectedFlows(Object.values(graphEdges).filter((e) => e.from === change.id || e.to === change.id).map((e) => e.id));
            warnRemovedInterfaces(change.id);
            removeNode(change.id);
          }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [moveNode, removeNode, groups, stickyNotes, layout, moveGroup, resizeGroup, removeGroup, moveStickyNote, removeStickyNote, hierarchy, graphEdges, graphNodes, resizeNode, moduleInterfaces],
  );

  /** Al borrar conexiones usadas en recorridos, avisa qué recorridos revisar (el paso queda marcado en el editor). */
  /** Borrar una caja que expone interfaces del módulo las quita: se avisa (Ctrl+Z las recupera). */
  function warnRemovedInterfaces(nodeId: string) {
    const gone = Object.values(moduleInterfaces).filter((i) => i.nodeId === nodeId);
    if (gone.length === 0) return;
    const names = gone.map((i) => `«${i.name}»`).join(', ');
    const uses = catalog.currentModuleId ? (catalog.modules?.[catalog.currentModuleId]?.usedBy.length ?? 0) : 0;
    setNotice(
      `Se quitó ${gone.length === 1 ? 'la interfaz' : 'las interfaces'} ${names}${uses > 0 ? `: las conexiones de las features que la usan quedarán pendientes al guardar` : ''}. Ctrl+Z la recupera.`,
    );
  }

  function warnAffectedFlows(edgeIds: readonly string[]) {
    const affected = Object.values(tours).filter((t) => t.steps.some((step) => step.edgeId && edgeIds.includes(step.edgeId)));
    if (affected.length === 0) return;
    setNotice(
      `La conexión se usaba en ${affected.map((t) => `«${t.name}»`).join(', ')}: revisa el paso marcado en Tours.`,
    );
  }

  /**
   * A qué grupo iría cada elemento arrastrado al soltarlo (criterio 18; parte 1): una caja o nota por su centro, un
   * grupo por su asa. Solo cuentan los de más afuera: lo que está dentro de un grupo arrastrado viaja con él.
   */
  const dropTargets = useCallback(
    (dragged: { id: string }[]) => {
      const ids = dragged.map((d) => d.id);
      const roots = ids.filter((id) => !ids.some((other) => other !== id && groups[other] && isInside(hierarchy, id, other)));
      return roots.flatMap((id) => {
        const box = layout[id];
        if (!box) return [];
        const point = groups[id] ? { x: box.x + GROUP_GRIP.x, y: box.y + GROUP_GRIP.y } : centerOf(id);
        if (!point) return [];
        return [{ id, target: groupAt(point, id), current: ownerOf(hierarchy, id) }];
      });
    },
    [groups, hierarchy, layout, centerOf, groupAt],
  );

  // Mientras se arrastra se indica dónde quedará: el grupo destino se resalta y la pista lo dice.
  const onNodeDrag = useCallback(
    (_: unknown, __: unknown, dragged: { id: string }[]) => {
      const moves = dropTargets(dragged).filter((m) => m.target !== m.current);
      const first = moves[0];
      const more = moves.length > 1 ? ` y ${moves.length - 1} más` : '';
      const next = first
        ? {
            groupId: first.target,
            text: first.target
              ? `Suelta para meter «${itemTitle(first.id)}»${more} en ${groupPath(first.target)}`
              : `Suelta para sacar «${itemTitle(first.id)}»${more} de «${groups[first.current!]?.title ?? ''}»`,
          }
        : null;
      setDropHint((current) => (current?.text === next?.text ? current : next));
    },
    [dropTargets, itemTitle, groupPath, groups],
  );

  // Soltar dentro de un grupo lo incluye; soltarlo fuera lo saca (criterio 18). Vale para cajas, notas y grupos.
  // Un arrastre (y lo que pasa al soltar: meter en un grupo, agrandarlo) es un solo paso de deshacer. El lote se
  // cierra al soltar; si React Flow no avisara el fin, lo cierra el `pointerup` de la ventana.
  const dragBatch = useRef(false);
  const finishDrag = useCallback(() => {
    if (!dragBatch.current) return;
    dragBatch.current = false;
    endBatch();
  }, [endBatch]);
  const onNodeDragStart = useCallback(() => {
    if (dragBatch.current) return;
    dragBatch.current = true;
    beginBatch();
    window.addEventListener('pointerup', () => setTimeout(finishDrag, 0), { once: true });
  }, [beginBatch, finishDrag]);

  const onNodeDragStop = useCallback(
    (_: unknown, __: unknown, dragged: { id: string }[]) => {
      setDropHint(null);
      const moves = dropTargets(dragged);
      const moved = moves.filter((m) => m.target !== m.current && setParent(m.id, m.target));
      // Lo que queda dentro de un grupo (recién metido o movido dentro) no sobresale: el grupo crece si hace falta.
      for (const m of moves) {
        const owner = moved.includes(m) ? m.target : m.current;
        const box = fullBoxOf(m.id);
        if (owner && box) growGroup(owner, box);
      }
      const first = moved[0];
      if (first) {
        setNotice(
          first.target
            ? `«${itemTitle(first.id)}» quedó dentro de ${groupPath(first.target)}`
            : `«${itemTitle(first.id)}» quedó fuera de los grupos`,
        );
      }
      finishDrag();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dropTargets, setParent, itemTitle, groupPath, growGroup, finishDrag, layout, measured, groups],
  );

  /** Mete `id` en `groupId` (o lo saca) y agranda el grupo si queda afuera de su caja: desde el inspector. */
  const nest = useCallback(
    (id: string, groupId: string | null) => {
      if (!setParent(id, groupId)) return;
      const box = fullBoxOf(id);
      if (groupId && box) growGroup(groupId, box);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setParent, growGroup, layout, measured, groups],
  );

  /** Deshacer / rehacer (Ctrl+Z, Ctrl+Mayús+Z o Ctrl+Y, y los botones junto al zoom); la pista lo confirma. */
  const step = useCallback(
    (direction: 'undo' | 'redo') => {
      if (direction === 'undo' ? !canUndo : !canRedo) return;
      if (direction === 'undo') undo();
      else redo();
      setPreview(null);
      setEditingId(null);
      setNotice(direction === 'undo' ? 'Deshecho' : 'Rehecho');
    },
    [canUndo, canRedo, undo, redo],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<WalkieFlowEdge>[]) => {
      for (const change of changes) {
        if (change.type === 'remove') {
          warnAffectedFlows([change.id]);
          removeEdge(change.id);
          setSelectedEdges((s) => toggle(s, change.id, false));
        }
        if (change.type === 'select') setSelectedEdges((s) => toggle(s, change.id, change.selected));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [removeEdge, tours],
  );

  /**
   * "Crear recorrido" (parte 3): con las conexiones seleccionadas, en el orden sugerido si la secuencia es única (si no,
   * en el orden en que se seleccionaron). Se abre en el editor de Tours para nombrarlo, revisarlo y ordenarlo.
   */
  const createFlow = useCallback(
    (edgeIds: readonly string[]) => {
      const order = suggestOrder(edgeIds, graphEdges) ?? [...edgeIds];
      const names = new Set(Object.values(tours).map((t) => t.name));
      let n = Object.values(tours).filter(isFlowTour).length + 1;
      while (names.has(`Recorrido ${n}`)) n++;
      const id = addFlowTour(`Recorrido ${n}`, order);
      if (!id) return;
      setSelectedNodes(new Set());
      setSelectedEdges(new Set());
      setOpenTourId(id);
      setToursTab('flow');
      setCreatedTourId(id);
      setPickingTourId(null);
      if (!inspectorOpen) {
        setInspectorOpenState(true);
        setInspectorOpen(true);
      }
    },
    [graphEdges, tours, addFlowTour, inspectorOpen],
  );
  const openFlow = useCallback((tourId: string) => {
    setSelectedNodes(new Set());
    setSelectedEdges(new Set());
    setOpenTourId(tourId);
  }, []);

  // El modo de agregar pasos desde el lienzo termina si su recorrido se cierra o desaparece.
  if (pickingTourId && (!tours[pickingTourId] || openTourId !== pickingTourId || playing)) setPickingTourId(null);

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
  // Convertir en módulo necesita la API (crea el módulo y guarda este lienzo a la vez).
  const canExtract = !locked && !!catalog.featureId && !!catalog.modules && !!catalog.appId;

  /**
   * Termina una conexión: un `ref` conecta como su elemento del catálogo (spec catalogo, criterio 9) y el extremo que es
   * un módulo, como la caja interna de su interfaz (spec modulos-compartidos, criterio 12).
   */
  const finishConnect = useCallback(
    (c: Connection, picked: { fromInterface?: InterfaceRef; toInterface?: InterfaceRef }) => {
      const source = graphNodes[c.source];
      const target = graphNodes[c.target];
      const kind =
        source && target
          ? defaultEdgeKind(
              endType(source, picked.fromInterface, catalog.items, catalog.modules),
              endType(target, picked.toInterface, catalog.items, catalog.modules),
              { from: effectiveResource(source, catalog.items)?.kind, to: effectiveResource(target, catalog.items)?.kind },
            )
          : undefined;
      // Desde el punto de una salida de decisión, la conexión nace como esa rama.
      const id = connect(c.source, c.target, kind, { branch: c.sourceHandle, ...picked });
      if (id) {
        setSelectedNodes(new Set());
        setSelectedEdges(new Set([id]));
      }
    },
    [connect, graphNodes, catalog.items, catalog.modules],
  );
  // Conexión soltada sobre (o sacada de) la caja de un módulo: falta elegir la interfaz de cada extremo que lo sea.
  const [pendingConnect, setPendingConnect] = useState<{
    connection: Connection;
    ends: ('from' | 'to')[];
    picked: { fromInterface?: InterfaceRef; toInterface?: InterfaceRef };
    x: number;
    y: number;
  } | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const onConnect = useCallback(
    (c: Connection) => {
      const withInterfaces = (id: string) => {
        const node = graphNodes[id];
        return node?.type === 'module' && (moduleTarget(node, catalog.modules)?.interfaces.length ?? 0) > 0;
      };
      const ends = ([['from', c.source], ['to', c.target]] as const).filter(([, id]) => withInterfaces(id)).map(([end]) => end);
      if (ends.length === 0) return finishConnect(c, {});
      setPendingConnect({ connection: c, ends: [...ends].reverse(), picked: {}, x: pointer.current.x, y: pointer.current.y });
    },
    [graphNodes, catalog.modules, finishConnect],
  );
  const pickInterface = useCallback(
    (choice: InterfaceChoice) => {
      if (!pendingConnect) return;
      const [end, ...rest] = pendingConnect.ends;
      const picked = { ...pendingConnect.picked };
      if (choice) picked[end === 'from' ? 'fromInterface' : 'toInterface'] = { id: choice.id, name: choice.name };
      if (rest.length > 0) setPendingConnect({ ...pendingConnect, ends: rest, picked });
      else {
        setPendingConnect(null);
        finishConnect(pendingConnect.connection, picked);
      }
    },
    [pendingConnect, finishConnect],
  );

  const addAt = useCallback(
    (create: (position: Position) => string, clientX: number, clientY: number) => {
      const position = screenToFlowPosition({ x: clientX, y: clientY });
      const id = create(position);
      // Una caja o nota que cae dentro de un grupo queda en él.
      const group = groupAt({ x: position.x + NODE_SIZE.width / 2, y: position.y + NODE_SIZE.height / 2 });
      if (group && setParent(id, group)) {
        // Una caja nueva aún no está medida: se usa el tamaño mínimo (ya en la grilla, como la guardó el store).
        const at = { x: Math.round(position.x / GRID) * GRID, y: Math.round(position.y / GRID) * GRID };
        growGroup(group, { x: at.x, y: at.y, w: NODE_SIZE.width, h: NODE_SIZE.height });
      }
      setSelectedNodes(new Set([id]));
    },
    [screenToFlowPosition, groupAt, setParent, growGroup],
  );

  /**
   * "Grupo" (criterio 18): con cajas seleccionadas, las rodea y las incluye; si no, uno vacío en el centro.
   */
  function createGroup() {
    // Cajas, notas y grupos seleccionados; lo que ya está dentro de otro seleccionado va con él.
    const picked = [...selectedNodes].filter((id) => (graphNodes[id] || stickyNotes[id] || groups[id]) && layout[id]);
    const members = picked.filter((id) => !picked.some((o) => o !== id && groups[o] && isInside(hierarchy, id, o)));
    let box: Box;
    if (members.length > 0) {
      const rects = members.map((id) => {
        const r = boxOf(id)!;
        return { x: r.x, y: r.y, r: r.x + r.w, b: r.y + r.h };
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
    // El grupo nuevo queda donde estaban sus miembros (dentro de su grupo común, si lo tienen).
    const parentId = commonOwner(hierarchy, members);
    const id = addGroup(box, { members, parentId });
    // El grupo nuevo puede no caber en el que lo contiene: ese crece.
    if (parentId) growGroup(parentId, box);
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
      if (!copy) continue;
      copies.push(copy);
      // La copia queda en el grupo del original, corrida: el grupo crece si sobresale.
      const owner = ownerOf(hierarchy, id);
      const original = boxOf(id);
      if (owner && original) {
        growGroup(owner, { ...original, x: original.x + DUPLICATE_OFFSET, y: original.y + DUPLICATE_OFFSET });
      }
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
    const kind = event.dataTransfer.getData(PALETTE_RESOURCE_MIME) as ResourceKind;
    const module = catalog.modules?.[event.dataTransfer.getData(PALETTE_MODULE_MIME)];
    if (PALETTE_TYPES.includes(type)) addAt((p) => addNode(type, p), event.clientX, event.clientY);
    else if (RESOURCE_KINDS.some((k) => k.kind === kind)) {
      setResourcesOpen(false);
      addAt((p) => addResource(kind, p), event.clientX, event.clientY);
    } else if (item) addAt((p) => addRef(item, p), event.clientX, event.clientY);
    else if (module) addAt((p) => addModuleRef(module, p), event.clientX, event.clientY);
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
      // Ctrl+Z deshace; Ctrl+Mayús+Z o Ctrl+Y rehace. Mientras se escribe, el campo deshace su propio texto.
      if ((event.ctrlKey || event.metaKey) && !event.altKey && ['z', 'y'].includes(event.key.toLowerCase())) {
        if (isTyping(event.target) || locked) return;
        event.preventDefault();
        step(event.key.toLowerCase() === 'z' && !event.shiftKey ? 'undo' : 'redo');
        return;
      }
      // Ctrl+D / Cmd+D duplica lo seleccionado. Mientras se escribe (inspector, título, nota) no hace nada aquí.
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'd') {
        if (isTyping(event.target) || locked) return;
        const ids = [...selectedNodes].filter((id) => graphNodes[id] || stickyNotes[id]);
        if (ids.length === 0) return;
        event.preventDefault();
        duplicate(ids);
        return;
      }
      if (event.key === 'Escape' && (preview || menu || pickingTourId)) {
        setPreview(null);
        setMenu(null);
        setPickingTourId(null);
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target) || playing) return;
      const digit = Number(event.key);
      if (!readOnly && Number.isInteger(digit) && digit >= 1 && digit <= PALETTE_TYPES.length) {
        addAtCenter((p) => addNode(PALETTE_TYPES[digit - 1]!, p));
      } else if (!readOnly && event.key === RESOURCE_KEY) setResourcesOpen((open) => !open);
      else if (event.key === '+' || event.key === '=') void zoomIn();
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

  // Imagen del lienzo (spec exportar-e-importar, tarea 3): la pide el diálogo de «Exportar» con un evento.
  useEffect(
    () =>
      onCanvasImageRequest(async (options) => {
        const root = flowRef.current?.querySelector<HTMLElement>('.react-flow');
        const viewport = root?.querySelector<HTMLElement>('.react-flow__viewport');
        if (!root || !viewport) throw new Error('No hay un lienzo abierto.');
        // Fondo claro siempre (la arena de la interfaz), aunque el sistema esté en modo oscuro.
        const background = getComputedStyle(document.documentElement).getPropertyValue('--sand').trim() || '#f6efe2';
        if (options.scope === 'visible') {
          return captureCanvas(root, options, { width: root.clientWidth, height: root.clientHeight }, background);
        }
        const visible = getNodes().filter((n) => !n.hidden);
        if (visible.length === 0) throw new Error('El lienzo está vacío.');
        return captureCanvas(viewport, options, framing(getNodesBounds(visible)), background);
      }),
    [getNodes, getNodesBounds],
  );

  useEffect(() => {
    const open = () => setHelpOpen(true);
    window.addEventListener(OPEN_HELP_EVENT, open);
    return () => window.removeEventListener(OPEN_HELP_EVENT, open);
  }, []);

  // Abrir con una caja enfocada (desde el mapa de la app): se centra una vez, cuando ya está medida.
  const focused = useRef(false);
  const focusSize = focusId ? measured[focusId] : undefined;
  useEffect(() => {
    if (focused.current || !focusId || !focusSize || !focusCenter) return;
    const at = layout[focusId];
    if (!at) return;
    focused.current = true;
    void setCenter(at.x + focusSize.width / 2, at.y + focusSize.height / 2, { zoom: 1.1, duration: 300 });
  }, [focusId, focusSize, layout, setCenter, focusCenter]);

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
  // Encuadre del reproductor: la caja del paso activo y la de todo el recorrido (con lo que se ve de cada extremo).
  const unionOf = (ids: readonly string[]): Rect | null => {
    const rects = ids.map((id) => boxOf(visibleEnd(hierarchy, id, collapsedGroups))).filter((r): r is Rect => !!r);
    if (rects.length === 0) return null;
    const x = Math.min(...rects.map((r) => r.x));
    const y = Math.min(...rects.map((r) => r.y));
    return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y };
  };
  // Lo que tapa el inspector (a la derecha, o abajo en pantallas angostas): reproducir y localizar usan el resto.
  const narrowPane = pane.width > 0 && pane.width < 900;
  // En un enlace compartido, el panel de tours ocupa ese mismo lugar.
  const sidePanel = readOnly || inspectorOpen;
  const insets = {
    right: sidePanel && !narrowPane ? 376 : 0,
    bottom: sidePanel && narrowPane ? Math.round(pane.height * 0.45) + 24 : 0,
  };

  /**
   * «Localizar en lienzo» (spec tours-compactos): centra el nodo o la conexión de un paso en el área libre y lo resalta
   * un momento, sin seleccionarlo (el inspector sigue en el tour). Dentro de un grupo plegado, se ve su grupo.
   */
  const locate = (step: TourStep) => {
    const edge = step.edgeId ? graphEdges[step.edgeId] : undefined;
    const ids = edge ? [edge.from, edge.to] : step.nodeId && graphNodes[step.nodeId] ? [step.nodeId] : [];
    const rect = unionOf(ids);
    if (!rect) return;
    const zoom = Math.max(getViewport().zoom, 0.8);
    void setCenter(rect.x + rect.w / 2 + insets.right / 2 / zoom, rect.y + rect.h / 2 + insets.bottom / 2 / zoom, {
      zoom,
      duration: 400,
    });
    setFlash(edge ? edge.id : visibleEnd(hierarchy, ids[0]!, collapsedGroups));
  };

  // Reproducción: el panel muestra el tour con su paso activo; tocar un paso salta a él.
  const playback = playing
    ? {
        tourId: playing.tourId,
        step: playing.step,
        onJump: (index: number) =>
          setPlaying((p) => (p ? (flowPlaying ? goTo(playingTour, p, index) : { ...p, step: index }) : p)),
      }
    : null;

  const flowFrames = { step: flowPlaying ? unionOf(activeIds) : null, all: flowPlaying ? unionOf([...participants]) : null };

  const hint = playing
    ? null
    : dropHint
      ? dropHint.text
      : notice
        ? notice
        : pickingTour
          ? `Agregando pasos a «${pickingTour.name}»: toca una conexión en el lienzo${
              pickFrom ? ` (resaltadas, las que siguen desde «${graphNodes[pickFrom]?.title ?? ''}»)` : ''
            }. Esc termina.`
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
        // Módulos (spec modulos-compartidos): sin el propio ni los que lo contienen (sería un ciclo de contención).
        modules: catalog.modules ? placeableModules(catalog.modules, catalog.currentModuleId) : undefined,
        onAddModule: (module: ModuleSummary) => addAtCenter((p) => addModuleRef(module, p)),
        onCreateModule: catalog.createModule
          ? async (module: { name: string; description?: string }) => {
              const created = await catalog.createModule!(module);
              addAtCenter((p) => addModuleRef(created, p));
            }
          : undefined,
      }
    : undefined;

  return (
    <div
      style={{ '--flow-travel': `${Math.round(FLOW_TIMING.travel / flowSpeed)}ms` } as CSSProperties}
      className={[
        'canvas',
        preview && 'canvas-previewing',
        flowPlaying && 'canvas-flowing',
        pickingTourId && 'canvas-picking',
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
        onPointerMove={(e) => {
          const rect = flowRef.current?.getBoundingClientRect();
          if (rect) pointer.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          // Agregando pasos desde el lienzo: tocar una conexión la suma al recorrido (en vez de seleccionarla).
          onEdgeClick={(_, edge) => {
            if (pickingTourId && !locked) addEdgeStep(pickingTourId, edge.id);
          }}
          // El título de un `ref` se edita en el catálogo; el doble clic en un `portal` abre su destino.
          onNodeDoubleClick={(_, flowNode) => {
            if (locked) return;
            if (stickyNotes[flowNode.id]) return setEditingId(flowNode.id);
            const node = graphNodes[flowNode.id];
            if (!node || node.type === 'ref') return;
            // Doble clic en la caja de un módulo abre su lienzo (spec modulos-compartidos, criterio 19).
            if (node.type === 'module') {
              if (node.moduleId && catalog.modules?.[node.moduleId]) openModule(node.moduleId, { nodeId: node.id });
              return;
            }
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
          // Cualquier punto de una caja empieza o termina una conexión (spec puertos-de-conexion).
          connectionMode={ConnectionMode.Loose}
          // Seleccionar un grupo no lo sube por encima de lo que contiene (taparía los grupos y cajas de dentro).
          elevateNodesOnSelect={false}
          // Mayús, Ctrl o Cmd + clic suman cajas (para agruparlas con G) o conexiones (para crear un recorrido).
          multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
          connectOnClick={false}
          snapToGrid
          snapGrid={[GRID, GRID]}
          deleteKeyCode={locked ? null : ['Delete', 'Backspace']}
          nodesDraggable={!locked}
          nodesConnectable={!locked}
          elementsSelectable={!locked && !pickingTourId}
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
            resources={{
              open: resourcesOpen,
              onOpenChange: setResourcesOpen,
              onPick: (kind) => addAtCenter((p) => addResource(kind, p)),
            }}
            catalog={paletteCatalog}
          />
        )}
        <EdgeMarkers />
        {pendingConnect &&
          (() => {
            const end = pendingConnect.ends[0]!;
            const node = graphNodes[end === 'from' ? pendingConnect.connection.source : pendingConnect.connection.target];
            const module = node && moduleTarget(node, catalog.modules);
            if (!module) return null;
            return (
              <InterfacePicker
                key={end}
                module={module}
                end={end}
                x={pendingConnect.x + 12}
                y={pendingConnect.y + 12}
                onPick={pickInterface}
                onCancel={() => setPendingConnect(null)}
              />
            );
          })()}
        {!playing && (
          <ZoomControls
            fitPadding={fitPadding}
            motion={{ on: edgeMotion, onToggle: toggleEdgeMotion }}
            history={
              readOnly
                ? undefined
                : { canUndo, canRedo, onUndo: () => step('undo'), onRedo: () => step('redo') }
            }
          />
        )}
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
                : graphNodes[menu.id]?.type === 'ref' ||
                    graphNodes[menu.id]?.type === 'portal' ||
                    graphNodes[menu.id]?.type === 'module'
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
        {!locked && !pickingTourId && liveEdges.length > 1 && liveNodes.length + liveGroups.length + liveNotes.length === 0 && (
          <div className="selection-bar floating" role="toolbar" aria-label="Conexiones seleccionadas">
            <span>
              <strong>{liveEdges.length}</strong> conexiones seleccionadas
            </span>
            <button type="button" className="pixel-button is-primary" onClick={() => createFlow(liveEdges)}>
              Crear recorrido
            </button>
            <span className="selection-bar-help">Mayús + clic suma o quita</span>
          </div>
        )}
        {canExtract && !pickingTourId && liveNodes.length + liveGroups.length + liveNotes.length >= 2 && (
          <div className="selection-bar floating" role="toolbar" aria-label="Cajas seleccionadas">
            <span>
              <strong>{liveNodes.length + liveGroups.length + liveNotes.length}</strong> elementos seleccionados
            </span>
            <button type="button" className="pixel-button" onClick={() => setExtracting([...liveGroups, ...liveNodes, ...liveNotes])}>
              Convertir en módulo…
            </button>
            <span className="selection-bar-help">G agrupa · Mayús + clic suma o quita</span>
          </div>
        )}
        {extracting && (
          <ExtractModuleDialog
            roots={extracting}
            onClose={() => setExtracting(null)}
            onDone={(moduleNodeId, name) => {
              setExtracting(null);
              setSelectedNodes(new Set([moduleNodeId]));
              setSelectedEdges(new Set());
              setNotice(`Se creó el módulo «${name}». Ctrl+Z devuelve las cajas a este lienzo (el módulo queda en el catálogo).`);
            }}
          />
        )}
        {playing && flowPlaying && (
          <FlowPlayer
            playing={playing}
            setPlaying={setPlaying}
            speed={flowSpeed}
            onSpeed={setFlowSpeedState}
            frames={flowFrames}
            pane={{ width: pane.width - insets.right, height: pane.height - insets.bottom }}
            onExit={() => setPlaying(null)}
          />
        )}
        {playing && !flowPlaying && (
          <TourPlayer
            tourId={playing.tourId}
            step={playing.step}
            sizes={measured}
            pane={pane}
            insets={insets}
            onStep={(step) => setPlaying((p) => p && { ...p, step })}
            onExit={() => setPlaying(null)}
          />
        )}
      </div>
      {readOnly ? (
        <SharedTours onPlay={startTour} ui={toursUi} onUi={setToursUi} onLocate={locate} playback={playback} />
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
            flows={{ onCreate: (edgeId) => createFlow([edgeId]), onOpen: openFlow }}
            onNest={nest}
            onExtract={canExtract ? setExtracting : undefined}
            tours={{
              openTourId,
              onOpen: setOpenTourId,
              tab: toursTab,
              onTab: setToursTab,
              onPlay: startTour,
              createdTourId,
              picking: { tourId: pickingTourId, onToggle: setPickingTourId },
              ui: toursUi,
              onUi: setToursUi,
              onLocate: locate,
              playback,
            }}
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

