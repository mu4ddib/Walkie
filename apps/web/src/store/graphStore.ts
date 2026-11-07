import { createStore, type StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { v7 as uuidv7 } from 'uuid';
import type { Edge, Node, WalkieCanvasGraphV0 } from '../schema/walkie-graph';
import { GRID } from '../theme/palette';

export type NodeType = Node['type'];
export type EdgeKind = Edge['kind'];
export type Position = { x: number; y: number };
export type Input = NonNullable<Node['inputs']>[number];
export type InputType = Input['type'];
export type HttpMethod = NonNullable<NonNullable<Node['http']>['method']>;

/** Máximo del schema para `title`. */
export const TITLE_MAX_LENGTH = 120;
/** Máximo del schema para `description` y `expression`. */
export const TEXT_MAX_LENGTH = 2000;
/** Máximo del schema para `input.name` y cada opción de un `enum`. */
export const INPUT_NAME_MAX_LENGTH = 60;
/** Máximo del schema para `edge.label` y `edge.when`. */
export const EDGE_TEXT_MAX_LENGTH = 60;

export const INPUT_TYPES: readonly InputType[] = ['string', 'number', 'boolean', 'date', 'enum', 'file'];
export const HTTP_METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/** Cambios de contenido de un nodo. Un texto vacío quita el campo. */
export interface NodePatch {
  title?: string;
  description?: string;
  expression?: string;
  http?: { method?: HttpMethod | null; path?: string };
}

/** Cambios de un input. `options` solo aplica a `enum`; `ruleIds` solo a nodos `rule` existentes. */
export type InputPatch = Partial<Input>;

/** Cambios de una conexión. Un texto vacío quita el campo. */
export interface EdgePatch {
  kind?: EdgeKind;
  label?: string;
  when?: string;
}

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
  if (from === 'actor' && to === 'screen') return 'navigation';
  if (from === 'api' && to === 'service') return 'request';
  if (from === 'service' && to === 'database') return 'reads';
  // screen→rule y cualquier otro par.
  return 'uses';
}

/** Redondea al múltiplo de la grilla (8 px) más cercano. */
export function snap(value: number): number {
  // `+ 0` convierte -0 en 0 (Math.round(-0.4) es -0).
  return Math.round(value / GRID) * GRID + 0;
}

/** Pone `key` con el texto recortado o la quita si queda vacío. */
function withText<T extends object>(obj: T, key: keyof T & string, value: string | undefined, max: number): T {
  if (value === undefined) return obj;
  const clean = value.trim().slice(0, max);
  const copy = { ...obj } as Record<string, unknown>;
  if (clean.length === 0) delete copy[key];
  else copy[key] = clean;
  return copy as T;
}

/** Igualdad superficial de valores JSON (suficiente para detectar parches sin efecto). */
function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Lista sin vacíos ni repetidos, cada texto recortado. */
function cleanList(values: readonly string[], max: number): string[] {
  return [...new Set(values.map((v) => v.trim().slice(0, max)).filter((v) => v.length > 0))];
}

/**
 * Motivo por el que `name` no sirve como nombre de input en `node` (vacío o repetido);
 * `null` si sirve. `index` es el input que se está renombrando (no choca consigo mismo).
 */
export function inputNameError(node: Node, name: string, index?: number): string | null {
  const clean = name.trim();
  if (clean.length === 0) return 'El nombre no puede quedar vacío.';
  if ((node.inputs ?? []).some((input, i) => i !== index && input.name === clean.slice(0, INPUT_NAME_MAX_LENGTH))) {
    return 'Ya hay un input con ese nombre.';
  }
  return null;
}

