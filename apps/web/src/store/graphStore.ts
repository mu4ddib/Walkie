import { createStore, type StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { v7 as uuidv7 } from 'uuid';
import type { Edge, Node, WalkieCanvasGraphV0 } from '../schema/walkie-graph';
import { GRID } from '../theme/palette';

export type NodeType = Node['type'];
export type EdgeKind = Edge['kind'];
export type Position = { x: number; y: number };

/** Máximo del schema para `title`. */
export const TITLE_MAX_LENGTH = 120;

/** Títulos por defecto al crear un nodo desde la paleta. */
export const DEFAULT_TITLES: Record<NodeType, string> = {
  screen: 'Pantalla',
  api: 'API',
  database: 'Base de datos',
  actor: 'Actor',
  rule: 'Regla',
  service: 'Servicio',
  ref: 'Referencia',
  portal: 'Portal',
};

/** Tipo de conexión por defecto según el par (spec, criterio 5). Otros pares: `uses`. */
export function defaultEdgeKind(from: NodeType, to: NodeType): EdgeKind {
  if (from === 'screen' && to === 'screen') return 'navigation';
  if (from === 'screen' && to === 'api') return 'request';
  if (from === 'api' && to === 'screen') return 'response';
  if (from === 'api' && to === 'database') return 'reads';
  return 'uses';
}

/** Redondea al múltiplo de la grilla (8 px) más cercano. */
export function snap(value: number): number {
  // `+ 0` convierte -0 en 0 (Math.round(-0.4) es -0).
  return Math.round(value / GRID) * GRID + 0;
}

/** Copia de `record` sin la clave `key`. */
function omit<T>(record: Record<string, T>, key: string): Record<string, T> {
  const copy = { ...record };
  delete copy[key];
  return copy;
}

export interface GraphState {
  nodes: Record<string, Node>;
  edges: Record<string, Edge>;
  layout: WalkieCanvasGraphV0['layout'];
  /** Versión guardada en el servidor (concurrencia optimista). */
  version: number;
  /** Hay cambios sin guardar. */
  dirty: boolean;
}

export interface GraphActions {
  loadGraph(graph: WalkieCanvasGraphV0): void;
  addNode(type: NodeType, position: Position): string;
  moveNode(id: string, position: Position): void;
  renameNode(id: string, title: string): void;
  removeNode(id: string): void;
  /** Crea la conexión; `null` si algún nodo no existe o es el mismo nodo. */
  connect(from: string, to: string, kind?: EdgeKind): string | null;
  setEdgeKind(id: string, kind: EdgeKind): void;
  removeEdge(id: string): void;
  /** Tras un guardado exitoso: adopta la versión del servidor y limpia `dirty`. */
  markSaved(version: number): void;
}

export type GraphStore = GraphState & GraphActions;

const emptyState: GraphState = { nodes: {}, edges: {}, layout: {}, version: 0, dirty: false };

/**
 * Store del grafo de un lienzo. Única vía para cambiarlo (CLAUDE.md): los componentes
 * solo llaman acciones. Estado normalizado por ID para poder migrar a Yjs (`Y.Map`).
 */
export function createGraphStore(newId: () => string = uuidv7): StoreApi<GraphStore> {
  return createStore<GraphStore>()((set, get) => ({
    ...emptyState,

    loadGraph: (graph) =>
      set({ nodes: graph.nodes, edges: graph.edges, layout: graph.layout, version: graph.version, dirty: false }),

    addNode: (type, position) => {
      const id = newId();
      set((s) => ({
        nodes: { ...s.nodes, [id]: { id, type, title: DEFAULT_TITLES[type] } },
        layout: { ...s.layout, [id]: { x: snap(position.x), y: snap(position.y) } },
        dirty: true,
      }));
      return id;
    },

    moveNode: (id, position) => {
      const current = get().layout[id];
      if (!get().nodes[id]) return;
      const x = snap(position.x);
      const y = snap(position.y);
      if (current && current.x === x && current.y === y) return;
      set((s) => ({ layout: { ...s.layout, [id]: { ...current, x, y } }, dirty: true }));
    },

    renameNode: (id, title) => {
      const node = get().nodes[id];
      const clean = title.trim().slice(0, TITLE_MAX_LENGTH);
      if (!node || clean.length === 0 || clean === node.title) return;
      set((s) => ({ nodes: { ...s.nodes, [id]: { ...node, title: clean } }, dirty: true }));
    },

    removeNode: (id) => {
      if (!get().nodes[id]) return;
      set((s) => {
        const nodes = omit(s.nodes, id);
        const layout = omit(s.layout, id);
        const edges = Object.fromEntries(Object.entries(s.edges).filter(([, e]) => e.from !== id && e.to !== id));
        return { nodes, layout, edges, dirty: true };
      });
    },

    connect: (from, to, kind) => {
      const { nodes } = get();
      const source = nodes[from];
      const target = nodes[to];
      if (!source || !target || from === to) return null;
      const id = newId();
      const edge: Edge = { id, from, to, kind: kind ?? defaultEdgeKind(source.type, target.type) };
      set((s) => ({ edges: { ...s.edges, [id]: edge }, dirty: true }));
      return id;
    },

    setEdgeKind: (id, kind) => {
      const edge = get().edges[id];
      if (!edge || edge.kind === kind) return;
      set((s) => ({ edges: { ...s.edges, [id]: { ...edge, kind } }, dirty: true }));
    },

    removeEdge: (id) => {
      if (!get().edges[id]) return;
      set((s) => ({ edges: omit(s.edges, id), dirty: true }));
    },

    markSaved: (version) => set({ version, dirty: false }),
  }));
}

/** Grafo listo para `PUT /api/features/{id}/canvas`. */
export function toGraph(state: GraphState): WalkieCanvasGraphV0 {
  return { schemaVersion: 0, version: state.version, nodes: state.nodes, edges: state.edges, layout: state.layout };
}

/** Hook para leer el store desde componentes. */
export function useGraph<T>(store: StoreApi<GraphStore>, selector: (s: GraphStore) => T): T {
  return useStore(store, selector);
}
