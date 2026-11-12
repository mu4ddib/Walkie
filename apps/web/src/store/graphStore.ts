import { createStore, type StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { v7 as uuidv7 } from 'uuid';
import type { Edge, Group, Node, StickyNote, Tour, WalkieCanvasGraphV0 } from '../schema/walkie-graph';
import { GRID } from '../theme/palette';
import { normalizeDatabase, normalizeEdgeData, normalizeEdgeRequest, normalizeHttp } from '../contracts/contracts';
import { canNest, descendantsOf, inferHierarchy, isInside, ownerOf } from './hierarchy';
import { History, sameSnapshot, snapshotOf, type Snapshot } from './history';
import { tourKind, type TourKind } from '../tours/flows';
import { normalizeResource, resourceEdgeKind, resourceKindMeta, type ResourceKind } from '../nodes/resourceMeta';

/** Tours con `kind` explícito (los anteriores, deducido de sus pasos). */
function withKinds(tours: Record<string, Tour>): Record<string, Tour> {
  if (Object.values(tours).every((t) => t.kind)) return tours;
  return Object.fromEntries(Object.entries(tours).map(([id, t]) => [id, t.kind ? t : { ...t, kind: tourKind(t) }]));
}

/**
 * Pasos con identidad (spec tours-compactos): los de lienzos anteriores, o con un id repetido en su tour, reciben uno
 * nuevo. Devuelve los mismos tours si ya la tenían todos.
 */
function withStepIds(tours: Record<string, Tour>, newId: () => string): Record<string, Tour> {
  const ok = (t: Tour) => t.steps.every((s, i) => s.id && t.steps.findIndex((o) => o.id === s.id) === i);
  if (Object.values(tours).every(ok)) return tours;
  return Object.fromEntries(
    Object.entries(tours).map(([key, t]) => {
      if (ok(t)) return [key, t];
      const seen = new Set<string>();
      const steps = t.steps.map((step) => {
        const fresh = !step.id || seen.has(step.id);
        const id = fresh ? newId() : step.id!;
        seen.add(id);
        return fresh ? { id, ...stepWithoutId(step) } : step;
      });
      return [key, { ...t, steps }];
    }),
  );
}

function stepWithoutId(step: TourStep): TourStep {
  const copy = { ...step };
  delete copy.id;
  return copy;
}

/** Paso de un tour: un nodo (`nodeId`), una conexión (`edgeId`) o una conexión eliminada (`removedEdge`). */
export type TourStep = Tour['steps'][number];

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
/** Máximo del schema para el nombre de un tour. */
export const TOUR_NAME_MAX_LENGTH = 60;
/** Máximo del schema para la nota de un paso. */
export const STEP_NOTE_MAX_LENGTH = 500;
/** Máximo del schema para `edge.label` y `edge.when`. */
export const EDGE_TEXT_MAX_LENGTH = 60;

/** Tipos que pueden vivir en el catálogo de la app (ADR-0002). */
export const CATALOG_NODE_TYPES: readonly NodeType[] = ['api', 'service', 'database'];

export const INPUT_TYPES: readonly InputType[] = ['string', 'number', 'boolean', 'date', 'enum', 'file'];
export const HTTP_METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/** Cambios de contenido de un nodo. Un texto vacío quita el campo. */
export interface NodePatch {
  title?: string;
  description?: string;
  /** Responsabilidades o notas (actor, pantalla, regla, servicio, portal). */
  notes?: string;
  expression?: string;
  http?: { method?: HttpMethod | null; path?: string };
  /** Imagen de una pantalla (ADR-0004); `null` la quita. Se ignora en otros tipos. */
  assetId?: string | null;
  /** Feature destino de un `portal`; `null` la quita. Se ignora en otros tipos. */
  targetFeatureId?: string | null;
}

export type GroupKind = Group['kind'];
/** Caja de un grupo en el lienzo. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** Tamaño mínimo de un grupo desplegado. */
export const GROUP_MIN = { w: 240, h: 160 } as const;
export const GROUP_KINDS: readonly GroupKind[] = [
  'frontend',
  'backend',
  'external',
  'data',
  'network',
  'environment',
  'cloud',
  'custom',
];

/** Cambios de un input. `options` solo aplica a `enum`; `ruleIds` solo a nodos `rule` existentes. */
export type InputPatch = Partial<Input>;

/** Cambios de una conexión. Un texto vacío quita el campo. */
export interface EdgePatch {
  kind?: EdgeKind;
  label?: string;
  when?: string;
  notes?: string;
  /** Ejemplo de payload de esta interacción. */
  example?: string;
  /** Acceso a datos (operación y entidades); `null` lo quita. */
  data?: Edge['data'] | null;
  /** Salida de la decisión de origen; `null` la quita. Se ignora si el origen no tiene esa salida. */
  branch?: string | null;
  /** Código HTTP de una respuesta (100 a 599); `null` lo quita. */
  status?: number | null;
  /** Solicitud a la que responde; `null` la desvincula. Debe ser otra conexión `request`. */
  replyTo?: string | null;
  /** Qué ocurre después de una respuesta. */
  outcome?: string;
  /** Endpoint y parámetros propios de una solicitud; `null` vuelve al contrato de la API. */
  request?: Edge['request'] | null;
  /** Invierte el sentido (origen ↔ destino) en el mismo cambio; pierde la salida de decisión, que era del origen. */
  reverse?: boolean;
}

export type Branch = NonNullable<Node['branches']>[number];
/** Máximo del schema para `branches`. */
export const BRANCHES_MAX = 24;
/** Máximo del schema para `edge.outcome`. */
export const OUTCOME_MAX_LENGTH = 500;
/** Máximo del schema para el texto de una nota adhesiva. */
export const STICKY_TEXT_MAX_LENGTH = 1000;
/** Salidas con las que nace una decisión. */
export const DEFAULT_BRANCH_LABELS = ['Sí', 'No'] as const;
/** Desplazamiento de una copia respecto del original (3 celdas de la grilla). */
export const DUPLICATE_OFFSET = GRID * 3;

/** Límite de las notas de un nodo (schema). */
export const NOTES_MAX_LENGTH = 4000;
/** Límite del ejemplo de una conexión (schema). */
export const EXAMPLE_MAX_LENGTH = 10000;

/** Títulos por defecto al crear un nodo desde la paleta. */
export const DEFAULT_TITLES: Record<NodeType, string> = {
  screen: 'Pantalla',
  api: 'API',
  database: 'Base de datos',
  actor: 'Actor',
  rule: 'Regla',
  service: 'Servicio',
  resource: 'Recurso',
  ref: 'Referencia',
  portal: 'Portal',
};

/**
 * Tipo de conexión por defecto según el par (spec, criterio 5). Otros pares: `uses`. Con un recurso en un extremo
 * (spec nodos-de-infraestructura), su subtipo manda: hacia una cola, `event`; hacia un bucket, `writes`…
 */
export function defaultEdgeKind(
  from: NodeType,
  to: NodeType,
  resources: { from?: ResourceKind; to?: ResourceKind } = {},
): EdgeKind {
  const byResource = resourceEdgeKind(from === 'resource' ? resources.from : undefined, to === 'resource' ? resources.to : undefined);
  if (byResource) return byResource;
  if (from === 'screen' && to === 'screen') return 'navigation';
  if (from === 'screen' && to === 'portal') return 'navigation';
  if (from === 'screen' && to === 'api') return 'request';
  if (from === 'api' && to === 'screen') return 'response';
  if (from === 'api' && to === 'database') return 'reads';
  if (from === 'actor' && to === 'screen') return 'navigation';
  if (from === 'api' && to === 'service') return 'request';
  if (from === 'service' && to === 'database') return 'reads';
  // screen→rule y cualquier otro par.
  return 'uses';
}

/** Caja de grupo en la grilla y con el tamaño mínimo. */
function snapBox(box: Box): Box {
  return {
    x: snap(box.x),
    y: snap(box.y),
    w: Math.max(GROUP_MIN.w, snap(box.w)),
    h: Math.max(GROUP_MIN.h, snap(box.h)),
  };
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

/** Lo que señala un paso, sin su nota. */
function stepTarget(step: TourStep): TourStep {
  const id = step.id ? { id: step.id } : {};
  if (step.edgeId) return { ...id, edgeId: step.edgeId };
  if (step.removedEdge) return { ...id, removedEdge: step.removedEdge };
  return { ...id, nodeId: step.nodeId };
}

/** `target` con la identidad `id` (si la hay) delante: así un paso conserva su id al cambiar de nodo o conexión. */
function withStepId(id: string | undefined, target: TourStep): TourStep {
  return id ? { id, ...target } : target;
}

/** Paso con la nota recortada al límite; vacía o ausente, sin `note`. */
function withNote(step: TourStep, note: string | undefined): TourStep {
  const clean = note?.trim().slice(0, STEP_NOTE_MAX_LENGTH);
  return clean ? { ...stepTarget(step), note: clean } : stepTarget(step);
}

/** Lo que se sabe de una conexión borrada, para el paso que la usaba. */
function removedFrom(edge: Edge): NonNullable<TourStep['removedEdge']> {
  const removed: NonNullable<TourStep['removedEdge']> = { from: edge.from, to: edge.to, kind: edge.kind };
  if (edge.label) removed.label = edge.label;
  return removed;
}

/**
 * Tours sin las conexiones `gone`: cada paso que las recorría queda como `removedEdge` (con su nota) para que se
 * pueda reemplazar o quitar (spec recorridos-y-grupos, parte 6). Devuelve los mismos tours si ninguno las usaba.
 */
function withRemovedEdges(tours: Record<string, Tour>, gone: Record<string, Edge>): Record<string, Tour> {
  const touches = (t: Tour) => t.steps.some((step) => step.edgeId && gone[step.edgeId]);
  if (!Object.values(tours).some(touches)) return tours;
  return Object.fromEntries(
    Object.entries(tours).map(([key, t]) => {
      if (!touches(t)) return [key, t];
      const steps = t.steps.map((step) => {
        const edge = step.edgeId ? gone[step.edgeId] : undefined;
        if (!edge) return step;
        const next: TourStep = withStepId(step.id, { removedEdge: removedFrom(edge) });
        if (step.note) next.note = step.note;
        return next;
      });
      return [key, { ...t, steps }];
    }),
  );
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

/** Código HTTP válido para `edge.status`. */
function validStatus(status: number | null | undefined): status is number {
  return typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599;
}

/** Quita `replyTo` de las respuestas cuya solicitud ya no existe. */
function withoutDanglingReplies(edges: Record<string, Edge>): Record<string, Edge> {
  if (!Object.values(edges).some((e) => e.replyTo && !edges[e.replyTo])) return edges;
  return Object.fromEntries(
    Object.entries(edges).map(([key, e]) => {
      if (!e.replyTo || edges[e.replyTo]) return [key, e];
      const copy = { ...e };
      delete copy.replyTo;
      return [key, copy];
    }),
  );
}

/** Primera etiqueta libre para una salida nueva: "Sí", "No", "Rama 3"… */
function freeBranchLabel(branches: readonly Branch[]): string {
  const taken = new Set(branches.map((b) => b.label));
  for (const label of DEFAULT_BRANCH_LABELS) if (!taken.has(label)) return label;
  let n = branches.length + 1;
  while (taken.has(`Rama ${n}`)) n++;
  return `Rama ${n}`;
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
  /** Tours del lienzo (modo tour), por id. */
  tours: Record<string, Tour>;
  /** Grupos de infraestructura, por id; su caja (x, y, w, h) está en `layout` con el mismo id. */
  groups: Record<string, Group>;
  /** Notas adhesivas (anotaciones del lienzo), por id; su posición está en `layout` con el mismo id. */
  stickyNotes: Record<string, StickyNote>;
  /** Versión guardada en el servidor (concurrencia optimista). */
  version: number;
  /** Hay cambios sin guardar. */
  dirty: boolean;
  /** Hay algo que deshacer / rehacer (el historial vive fuera del estado; esto es lo que la interfaz necesita). */
  canUndo: boolean;
  canRedo: boolean;
}

/** Margen que deja un grupo alrededor de lo que contiene (lados y abajo; arriba, además, su encabezado). */
export const GROUP_PADDING = { side: GRID * 3, top: GRID * 7, bottom: GRID * 3 } as const;

export interface GraphActions {
  loadGraph(graph: WalkieCanvasGraphV0): void;
  addNode(type: NodeType, position: Position): string;
  /**
   * Recurso de infraestructura del subtipo `kind` (spec nodos-de-infraestructura): su título es el del subtipo; uno
   * personalizado lleva `label` (o «Recurso»).
   */
  addResource(kind: ResourceKind, position: Position, label?: string): string;
  /**
   * Cambia el recurso de un nodo `resource` (subtipo, nombre del personalizado, proveedor, nombre y detalles),
   * normalizado. Cambiar el subtipo conserva título, conexiones y detalles; al pasar a personalizado, el nombre del
   * subtipo anterior queda como su nombre.
   */
  setResource(id: string, patch: Partial<NonNullable<Node['resource']>>): void;
  /** Dónde corre un servicio (`undefined` lo quita). Solo `service`. */
  setRuntime(id: string, runtime: Node['runtime'] | undefined): void;
  /** Nodo `ref` a un elemento del catálogo; `title` guarda su título como último conocido. */
  addRef(item: { id: string; title: string }, position: Position): string;
  /**
   * "Mover al catálogo" (spec catalogo, criterio 10b): el nodo pasa a ser un `ref` a `catalogId`
   * con el mismo id, posición y conexiones. Solo para `api`, `service` y `database`.
   */
  convertToRef(id: string, catalogId: string): void;
  /**
   * "Crear copia independiente" (spec espacio-de-trabajo, criterio 11): un `ref` vuelve a ser un nodo propio
   * del tipo del elemento, con sus datos actuales y el mismo id, posición, conexiones y pasos de tour.
   */
  convertToLocal(
    id: string,
    item: { type: NodeType; title: string; description?: string; http?: Node['http']; database?: Node['database'] },
  ): void;
  /**
   * Grupo de infraestructura (spec espacio-de-trabajo, criterio 18) con su caja; los `members` (nodos, notas u otros
   * grupos) pasan a estar en él y él queda dentro de `parentId` (si no crea un ciclo). Devuelve su id.
   */
  addGroup(box: Box, init?: { title?: string; kind?: GroupKind; members?: string[]; parentId?: string | null }): string;
  /** Título, tipo o plegado; un título vacío no se aplica. Plegar no toca el plegado de los grupos de dentro. */
  updateGroup(id: string, patch: { title?: string; kind?: GroupKind; collapsed?: boolean }): void;
  /** Mueve el grupo y todo lo que contiene, a cualquier profundidad y aunque esté oculto (criterio 18, parte 1). */
  moveGroup(id: string, position: Position): void;
  /** Cambia la caja del grupo (al redimensionar); lo de dentro no se mueve. */
  resizeGroup(id: string, box: Box): void;
  /**
   * Mete un nodo, una nota o un grupo en `groupId` o lo saca al lienzo (`null`). Devuelve `false` si no se aplicó:
   * no existe, ya estaba ahí o crearía un ciclo (un grupo dentro de sí mismo o de un descendiente).
   */
  setParent(id: string, groupId: string | null): boolean;
  /** Mete el nodo en el grupo o lo saca (`null`). Igual que `setParent` para un nodo. */
  setNodeGroup(nodeId: string, groupId: string | null): void;
  /** Borra el grupo; lo que contenía (nodos, notas, grupos) pasa a su grupo padre o queda suelto. */
  removeGroup(id: string): void;
  /** Contrato completo de una API (`undefined` lo quita); se normaliza como el resto de textos. Solo `api`. */
  setHttp(id: string, http: Node['http'] | undefined): void;
  /** Estructura de una base de datos (`undefined` la quita). Solo `database`. */
  setDatabase(id: string, database: Node['database'] | undefined): void;
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
  /**
   * Copia de la caja con id propio, sus propiedades (imagen, inputs, contrato, `catalogId`, salidas) y el mismo
   * grupo, corrida `DUPLICATE_OFFSET`; sin conexiones ni pasos de tour. Devuelve el id nuevo o `null` si no existe.
   */
  duplicateNode(id: string): string | null;
  /** Regla ↔ decisión con el mismo id, título, posición y conexiones. A decisión: nace con "Sí" y "No". */
  setRuleMode(id: string, mode: 'rule' | 'decision'): void;
  /** Agrega una salida a una decisión; devuelve su id o `null` (no es decisión, etiqueta vacía o límite). */
  addBranch(nodeId: string, label?: string): string | null;
  /** Etiqueta de una salida; vacía no se aplica. */
  renameBranch(nodeId: string, branchId: string, label: string): void;
  /** Quita la salida; sus conexiones siguen, sin salida asignada. */
  removeBranch(nodeId: string, branchId: string): void;
  /** Nota adhesiva en `position`; devuelve su id. */
  addStickyNote(position: Position, text?: string): string;
  updateStickyNote(id: string, text: string): void;
  moveStickyNote(id: string, position: Position): void;
  removeStickyNote(id: string): void;
  /** Copia de la nota, corrida `DUPLICATE_OFFSET`; devuelve su id o `null`. */
  duplicateStickyNote(id: string): string | null;
  /** Crea la conexión; `null` si algún nodo no existe o es el mismo nodo. `branch`: salida de la decisión de origen. */
  connect(from: string, to: string, kind?: EdgeKind, init?: { branch?: string | null }): string | null;
  /**
   * Respuesta a una solicitud: conexión `response` en sentido inverso, vinculada con `replyTo`. Una solicitud puede
   * tener varias (éxito, error). Devuelve su id o `null` si `requestId` no es una conexión `request`.
   */
  addResponse(requestId: string, init?: { status?: number; label?: string }): string | null;
  setEdgeKind(id: string, kind: EdgeKind): void;
  /** Tipo, etiqueta (`label`), condición (`when`) y el detalle propio de cada interacción (`EdgePatch`). */
  updateEdge(id: string, patch: EdgePatch): void;
  removeEdge(id: string): void;
  /**
   * Crea un tour vacío de tipo `kind` (spec tours-y-recorridos): `guide` (por defecto) solo admite pasos de nodo y
   * `flow` (recorrido) solo pasos de conexión. Devuelve su id o `null` si el nombre queda vacío.
   */
  addTour(name: string, kind?: TourKind): string | null;
  renameTour(id: string, name: string): void;
  removeTour(id: string): void;
  /** Agrega un paso al final; devuelve su índice o `null` si el tour o el nodo no existen. */
  addStep(tourId: string, nodeId: string, note?: string): number | null;
  /**
   * Agrega un paso que recorre la conexión `edgeId` (spec recorridos-y-grupos, parte 3); la misma conexión puede
   * repetirse (reintento). Devuelve su índice o `null` si el tour o la conexión no existen.
   */
  addEdgeStep(tourId: string, edgeId: string, note?: string): number | null;
  /** Recorrido nuevo con un paso por cada conexión, en ese orden; `null` si el nombre queda vacío. */
  addFlowTour(name: string, edgeIds: readonly string[]): string | null;
  /** Cambia el nodo de un paso (debe existir). */
  setStepNode(tourId: string, index: number, nodeId: string): void;
  /** El paso pasa a recorrer `edgeId` (también para reemplazar una conexión eliminada); conserva la nota. */
  setStepEdge(tourId: string, index: number, edgeId: string): void;
  /**
   * Inserta un paso en `index` (0 = al principio; `steps.length` = al final) con su propia identidad: un nodo en un tour
   * o una conexión en un recorrido. Devuelve el id del paso, o `null` si no se aplicó.
   */
  insertStep(tourId: string, index: number, target: { nodeId: string } | { edgeId: string }, note?: string): string | null;
  /** Copia del paso justo después de él, con su propia identidad; devuelve su id o `null`. */
  duplicateStep(tourId: string, index: number): string | null;
  /** Lleva el paso de `from` a `to` (arrastrar para reordenar); conserva su identidad y su nota. */
  moveStepTo(tourId: string, from: number, to: number): void;
  /**
   * Pasa el paso `index` de un tour a otro (spec tours-a-escala), al final o en `toIndex`, con su nota e identidad (un id
   * repetido en el destino se reemplaza). Solo a un destino compatible: un paso de nodo va a un tour; uno de conexión
   * (o de conexión eliminada), a un recorrido. Devuelve el id del paso en el destino, o `null` si no se aplicó.
   */
  moveStepToTour(fromTourId: string, index: number, toTourId: string, toIndex?: number): string | null;
  /** Copia del tour («Nombre (copia)») con pasos de identidad propia; devuelve su id o `null`. */
  duplicateTour(tourId: string): string | null;
  /** Reordena los pasos: `order` es una permutación de sus índices. Otra cosa no se aplica. */
  reorderSteps(tourId: string, order: readonly number[]): void;
  /** Nota del paso; vacía la quita. */
  updateStepNote(tourId: string, index: number, note: string): void;
  /** Sube (-1) o baja (+1) un paso; fuera de rango no hace nada. */
  moveStep(tourId: string, index: number, delta: -1 | 1): void;
  removeStep(tourId: string, index: number): void;
  /**
   * Tras un guardado exitoso: adopta la versión del servidor. Limpia `dirty` solo si el grafo
   * sigue siendo el que se envió (`sent`); si hubo cambios mientras viajaba la petición, siguen pendientes.
   */
  markSaved(version: number, sent?: GraphState): void;
  /** Deshace el último paso del grafo (spec deshacer-y-cajas). No toca la versión; `dirty` según lo guardado. */
  undo(): void;
  /** Rehace lo último que se deshizo. Un cambio nuevo después de deshacer descarta lo que había para rehacer. */
  redo(): void;
  /** Abre un lote: hasta `endBatch`, todos los cambios son un solo paso del historial (ej. un arrastre). */
  beginBatch(): void;
  endBatch(): void;
  /**
   * Agranda la caja del grupo para que `box` quede dentro con su margen (`GROUP_PADDING`), y lo mismo con sus
   * grupos de afuera si el grupo crecido ya no les cabe. Solo agranda: nunca achica ni mueve lo de dentro.
   */
  growGroup(id: string, box: Box): void;
}

export type GraphStore = GraphState & GraphActions;

const emptyState: GraphState = {
  nodes: {},
  edges: {},
  layout: {},
  tours: {},
  groups: {},
  stickyNotes: {},
  version: 0,
  dirty: false,
  canUndo: false,
  canRedo: false,
};

/**
 * Store del grafo de un lienzo. Única vía para cambiarlo (CLAUDE.md): los componentes
 * solo llaman acciones. Estado normalizado por ID para poder migrar a Yjs (`Y.Map`).
 */
export function createGraphStore(newId: () => string = uuidv7): StoreApi<GraphStore> {
  const history = new History();
  // El grafo tal como está guardado: deshacer hasta él deja el lienzo "al día" otra vez.
  let saved: Snapshot = snapshotOf(emptyState);
  // Mientras se aplica un deshacer, rehacer o una carga, el cambio no se anota en el historial.
  let replaying = false;

  const store = createStore<GraphStore>()((set, get) => {
    const flags = () => ({ canUndo: history.canUndo, canRedo: history.canRedo });
    /** Pone una instantánea (deshacer/rehacer) sin anotarla. */
    const restore = (snapshot: Snapshot) => {
      replaying = true;
      set({ ...snapshot, dirty: !sameSnapshot(snapshot, saved), ...flags() });
      replaying = false;
    };

    /** Un paso de nodo va en un tour; uno de conexión (o de conexión eliminada), en un recorrido. */
    const stepFits = (step: Tour['steps'][number], kind: 'guide' | 'flow') =>
      step.nodeId ? kind === 'guide' : kind === 'flow';
    const putTour = (tour: Tour) => set((s) => ({ tours: { ...s.tours, [tour.id]: tour }, dirty: true }));

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

      loadGraph: (loaded) => {
        // Lienzos anteriores a la jerarquía explícita: se infiere por contención (sin marcar cambios).
        const graph = inferHierarchy(loaded);
        history.reset();
        replaying = true;
        set({
          nodes: graph.nodes,
          edges: graph.edges,
          layout: graph.layout,
          // Lienzos anteriores: cada tour recibe el tipo que se deduce de sus pasos (sin marcar cambios).
          tours: withStepIds(withKinds(graph.tours ?? {}), newId),
          groups: graph.groups ?? {},
          stickyNotes: graph.stickyNotes ?? {},
          version: graph.version,
          dirty: false,
          canUndo: false,
          canRedo: false,
        });
        replaying = false;
        saved = snapshotOf(get());
      },

      addNode: (type, position) => {
        // Un recurso necesita su subtipo (schema): sin él, uno personalizado.
        if (type === 'resource') return get().addResource('custom', position);
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

      addResource: (kind, position, label) => {
        const id = newId();
        const resource = normalizeResource({ kind, label });
        const title = kind === 'custom' ? resource.label! : resourceKindMeta(kind).label;
        set((s) => ({
          nodes: { ...s.nodes, [id]: { id, type: 'resource', title, resource } },
          layout: { ...s.layout, [id]: { x: snap(position.x), y: snap(position.y) } },
          dirty: true,
        }));
        return id;
      },

      setResource: (id, patch) => {
        const node = get().nodes[id];
        if (!node || node.type !== 'resource') return;
        const current = node.resource ?? { kind: 'custom' as const };
        const next = { ...current, ...patch };
        // Al pasar a personalizado sin nombre, se queda con el del subtipo que tenía.
        const fallback = current.kind === 'custom' ? current.label : resourceKindMeta(current.kind).label;
        const resource = normalizeResource(next, fallback);
        putNode({ ...node, resource });
      },

      setRuntime: (id, runtime) => {
        const node = get().nodes[id];
        if (!node || node.type !== 'service') return;
        const next = { ...node };
        if (runtime) next.runtime = runtime;
        else delete next.runtime;
        putNode(next);
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

      convertToRef: (id, catalogId) => {
        const node = get().nodes[id];
        if (!node || !CATALOG_NODE_TYPES.includes(node.type)) return;
        set((s) => ({ nodes: { ...s.nodes, [id]: { id, type: 'ref', title: node.title, catalogId } }, dirty: true }));
      },

      convertToLocal: (id, item) => {
        const node = get().nodes[id];
        if (!node || node.type !== 'ref' || !CATALOG_NODE_TYPES.includes(item.type)) return;
        let next: Node = { id, type: item.type, title: item.title.trim().slice(0, TITLE_MAX_LENGTH) || node.title };
        next = withText(next, 'description', item.description, TEXT_MAX_LENGTH);
        const http = item.type === 'api' ? normalizeHttp(item.http) : undefined;
        if (http) next.http = http;
        const database = item.type === 'database' ? normalizeDatabase(item.database) : undefined;
        if (database) next.database = database;
        set((s) => ({ nodes: { ...s.nodes, [id]: next }, dirty: true }));
      },

      addGroup: (box, init = {}) => {
        const id = newId();
        const s = get();
        const title = init.title?.trim().slice(0, TITLE_MAX_LENGTH) || 'Grupo';
        const members = (init.members ?? []).filter((m) => s.nodes[m] || s.stickyNotes[m] || s.groups[m]);
        // El padre no puede ser uno de los miembros ni estar dentro de ellos: eso sería un ciclo.
        const parentId =
          init.parentId && s.groups[init.parentId] && !members.some((m) => m === init.parentId || isInside(s, init.parentId!, m))
            ? init.parentId
            : null;
        const group: Group = { id, title, kind: init.kind ?? 'custom' };
        if (parentId) group.parentId = parentId;
        const pick = <T,>(record: Record<string, T>, key: 'groupId' | 'parentId') =>
          Object.fromEntries(members.filter((m) => record[m]).map((m) => [m, { ...record[m]!, [key]: id }]));
        set((st) => ({
          groups: { ...st.groups, ...pick(st.groups, 'parentId'), [id]: group },
          layout: { ...st.layout, [id]: snapBox(box) },
          nodes: { ...st.nodes, ...pick(st.nodes, 'groupId') },
          stickyNotes: { ...st.stickyNotes, ...pick(st.stickyNotes, 'groupId') },
          dirty: true,
        }));
        return id;
      },

      updateGroup: (id, patch) => {
        const group = get().groups[id];
        if (!group) return;
        const next: Group = { ...group };
        const title = patch.title?.trim().slice(0, TITLE_MAX_LENGTH);
        if (title) next.title = title;
        if (patch.kind) next.kind = patch.kind;
        if (patch.collapsed !== undefined) {
          if (patch.collapsed) next.collapsed = true;
          else delete next.collapsed;
        }
        if (sameJson(group, next)) return;
        set((s) => ({ groups: { ...s.groups, [id]: next }, dirty: true }));
      },

      moveGroup: (id, position) => {
        const box = get().layout[id];
        if (!get().groups[id] || !box) return;
        const dx = snap(position.x) - box.x;
        const dy = snap(position.y) - box.y;
        if (dx === 0 && dy === 0) return;
        set((s) => {
          const layout = { ...s.layout, [id]: { ...box, x: box.x + dx, y: box.y + dy } };
          // Todo lo de dentro, a cualquier profundidad (también lo oculto en un grupo plegado), se mueve igual.
          const inside = descendantsOf(s, id);
          for (const item of [...inside.groups, ...inside.nodes, ...inside.notes]) {
            const at = s.layout[item];
            if (at) layout[item] = { ...at, x: at.x + dx, y: at.y + dy };
          }
          return { layout, dirty: true };
        });
      },

      resizeGroup: (id, box) => {
        const current = get().layout[id];
        if (!get().groups[id] || !current) return;
        const next = snapBox(box);
        if (sameJson(current, next)) return;
        set((s) => ({ layout: { ...s.layout, [id]: next }, dirty: true }));
      },

      setParent: (id, groupId) => {
        const s = get();
        if (!(s.nodes[id] || s.stickyNotes[id] || s.groups[id])) return false;
        if (ownerOf(s, id) === groupId || !canNest(s, id, groupId)) return false;
        const assign = <T extends { groupId?: string; parentId?: string }>(item: T, key: 'groupId' | 'parentId'): T => {
          const next = { ...item };
          if (groupId) next[key] = groupId;
          else delete next[key];
          return next;
        };
        if (s.nodes[id]) set((st) => ({ nodes: { ...st.nodes, [id]: assign(st.nodes[id]!, 'groupId') }, dirty: true }));
        else if (s.stickyNotes[id]) {
          set((st) => ({ stickyNotes: { ...st.stickyNotes, [id]: assign(st.stickyNotes[id]!, 'groupId') }, dirty: true }));
        } else set((st) => ({ groups: { ...st.groups, [id]: assign(st.groups[id]!, 'parentId') }, dirty: true }));
        return true;
      },

      setNodeGroup: (nodeId, groupId) => {
        if (get().nodes[nodeId]) get().setParent(nodeId, groupId);
      },

      removeGroup: (id) => {
        const group = get().groups[id];
        if (!group) return;
        // Lo que contenía sube un nivel: al grupo padre o, si no hay, al lienzo.
        const parent = group.parentId && get().groups[group.parentId] ? group.parentId : undefined;
        const lift = <T extends { groupId?: string; parentId?: string }>(item: T, key: 'groupId' | 'parentId'): T => {
          if (item[key] !== id) return item;
          const next = { ...item };
          if (parent) next[key] = parent;
          else delete next[key];
          return next;
        };
        const map = <T extends { groupId?: string; parentId?: string }>(record: Record<string, T>, key: 'groupId' | 'parentId') =>
          Object.fromEntries(Object.entries(record).map(([k, v]) => [k, lift(v, key)]));
        set((s) => ({
          groups: map(omit(s.groups, id), 'parentId'),
          layout: omit(s.layout, id),
          nodes: map(s.nodes, 'groupId'),
          stickyNotes: map(s.stickyNotes, 'groupId'),
          dirty: true,
        }));
      },

      setHttp: (id, http) => {
        const node = get().nodes[id];
        if (!node || node.type !== 'api') return;
        const clean = normalizeHttp(http);
        const next = { ...node };
        if (clean) next.http = clean;
        else delete next.http;
        putNode(next);
      },

      setDatabase: (id, database) => {
        const node = get().nodes[id];
        if (!node || node.type !== 'database') return;
        const clean = normalizeDatabase(database);
        const next = { ...node };
        if (clean) next.database = clean;
        else delete next.database;
        putNode(next);
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
        if (node.type !== 'ref') next = withText(next, 'notes', patch.notes, NOTES_MAX_LENGTH);
        next = withText(next, 'expression', patch.expression, TEXT_MAX_LENGTH);
        if (patch.http) {
          let http = { ...next.http };
          if (patch.http.method === null) delete http.method;
          else if (patch.http.method) http.method = patch.http.method;
          http = withText(http, 'path', patch.http.path, TEXT_MAX_LENGTH);
          if (Object.keys(http).length > 0) next.http = http;
          else delete next.http;
        }
        if (patch.assetId !== undefined && node.type === 'screen') {
          if (patch.assetId) next.assetId = patch.assetId;
          else delete next.assetId;
        }
        if (patch.targetFeatureId !== undefined && node.type === 'portal') {
          if (patch.targetFeatureId) next.targetFeatureId = patch.targetFeatureId;
          else delete next.targetFeatureId;
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
          const edges = withoutDanglingReplies(
            Object.fromEntries(Object.entries(s.edges).filter(([, e]) => e.from !== id && e.to !== id)),
          );
          const gone = Object.fromEntries(Object.entries(s.edges).filter(([, e]) => e.from === id || e.to === id));
          // Los pasos de tours sobre el nodo desaparecen (spec modo-tour, criterio 4); los que recorrían una de sus
          // conexiones quedan marcados para reemplazarlos o quitarlos.
          const usedInTours = Object.values(s.tours).some((t) => t.steps.some((step) => step.nodeId === id));
          const base = withRemovedEdges(s.tours, gone);
          const tours = usedInTours
            ? Object.fromEntries(
                Object.entries(base).map(([key, t]) => [
                  key,
                  { ...t, steps: t.steps.filter((x) => x.nodeId !== id) },
                ]),
              )
            : base;
          return { nodes, layout, edges, tours, dirty: true };
        });
      },

      duplicateNode: (id) => {
        const { nodes, layout } = get();
        const node = nodes[id];
        if (!node) return null;
        const copyId = newId();
        // Copia profunda: inputs, contrato y salidas no se comparten con el original.
        const copy: Node = { ...(JSON.parse(JSON.stringify(node)) as Node), id: copyId };
        const at = layout[id] ?? { x: 0, y: 0 };
        set((s) => ({
          nodes: { ...s.nodes, [copyId]: copy },
          layout: { ...s.layout, [copyId]: { x: at.x + DUPLICATE_OFFSET, y: at.y + DUPLICATE_OFFSET } },
          dirty: true,
        }));
        return copyId;
      },

      setRuleMode: (id, mode) => {
        const node = get().nodes[id];
        if (!node || node.type !== 'rule') return;
        if (mode === 'decision') {
          if (node.mode === 'decision') return;
          const branches = node.branches?.length
            ? node.branches
            : DEFAULT_BRANCH_LABELS.map((label) => ({ id: newId(), label }));
          set((s) => ({ nodes: { ...s.nodes, [id]: { ...node, mode: 'decision', branches } }, dirty: true }));
          return;
        }
        if (node.mode !== 'decision') return;
        const labels = new Map((node.branches ?? []).map((b) => [b.id, b.label]));
        const next = { ...node };
        delete next.mode;
        delete next.branches;
        set((s) => ({
          nodes: { ...s.nodes, [id]: next },
          // La etiqueta de la salida no se pierde: pasa a ser la de la conexión si no tenía una.
          edges: Object.fromEntries(
            Object.entries(s.edges).map(([key, e]) => {
              if (e.from !== id || !e.branch) return [key, e];
              const copy = { ...e };
              const label = labels.get(e.branch);
              delete copy.branch;
              if (label && !copy.label) copy.label = label;
              return [key, copy];
            }),
          ),
          dirty: true,
        }));
      },

      addBranch: (nodeId, label) => {
        const node = get().nodes[nodeId];
        if (!node || node.mode !== 'decision') return null;
        const branches = node.branches ?? [];
        if (branches.length >= BRANCHES_MAX) return null;
        const clean = (label ?? freeBranchLabel(branches)).trim().slice(0, EDGE_TEXT_MAX_LENGTH);
        if (!clean) return null;
        const id = newId();
        putNode({ ...node, branches: [...branches, { id, label: clean }] });
        return id;
      },

      renameBranch: (nodeId, branchId, label) => {
        const node = get().nodes[nodeId];
        const clean = label.trim().slice(0, EDGE_TEXT_MAX_LENGTH);
        if (!node?.branches?.some((b) => b.id === branchId) || !clean) return;
        putNode({ ...node, branches: node.branches.map((b) => (b.id === branchId ? { ...b, label: clean } : b)) });
      },

      removeBranch: (nodeId, branchId) => {
        const node = get().nodes[nodeId];
        if (!node?.branches?.some((b) => b.id === branchId)) return;
        set((s) => ({
          nodes: { ...s.nodes, [nodeId]: { ...node, branches: node.branches!.filter((b) => b.id !== branchId) } },
          edges: Object.fromEntries(
            Object.entries(s.edges).map(([key, e]) => {
              if (e.from !== nodeId || e.branch !== branchId) return [key, e];
              const copy = { ...e };
              delete copy.branch;
              return [key, copy];
            }),
          ),
          dirty: true,
        }));
      },

      addStickyNote: (position, text = '') => {
        const id = newId();
        set((s) => ({
          stickyNotes: { ...s.stickyNotes, [id]: { id, text: text.slice(0, STICKY_TEXT_MAX_LENGTH) } },
          layout: { ...s.layout, [id]: { x: snap(position.x), y: snap(position.y) } },
          dirty: true,
        }));
        return id;
      },

      updateStickyNote: (id, text) => {
        const note = get().stickyNotes[id];
        const clean = text.trim().slice(0, STICKY_TEXT_MAX_LENGTH);
        if (!note || note.text === clean) return;
        set((s) => ({ stickyNotes: { ...s.stickyNotes, [id]: { ...note, text: clean } }, dirty: true }));
      },

      moveStickyNote: (id, position) => {
        const current = get().layout[id];
        if (!get().stickyNotes[id]) return;
        const x = snap(position.x);
        const y = snap(position.y);
        if (current && current.x === x && current.y === y) return;
        set((s) => ({ layout: { ...s.layout, [id]: { x, y } }, dirty: true }));
      },

      removeStickyNote: (id) => {
        if (!get().stickyNotes[id]) return;
        set((s) => ({ stickyNotes: omit(s.stickyNotes, id), layout: omit(s.layout, id), dirty: true }));
      },

      duplicateStickyNote: (id) => {
        const note = get().stickyNotes[id];
        if (!note) return null;
        const at = get().layout[id] ?? { x: 0, y: 0 };
        const copy = get().addStickyNote({ x: at.x + DUPLICATE_OFFSET, y: at.y + DUPLICATE_OFFSET }, note.text);
        // La copia queda en el mismo grupo que el original.
        if (note.groupId) get().setParent(copy, note.groupId);
        return copy;
      },

      connect: (from, to, kind, init) => {
        const { nodes } = get();
        const source = nodes[from];
        const target = nodes[to];
        if (!source || !target || from === to) return null;
        const id = newId();
        const edge: Edge = {
          id,
          from,
          to,
          kind: kind ?? defaultEdgeKind(source.type, target.type, { from: source.resource?.kind, to: target.resource?.kind }),
        };
        if (init?.branch && source.branches?.some((b) => b.id === init.branch)) edge.branch = init.branch;
        set((s) => ({ edges: { ...s.edges, [id]: edge }, dirty: true }));
        return id;
      },

      addResponse: (requestId, init) => {
        const request = get().edges[requestId];
        if (!request || request.kind !== 'request') return null;
        const id = newId();
        let edge: Edge = { id, from: request.to, to: request.from, kind: 'response', replyTo: requestId };
        if (validStatus(init?.status)) edge.status = init.status;
        edge = withText(edge, 'label', init?.label, EDGE_TEXT_MAX_LENGTH);
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
        next = withText(next, 'notes', patch.notes, TEXT_MAX_LENGTH);
        next = withText(next, 'example', patch.example, EXAMPLE_MAX_LENGTH);
        next = withText(next, 'outcome', patch.outcome, OUTCOME_MAX_LENGTH);
        if (patch.data !== undefined) {
          const data = normalizeEdgeData(patch.data ?? undefined);
          if (data) next.data = data;
          else delete next.data;
        }
        if (patch.request !== undefined) {
          const request = normalizeEdgeRequest(patch.request ?? undefined);
          if (request) next.request = request;
          else delete next.request;
        }
        if (patch.status !== undefined) {
          if (validStatus(patch.status)) next.status = patch.status;
          else if (patch.status === null) delete next.status;
        }
        if (patch.replyTo !== undefined) {
          const target = patch.replyTo ? get().edges[patch.replyTo] : undefined;
          if (target && target.id !== id && target.kind === 'request') next.replyTo = target.id;
          else if (patch.replyTo === null) delete next.replyTo;
        }
        if (patch.reverse) {
          next = { ...next, from: edge.to, to: edge.from };
          delete next.branch;
        }
        if (patch.branch !== undefined) {
          if (patch.branch && get().nodes[next.from]?.branches?.some((b) => b.id === patch.branch)) {
            next.branch = patch.branch;
          } else if (patch.branch === null) delete next.branch;
        }
        if (sameJson(edge, next)) return;
        set((s) => ({ edges: { ...s.edges, [id]: next }, dirty: true }));
      },

      removeEdge: (id) => {
        const edge = get().edges[id];
        if (!edge) return;
        set((s) => ({
          edges: withoutDanglingReplies(omit(s.edges, id)),
          tours: withRemovedEdges(s.tours, { [id]: edge }),
          dirty: true,
        }));
      },

      addTour: (name, kind = 'guide') => {
        const clean = name.trim().slice(0, TOUR_NAME_MAX_LENGTH);
        if (!clean) return null;
        const id = newId();
        set((s) => ({ tours: { ...s.tours, [id]: { id, name: clean, kind, steps: [] } }, dirty: true }));
        return id;
      },

      renameTour: (id, name) => {
        const tour = get().tours[id];
        const clean = name.trim().slice(0, TOUR_NAME_MAX_LENGTH);
        if (!tour || !clean || clean === tour.name) return;
        putTour({ ...tour, name: clean });
      },

      removeTour: (id) => {
        if (!get().tours[id]) return;
        set((s) => ({ tours: omit(s.tours, id), dirty: true }));
      },

      addStep: (tourId, nodeId, note) => {
        const tour = get().tours[tourId];
        // Un recorrido solo recorre conexiones: los pasos de nodo son de los tours.
        if (!tour || !get().nodes[nodeId] || tourKind(tour) === 'flow') return null;
        putTour({ ...tour, steps: [...tour.steps, withNote({ id: newId(), nodeId }, note)] });
        return tour.steps.length;
      },

      addEdgeStep: (tourId, edgeId, note) => {
        const tour = get().tours[tourId];
        if (!tour || !get().edges[edgeId] || tourKind(tour) === 'guide') return null;
        putTour({ ...tour, steps: [...tour.steps, withNote({ id: newId(), edgeId }, note)] });
        return tour.steps.length;
      },

      addFlowTour: (name, edgeIds) => {
        const id = get().addTour(name, 'flow');
        if (!id) return null;
        const steps = edgeIds.filter((e) => get().edges[e]).map((edgeId) => ({ id: newId(), edgeId }));
        if (steps.length) putTour({ ...get().tours[id]!, steps });
        return id;
      },

      setStepNode: (tourId, index, nodeId) => {
        const tour = get().tours[tourId];
        const step = tour?.steps[index];
        if (!tour || !step || !get().nodes[nodeId] || step.nodeId === nodeId) return;
        putTour({
          ...tour,
          steps: tour.steps.map((x, i) => (i === index ? withNote(withStepId(x.id, { nodeId }), x.note) : x)),
        });
      },

      setStepEdge: (tourId, index, edgeId) => {
        const tour = get().tours[tourId];
        const step = tour?.steps[index];
        if (!tour || !step || !get().edges[edgeId] || step.edgeId === edgeId) return;
        putTour({
          ...tour,
          steps: tour.steps.map((x, i) => (i === index ? withNote(withStepId(x.id, { edgeId }), x.note) : x)),
        });
      },

      insertStep: (tourId, index, target, note) => {
        const tour = get().tours[tourId];
        if (!tour || index < 0 || index > tour.steps.length) return null;
        const kind = tourKind(tour);
        if ('nodeId' in target ? kind === 'flow' || !get().nodes[target.nodeId] : kind === 'guide' || !get().edges[target.edgeId]) {
          return null;
        }
        const id = newId();
        const steps = [...tour.steps];
        steps.splice(index, 0, withNote({ id, ...target }, note));
        putTour({ ...tour, steps });
        return id;
      },

      duplicateStep: (tourId, index) => {
        const tour = get().tours[tourId];
        const step = tour?.steps[index];
        if (!tour || !step) return null;
        const id = newId();
        const steps = [...tour.steps];
        steps.splice(index + 1, 0, { ...step, id });
        putTour({ ...tour, steps });
        return id;
      },

      moveStepTo: (tourId, from, to) => {
        const tour = get().tours[tourId];
        if (!tour || !tour.steps[from] || to < 0 || to >= tour.steps.length || from === to) return;
        const steps = [...tour.steps];
        const [moved] = steps.splice(from, 1);
        steps.splice(to, 0, moved!);
        putTour({ ...tour, steps });
      },

      moveStepToTour: (fromTourId, index, toTourId, toIndex) => {
        const from = get().tours[fromTourId];
        const to = get().tours[toTourId];
        const step = from?.steps[index];
        if (!from || !to || !step || fromTourId === toTourId) return null;
        if (!stepFits(step, tourKind(to))) return null;
        const at = toIndex === undefined ? to.steps.length : toIndex;
        if (at < 0 || at > to.steps.length) return null;
        const id = step.id && !to.steps.some((x) => x.id === step.id) ? step.id : newId();
        const steps = [...to.steps];
        steps.splice(at, 0, { ...step, id });
        set((s) => ({
          tours: {
            ...s.tours,
            [fromTourId]: { ...from, steps: from.steps.filter((_, i) => i !== index) },
            [toTourId]: { ...to, steps },
          },
          dirty: true,
        }));
        return id;
      },

      duplicateTour: (tourId) => {
        const tour = get().tours[tourId];
        if (!tour) return null;
        const id = newId();
        const name = `${tour.name} (copia)`.slice(0, TOUR_NAME_MAX_LENGTH);
        // Los pasos de la copia tienen su propia identidad: editarlos no toca los del original.
        const steps = tour.steps.map((step) => ({ ...step, id: newId() }));
        set((s) => ({ tours: { ...s.tours, [id]: { ...tour, id, name, steps } }, dirty: true }));
        return id;
      },

      reorderSteps: (tourId, order) => {
        const tour = get().tours[tourId];
        if (!tour || order.length !== tour.steps.length) return;
        if (new Set(order).size !== order.length || order.some((i) => !tour.steps[i])) return;
        if (order.every((i, at) => i === at)) return;
        putTour({ ...tour, steps: order.map((i) => tour.steps[i]!) });
      },

      updateStepNote: (tourId, index, note) => {
        const tour = get().tours[tourId];
        const step = tour?.steps[index];
        if (!tour || !step) return;
        const next = withNote(step, note);
        if (next.note === step.note) return;
        putTour({ ...tour, steps: tour.steps.map((x, i) => (i === index ? next : x)) });
      },

      moveStep: (tourId, index, delta) => {
        const tour = get().tours[tourId];
        const target = index + delta;
        if (!tour || !tour.steps[index] || target < 0 || target >= tour.steps.length) return;
        const steps = [...tour.steps];
        [steps[index], steps[target]] = [steps[target]!, steps[index]!];
        putTour({ ...tour, steps });
      },

      removeStep: (tourId, index) => {
        const tour = get().tours[tourId];
        if (!tour?.steps[index]) return;
        putTour({ ...tour, steps: tour.steps.filter((_, i) => i !== index) });
      },

      markSaved: (version, sent) => {
        const s = get();
        const unchanged =
          !sent ||
          (s.nodes === sent.nodes &&
            s.edges === sent.edges &&
            s.layout === sent.layout &&
            s.tours === sent.tours &&
            s.groups === sent.groups &&
            s.stickyNotes === sent.stickyNotes);
        saved = snapshotOf(sent ?? s);
        set({ version, dirty: unchanged ? false : s.dirty });
      },

      undo: () => {
        const previous = history.undo(snapshotOf(get()));
        if (previous) restore(previous);
      },

      redo: () => {
        const next = history.redo(snapshotOf(get()));
        if (next) restore(next);
      },

      beginBatch: () => history.begin(),
      endBatch: () => history.end(),

      growGroup: (id, inner) => {
        const { groups } = get();
        const layout = { ...get().layout };
        let current: string | undefined = id;
        let rect: Box = inner;
        let changed = false;
        const seen = new Set<string>();
        while (current && groups[current] && !seen.has(current)) {
          seen.add(current);
          const box = layout[current];
          if (!box?.w || !box.h) break;
          // Hacia la grilla por fuera: la caja crece lo justo para no cortar lo de dentro.
          const x = Math.min(box.x, Math.floor((rect.x - GROUP_PADDING.side) / GRID) * GRID);
          const y = Math.min(box.y, Math.floor((rect.y - GROUP_PADDING.top) / GRID) * GRID);
          const right = Math.max(box.x + box.w, Math.ceil((rect.x + rect.w + GROUP_PADDING.side) / GRID) * GRID);
          const bottom = Math.max(box.y + box.h, Math.ceil((rect.y + rect.h + GROUP_PADDING.bottom) / GRID) * GRID);
          if (x === box.x && y === box.y && right === box.x + box.w && bottom === box.y + box.h) break;
          const next = { x: x + 0, y: y + 0, w: right - x, h: bottom - y };
          layout[current] = next;
          changed = true;
          rect = next;
          current = groups[current]?.parentId;
        }
        if (changed) set({ layout, dirty: true });
      },
    };
  });

  // Cada cambio del grafo se anota en el historial (salvo cargas, deshacer y rehacer).
  store.subscribe((state, previous) => {
    if (replaying) return;
    const before = snapshotOf(previous);
    const after = snapshotOf(state);
    if (sameSnapshot(before, after)) return;
    history.record(before, after);
    if (state.canUndo !== history.canUndo || state.canRedo !== history.canRedo) {
      replaying = true;
      store.setState({ canUndo: history.canUndo, canRedo: history.canRedo });
      replaying = false;
    }
  });
  return store;
}

/** Grafo listo para `PUT /api/features/{id}/canvas`. */
export function toGraph(state: GraphState): WalkieCanvasGraphV0 {
  const graph: WalkieCanvasGraphV0 = {
    schemaVersion: 0,
    version: state.version,
    nodes: state.nodes,
    edges: state.edges,
    layout: state.layout,
  };
  // Sin tours, el grafo no lleva el campo (así un lienzo sin tours recarga idéntico).
  if (Object.keys(state.tours).length > 0) graph.tours = state.tours;
  if (Object.keys(state.groups).length > 0) {
    graph.groups = state.groups;
    // La jerarquía va en `parentId`/`groupId`: al recargar no se vuelve a inferir por contención.
    graph.groupNesting = 'explicit';
  }
  if (Object.keys(state.stickyNotes).length > 0) graph.stickyNotes = state.stickyNotes;
  return graph;
}

/** Hook para leer el store desde componentes. */
export function useGraph<T>(store: StoreApi<GraphStore>, selector: (s: GraphStore) => T): T {
  return useStore(store, selector);
}
