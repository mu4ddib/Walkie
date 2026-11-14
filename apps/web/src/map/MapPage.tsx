import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  useStore,
  type NodeChange,
} from '@xyflow/react';
import { useCameraController } from '../canvas/useCamera';
import '@xyflow/react/dist/style.css';
import { Link, useNavigate, useParams } from 'react-router';
import { ApiError, type Feature } from '../api/client';
import { useApp, useAppMap, useFeatures, useSaveMapLayout } from '../api/hooks';
import { ZoomControls } from '../canvas/ZoomControls';
import { isTyping } from '../canvas/canvasShortcuts';
import { EdgeMarkers } from '../edges/EdgeMarkers';
import { computePorts, staggerBends, type Rect } from '../edges/ports';
import { routeAround } from '../edges/route';
import type { NodeType } from '../store/graphStore';
import { GRID, palette } from '../theme/palette';
import { QueryState } from '../ui/QueryState';
import { APPS_PATH, appPath, featurePath } from '../workspace/paths';
import { getMapShowShared, setMapShowShared } from '../workspace/session';
import type { CatalogMapFlowNode } from './CatalogMapNode';
import type { FeatureMapFlowNode } from './FeatureMapNode';
import type { MapFlowEdge } from './MapEdge';
import { MapPanel } from './MapPanel';
import { CATALOG_BOX, FEATURE_BOX, autoLayout, catalogKey, mergeLayout, type Point } from './mapLayout';
import { linkKey, plural, type MapSelection } from './mapText';
import { mapEdgeTypes, mapNodeTypes } from './mapTypes';
import '../canvas/canvas.css';
import '../panel/panel.css';
import './map.css';

const FIT_PADDING = { top: '96px', right: '360px', bottom: '72px', left: '48px' } as const;
const sizeOf = (key: string) => (key.startsWith('catalog:') ? CATALOG_BOX : FEATURE_BOX);

/**
 * Mapa de la app (spec mapa-de-la-app): una vista adicional a la galería. Cada feature es una caja; los portales, flechas
 * entre ellas; con el interruptor, los componentes del catálogo que comparten. Solo lectura del contenido: se mira,
 * se acomoda y se abre cada lienzo.
 */
export function MapPage() {
  const { appId = '' } = useParams();
  const app = useApp(appId);
  const features = useFeatures(appId);
  const map = useAppMap(appId);

  return (
    <div className="map-page">
      <header className="map-bar">
        <Link to="/" className="map-brand">
          Walkie
        </Link>
        <nav className="breadcrumb" aria-label="Ruta">
          <Link to={APPS_PATH}>Apps</Link>
          {app.data && (
            <>
              <span> / </span>
              <Link to={appPath(appId)}>{app.data.name}</Link>
            </>
          )}
          <span> / Mapa</span>
        </nav>
      </header>
      {map.data && features.data && app.data ? (
        <ReactFlowProvider>
          <MapCanvas appId={appId} map={map.data} features={features.data} />
        </ReactFlowProvider>
      ) : (
        <div className="map-state">
          <QueryState
            isPending={app.isPending || features.isPending || map.isPending}
            error={app.error ?? features.error ?? map.error}
            notFound="Esta app no existe."
          />
        </div>
      )}
    </div>
  );
}