/** Primer nombre libre: "campo", "campo 2", "campo 3"… */
function freeInputName(node: Node): string {
  const taken = new Set((node.inputs ?? []).map((i) => i.name));
  if (!taken.has('campo')) return 'campo';
  let n = 2;
  while (taken.has(`campo ${n}`)) n++;
  return `campo ${n}`;
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
  /** Nodo `ref` a un elemento del catálogo; `title` guarda su título como último conocido. */
  addRef(item: { id: string; title: string }, position: Position): string;
  moveNode(id: string, position: Position): void;
  renameNode(id: string, title: string): void;
  /** Título, descripción, expresión y `http` (método y ruta). */
  updateNode(id: string, patch: NodePatch): void;
  /** Agrega un input al final; devuelve su índice o `null` si el nodo no existe o el nombre no sirve. */
  addInput(nodeId: string, input?: InputPatch): number | null;
  /** Devuelve `false` si no se aplicó (nodo o input inexistente, nombre vacío o repetido). */
  updateInput(nodeId: string, index: number, patch: InputPatch): boolean;
  removeInput(nodeId: string, index: number): void;
  /** Borra el nodo, sus conexiones y su `layout`; si es una regla, la quita de los `ruleIds` de los inputs. */
  removeNode(id: string): void;
  /** Crea la conexión; `null` si algún nodo no existe o es el mismo nodo. */
  connect(from: string, to: string, kind?: EdgeKind): string | null;
  setEdgeKind(id: string, kind: EdgeKind): void;
  /** Tipo, etiqueta (`label`) y condición (`when`). */
  updateEdge(id: string, patch: EdgePatch): void;
  removeEdge(id: string): void;
  /**
   * Tras un guardado exitoso: adopta la versión del servidor. Limpia `dirty` solo si el grafo
   * sigue siendo el que se envió (`sent`); si hubo cambios mientras viajaba la petición, siguen pendientes.
   */
  markSaved(version: number, sent?: GraphState): void;
}

export type GraphStore = GraphState & GraphActions;

const emptyState: GraphState = {
  nodes: {},
  edges: {},
  layout: {},
  version: 0,
  dirty: false,
};

/**
 * Store del grafo de un lienzo. Única vía para cambiarlo (CLAUDE.md): los componentes
 * solo llaman acciones. Estado normalizado por ID para poder migrar a Yjs (`Y.Map`).
 */