function MapCanvas({ appId, map, features }: { appId: string; map: NonNullable<ReturnType<typeof useAppMap>['data']>; features: Feature[] }) {
  const navigate = useNavigate();
  const save = useSaveMapLayout(appId);
  const { zoomIn, zoomOut } = useReactFlow();
  const camera = useCameraController();
  // Al mostrar u ocultar compartidos aparecen o se van cajas: se encuadra cuando React Flow ya las midió (no tras un
  // tiempo fijo).
  const initialized = useNodesInitialized();
  const lookupSize = useStore((s) => s.nodeLookup.size);
  const pendingFit = useRef(false);

  const [showShared, setShowShared] = useState(getMapShowShared);
  const [selection, setSelection] = useState<MapSelection | null>(null);
  // Posiciones mientras se arrastra (aún sin guardar).
  const [moving, setMoving] = useState<Record<string, Point>>({});
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  // Atajos de vista, los mismos que en el lienzo de una feature: 0 ve todo, + y − acercan y alejan; Esc quita la
  // selección. No mientras se escribe ni con Ctrl/Cmd/Alt.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return;
      if (event.key === '0') void camera.fit(FIT_PADDING);
      else if (event.key === '+' || event.key === '=') void zoomIn();
      else if (event.key === '-') void zoomOut();
      else if (event.key === 'Escape') setSelection(null);
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [camera, zoomIn, zoomOut]);

  const byId = useMemo(() => new Map(features.map((f) => [f.id, f])), [features]);
  const ordered = useMemo(
    () => [...features].sort((a, b) => a.name.localeCompare(b.name, 'es')).map((f) => f.id),
    [features],
  );
  const summaries = useMemo(() => new Map(map.features.map((f) => [f.id, f])), [map.features]);
  const shared = useMemo(() => map.catalog.filter((c) => c.features.length > 1), [map.catalog]);
  const shownShared = useMemo(() => (showShared ? shared : []), [showShared, shared]);

  // Distribución: la guardada manda; lo que no tiene posición se ubica solo sin encimarse.
  const positions = useMemo(() => {
    const auto = autoLayout(
      ordered,
      map.links,
      Object.fromEntries(shownShared.map((c) => [c.itemId, c.features])),
    );
    return { ...mergeLayout(map.layout.positions, auto, sizeOf), ...moving };
  }, [ordered, map.links, map.layout.positions, shownShared, moving]);

  // Lo que se resalta con la selección: la feature, sus vecinas y sus componentes; o los extremos de una conexión.
  const focus = useMemo(() => {
    if (!selection) return null;
    const ids = new Set<string>();
    if (selection.kind === 'feature') {
      ids.add(selection.id);
      for (const l of map.links) if (l.from === selection.id || l.to === selection.id) ids.add(l.from).add(l.to);
      for (const c of shownShared) if (c.features.includes(selection.id)) ids.add(catalogKey(c.itemId));
    } else if (selection.kind === 'link') {
      const [from, to] = selection.id.split('>');
      ids.add(from!).add(to!);
    } else {
      const item = shownShared.find((c) => c.itemId === selection.id);
      ids.add(catalogKey(selection.id));
      for (const f of item?.features ?? []) ids.add(f);
    }
    return ids;
  }, [selection, map.links, shownShared]);

  const nodes = useMemo<(FeatureMapFlowNode | CatalogMapFlowNode)[]>(() => {
    const dim = (id: string) => (focus && !focus.has(id) ? 'map-dim' : undefined);
    const featureNodes: FeatureMapFlowNode[] = ordered.map((id) => {
      const feature = byId.get(id)!;
      return {
        id,
        type: 'feature',
        position: positions[id] ?? { x: 0, y: 0 },
        width: FEATURE_BOX.w,
        height: FEATURE_BOX.h,
        data: {
          name: feature.name,
          description: feature.description,
          updatedAt: feature.updatedAt,
          summary: summaries.get(id) ?? { id, screens: 0, apis: 0, tours: 0, flows: 0, unresolvedPortals: 0 },
        },
        selected: selection?.kind === 'feature' && selection.id === id,
        className: dim(id),
      };
    });
    const catalogNodes: CatalogMapFlowNode[] = shownShared.map((c) => ({
      id: catalogKey(c.itemId),
      type: 'catalog',
      position: positions[catalogKey(c.itemId)] ?? { x: 0, y: 0 },
      width: CATALOG_BOX.w,
      height: CATALOG_BOX.h,
      data: { title: c.title, type: c.type as NodeType, users: c.features.length },
      selected: selection?.kind === 'catalog' && selection.id === c.itemId,
      className: dim(catalogKey(c.itemId)),
    }));
    return [...featureNodes, ...catalogNodes];
  }, [ordered, byId, positions, summaries, shownShared, selection, focus]);

  const edges = useMemo<MapFlowEdge[]>(() => {
    const rects: Record<string, Rect> = {};
    for (const n of nodes) rects[n.id] = { x: n.position.x, y: n.position.y, w: n.width!, h: n.height! };
    const list = [
      ...map.links.map((l) => ({
        id: linkKey(l.from, l.to),
        source: l.from,
        target: l.to,
        variant: 'portal' as const,
        label:
          l.portals.length > 1
            ? plural(l.portals.length, 'portal', 'portales')
            : l.portals[0]!.sources.length
              ? `desde ${l.portals[0]!.sources.join(', ')}`
              : 'portal',
      })),
      ...shownShared.flatMap((c) =>
        c.features.map((f) => ({
          id: `uses:${f}:${c.itemId}`,
          source: f,
          target: catalogKey(c.itemId),
          variant: 'uses' as const,
          label: undefined,
        })),
      ),
    ].filter((e) => rects[e.source] && rects[e.target]);
    const ports = computePorts(list, rects);
    const bends = staggerBends(
      list.flatMap((e) => (ports[e.id] ? [{ id: e.id, box: e.source, source: ports[e.id]!.source, target: ports[e.id]!.target }] : [])),
    );
    const touches = (e: (typeof list)[number]) =>
      selection?.kind === 'feature'
        ? e.source === selection.id || e.target === selection.id
        : selection?.kind === 'link'
          ? e.id === selection.id
          : selection?.kind === 'catalog'
            ? e.target === catalogKey(selection.id)
            : true;
    return list.map((e) => {
      const p = ports[e.id];
      const others = Object.entries(rects)
        .filter(([id]) => id !== e.source && id !== e.target)
        .map(([, r]) => r);
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'map',
        selected: selection?.kind === 'link' && selection.id === e.id,
        selectable: e.variant === 'portal',
        className: focus && !touches(e) ? 'map-dim' : undefined,
        data: {
          variant: e.variant,
          label: e.label,
          ports: p,
          route: p ? (routeAround(p.source, p.target, others, bends[e.id]) ?? undefined) : undefined,
        },
      };
    });
  }, [nodes, map.links, shownShared, selection, focus]);

  /** Guarda la distribución: lo visible donde está, y lo que no se ve (componentes ocultos) donde estaba. */
  const persist = useCallback(
    (next: Record<string, Point>) => {
      save.mutate(
        { version: map.layout.version, positions: next },
        {
          onSuccess: () => setMoving({}),
          onError: (error) => {
            setMoving({});
            setNotice(
              error instanceof ApiError && error.status === 409
                ? 'Alguien más acomodó el mapa: se muestra su versión.'
                : 'No se pudo guardar la distribución.',
            );
          },
        },
      );
    },
    [save, map.layout.version],
  );
  // Encuadra cuando React Flow ya tiene y midió exactamente las cajas que se muestran ahora.
  useEffect(() => {
    if (!pendingFit.current || !initialized || lookupSize !== nodes.length) return;
    pendingFit.current = false;
    void camera.fit(FIT_PADDING);
  }, [initialized, lookupSize, nodes.length, camera]);


  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          const at = { x: Math.round(change.position.x / GRID) * GRID, y: Math.round(change.position.y / GRID) * GRID };
          setMoving((m) => ({ ...m, [change.id]: at }));
        }
        if (change.type === 'select' && change.selected) {
          setSelection(
            change.id.startsWith('catalog:')
              ? { kind: 'catalog', id: change.id.slice('catalog:'.length) }
              : { kind: 'feature', id: change.id },
          );
        }
      }
    },
    [],
  );

  const openFeature = (id: string) => navigate(featurePath(appId, id));
  const openPortal = (featureId: string, nodeId: string) =>
    navigate(`${featurePath(appId, featureId)}?select=${encodeURIComponent(nodeId)}`);

  if (features.length === 0) {
    return (
      <div className="map-state">
        <h3>Aún no hay features</h3>
        <p>
          El mapa muestra las features de la app y cómo se conectan. <Link to={appPath(appId)}>Crea la primera</Link> en
          la galería.
        </p>
      </div>
    );
  }

  return (
    <div className="map-canvas">
      <div className="map-tools floating" role="toolbar" aria-label="Mapa">
        <label className="panel-check">
          <input
            type="checkbox"
            checked={showShared}
            onChange={(e) => {
              setShowShared(e.target.checked);
              setMapShowShared(e.target.checked);
              // Aparecen o se van cajas: la vista se ajusta para verlas todas (después de que React Flow las mida).
              pendingFit.current = true;
            }}
          />
          Mostrar componentes compartidos{shared.length > 0 ? ` (${shared.length})` : ''}
        </label>
        <button
          type="button"
          className="pixel-button is-ghost"
          data-tip="Vuelve a la distribución automática"
          onClick={() => {
            setMoving({});
            persist({});
          }}
        >
          Reordenar
        </button>
        <Link className="pixel-button is-ghost" to={appPath(appId)}>
          Ver galería
        </Link>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={mapNodeTypes}
        edgeTypes={mapEdgeTypes}
        onNodesChange={onNodesChange}
        onEdgeClick={(_, edge) => edge.selectable !== false && setSelection({ kind: 'link', id: edge.id })}
        onPaneClick={() => setSelection(null)}
        onNodeDragStop={() => persist({ ...map.layout.positions, ...positions })}
        onNodeDoubleClick={(_, node) => {
          if (node.type === 'feature') openFeature(node.id);
        }}
        nodesConnectable={false}
        deleteKeyCode={null}
        zoomOnDoubleClick={false}
        snapToGrid
        snapGrid={[GRID, GRID]}
        fitView
        fitViewOptions={{ padding: FIT_PADDING }}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={GRID * 3} size={1.5} color={palette.grid} />
      </ReactFlow>
      <EdgeMarkers />
      <ZoomControls onFit={() => void camera.fit(FIT_PADDING)} />
      {notice && (
        <p className="canvas-hint" role="status">
          {notice}
        </p>
      )}
      <MapPanel
        map={map}
        features={byId}
        selection={selection}
        onSelect={setSelection}
        onOpenFeature={openFeature}
        onOpenPortal={openPortal}
      />
    </div>
  );
}