export function createGraphStore(newId: () => string = uuidv7): StoreApi<GraphStore> {
  return createStore<GraphStore>()((set, get) => {
    /** Reemplaza el nodo si cambió y marca `dirty`. */
    const putNode = (node: Node) => {
      if (sameJson(get().nodes[node.id], node)) return;
      set((s) => ({ nodes: { ...s.nodes, [node.id]: node }, dirty: true }));
    };

    /** Input normalizado: nombre recortado, `options` solo en `enum`, `ruleIds` solo a reglas existentes. */
    const normalizeInput = (input: Input): Input => {
      const { nodes } = get();
      const result: Input = {
        ...input,
        name: input.name.trim().slice(0, INPUT_NAME_MAX_LENGTH),
      };
      const options = result.type === 'enum' ? cleanList(result.options ?? [], INPUT_NAME_MAX_LENGTH) : [];
      if (options.length > 0) result.options = options;
      else delete result.options;
      const ruleIds = [...new Set(result.ruleIds ?? [])].filter((r) => nodes[r]?.type === 'rule');
      if (ruleIds.length > 0) result.ruleIds = ruleIds;
      else delete result.ruleIds;
      if (!result.required) delete result.required;
      return result;
    };

    const withInputs = (node: Node, inputs: Input[]): Node => {
      if (inputs.length > 0) return { ...node, inputs };
      const copy = { ...node };
      delete copy.inputs;
      return copy;
    };

    return {
      ...emptyState,

      loadGraph: (graph) =>
        set({
          nodes: graph.nodes,
          edges: graph.edges,
          layout: graph.layout,
          version: graph.version,
          dirty: false,
        }),

      addNode: (type, position) => {
        const id = newId();
        set((s) => ({
          nodes: {
            ...s.nodes,
            [id]: { id, type, title: DEFAULT_TITLES[type] },
          },
          layout: {
            ...s.layout,
            [id]: { x: snap(position.x), y: snap(position.y) },
          },
          dirty: true,
        }));
        return id;
      },

      addRef: (item, position) => {
      const id = newId();
      const title = item.title.trim().slice(0, TITLE_MAX_LENGTH) || DEFAULT_TITLES.ref;
      set((s) => ({
        nodes: { ...s.nodes, [id]: { id, type: 'ref', title, catalogId: item.id } },
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
        set((s) => ({
          layout: { ...s.layout, [id]: { ...current, x, y } },
          dirty: true,
        }));
      },

      renameNode: (id, title) => {
        const node = get().nodes[id];
        const clean = title.trim().slice(0, TITLE_MAX_LENGTH);
        if (!node || clean.length === 0 || clean === node.title) return;
        set((s) => ({
          nodes: { ...s.nodes, [id]: { ...node, title: clean } },
          dirty: true,
        }));
      },

      updateNode: (id, patch) => {
        const node = get().nodes[id];
        if (!node) return;
        let next = { ...node };
        const title = patch.title?.trim().slice(0, TITLE_MAX_LENGTH);
        if (title) next.title = title;
        next = withText(next, 'description', patch.description, TEXT_MAX_LENGTH);
        next = withText(next, 'expression', patch.expression, TEXT_MAX_LENGTH);
        if (patch.http) {
          let http = { ...next.http };
          if (patch.http.method === null) delete http.method;
          else if (patch.http.method) http.method = patch.http.method;
          http = withText(http, 'path', patch.http.path, TEXT_MAX_LENGTH);
          if (Object.keys(http).length > 0) next.http = http;
          else delete next.http;
        }
        putNode(next);
      },

      addInput: (nodeId, input = {}) => {
        const node = get().nodes[nodeId];
        if (!node) return null;
        const name = input.name ?? freeInputName(node);
        if (inputNameError(node, name)) return null;
        const inputs = [...(node.inputs ?? []), normalizeInput({ type: 'string', ...input, name })];
        putNode(withInputs(node, inputs));
        return inputs.length - 1;
      },

      updateInput: (nodeId, index, patch) => {
        const node = get().nodes[nodeId];
        const current = node?.inputs?.[index];
        if (!node || !current) return false;
        if (patch.name !== undefined && inputNameError(node, patch.name, index)) return false;
        const inputs = [...(node.inputs ?? [])];
        inputs[index] = normalizeInput({ ...current, ...patch });
        putNode(withInputs(node, inputs));
        return true;
      },

      removeInput: (nodeId, index) => {
        const node = get().nodes[nodeId];
        if (!node?.inputs?.[index]) return;
        putNode(
          withInputs(
            node,
            node.inputs.filter((_, i) => i !== index),
          ),
        );
      },

      removeNode: (id) => {
        const removed = get().nodes[id];
        if (!removed) return;
        set((s) => {
          let nodes = omit(s.nodes, id);
          if (removed.type === 'rule') {
            nodes = Object.fromEntries(
              Object.entries(nodes).map(([key, node]) => {
                if (!node.inputs?.some((i) => i.ruleIds?.includes(id))) return [key, node];
                const inputs = node.inputs.map((input) => {
                  const ruleIds = (input.ruleIds ?? []).filter((r) => r !== id);
                  const copy: Input = { ...input, ruleIds };
                  if (ruleIds.length === 0) delete copy.ruleIds;
                  return copy;
                });
                return [key, { ...node, inputs }];
              }),
            );
          }
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
        const edge: Edge = {
          id,
          from,
          to,
          kind: kind ?? defaultEdgeKind(source.type, target.type),
        };
        set((s) => ({ edges: { ...s.edges, [id]: edge }, dirty: true }));
        return id;
      },

      setEdgeKind: (id, kind) => {
        const edge = get().edges[id];
        if (!edge || edge.kind === kind) return;
        set((s) => ({
          edges: { ...s.edges, [id]: { ...edge, kind } },
          dirty: true,
        }));
      },

      updateEdge: (id, patch) => {
        const edge = get().edges[id];
        if (!edge) return;
        let next: Edge = { ...edge, kind: patch.kind ?? edge.kind };
        next = withText(next, 'label', patch.label, EDGE_TEXT_MAX_LENGTH);
        next = withText(next, 'when', patch.when, EDGE_TEXT_MAX_LENGTH);
        if (sameJson(edge, next)) return;
        set((s) => ({ edges: { ...s.edges, [id]: next }, dirty: true }));
      },

      removeEdge: (id) => {
        if (!get().edges[id]) return;
        set((s) => ({ edges: omit(s.edges, id), dirty: true }));
      },

      markSaved: (version, sent) => {
        const s = get();
        const unchanged = !sent || (s.nodes === sent.nodes && s.edges === sent.edges && s.layout === sent.layout);
        set({ version, dirty: unchanged ? false : s.dirty });
      },
    };
  });
}

/** Grafo listo para `PUT /api/features/{id}/canvas`. */
export function toGraph(state: GraphState): WalkieCanvasGraphV0 {
  return {
    schemaVersion: 0,
    version: state.version,
    nodes: state.nodes,
    edges: state.edges,
    layout: state.layout,
  };
}

/** Hook para leer el store desde componentes. */
export function useGraph<T>(store: StoreApi<GraphStore>, selector: (s: GraphStore) => T): T {
  return useStore(store, selector);
}
