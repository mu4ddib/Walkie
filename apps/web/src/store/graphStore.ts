import { createStore, type StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { v7 as uuidv7 } from 'uuid';
import type { Edge, Group, InterfaceRef, ModuleInterface, Node, StickyNote, Tour, WalkieCanvasGraphV0 } from '../schema/walkie-graph';
import { GRID } from '../theme/palette';
import {
  normalizeDatabase,
  normalizeEdgeData,
  normalizeEdgeRequest,
  normalizeExchange,
  normalizeHttp,
  normalizeResult,
} from '../contracts/contracts';
import { canNest, descendantsOf, inferHierarchy, isInside, ownerOf } from './hierarchy';
import { History, sameSnapshot, snapshotOf, type InterfaceRedirects, type Snapshot } from './history';
export type { InterfaceRedirects } from './history';
import { tourKind, type TourKind } from '../tours/flows';
import { kindFor } from '../interactions/operations';
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
export const CATALOG_NODE_TYPES: readonly NodeType[] = ['api', 'service', 'database', 'resource'];

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
  /** Interfaz del módulo de origen o destino (spec modulos-compartidos); `null` la quita (el módulo completo). */
  fromInterface?: InterfaceRef | null;
  toInterface?: InterfaceRef | null;
  /**
   * Operación (spec interacciones, ADR-0011): la fuente de verdad del verbo y los retornos. Al fijarla se quita el
   * `data.operation` anterior (sus entidades pasan al intercambio); `null` vuelve a interpretar la conexión por su tipo.
   */
  operation?: Edge['operation'] | null;
  /** Nombre de la operación personalizada (texto vacío lo quita). */
  customOperation?: string;
  pattern?: Edge['pattern'] | null;
  technology?: string;
  /** Detalle técnico del intercambio (se normaliza; vacío lo quita). */
  exchange?: Edge['exchange'] | null;
  /** Tipo de retorno (solo en un retorno). */
  result?: Edge['result'] | null;
  /** Retorno que es parte de un stream (secuencia) y no un escenario alternativo. */
  stream?: boolean;
  /** Respuesta asíncrona: la operación original con la que se correlaciona; `null` la desvincula. */
  correlatesWith?: string | null;
}

/** Tipo de una interfaz de módulo: ofrece, evento o dependencia requerida. */
export type InterfaceKind = ModuleInterface['kind'];
export const INTERFACE_KINDS: readonly InterfaceKind[] = ['provides', 'event', 'requires'];
export const INTERFACE_NAME_MAX_LENGTH = 60;
export const INTERFACE_DESCRIPTION_MAX_LENGTH = 500;

/** Cambios de una interfaz; un texto vacío quita la descripción y `tourId: null` el recorrido interno. */
export interface InterfacePatch {
  name?: string;
  description?: string;
  kind?: InterfaceKind;
  nodeId?: string;
  tourId?: string | null;
}

/** Extremo de conexión que es una caja de módulo: a qué interfaz apunta (o al módulo completo). */
export interface ConnectInit {
  branch?: string | null;
  fromInterface?: InterfaceRef | null;
  toInterface?: InterfaceRef | null;
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
  module: 'Módulo',
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
  const dangling = (e: Edge) => (e.replyTo && !edges[e.replyTo]) || (e.correlatesWith && !edges[e.correlatesWith]);
  if (!Object.values(edges).some(dangling)) return edges;
  return Object.fromEntries(
    Object.entries(edges).map(([key, e]) => {
      if (!dangling(e)) return [key, e];
      const copy = { ...e };
      if (copy.replyTo && !edges[copy.replyTo]) delete copy.replyTo;
      if (copy.correlatesWith && !edges[copy.correlatesWith]) delete copy.correlatesWith;
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
  /** Interfaces del lienzo de un módulo (spec modulos-compartidos, ADR-0010); vacío en una feature. */
  interfaces: Record<string, ModuleInterface>;
  /** Interfaces quitadas del módulo y adónde pasan sus conexiones (spec modulos-compartidos). */
  interfaceRedirects: InterfaceRedirects;
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
    item: {
      type: NodeType;
      title: string;
      description?: string;
      http?: Node['http'];
      database?: Node['database'];
      resource?: Node['resource'];
      runtime?: Node['runtime'];
    },
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
  connect(from: string, to: string, kind?: EdgeKind, init?: ConnectInit): string | null;
  /**
   * Respuesta a una solicitud: conexión `response` en sentido inverso, vinculada con `replyTo`. Una solicitud puede
   * tener varias (éxito, error). Devuelve su id o `null` si `requestId` no es una conexión `request`.
   */
  /**
   * Retorno de una operación (spec interacciones): el resultado de una consulta, la respuesta HTTP, la confirmación de
   * una publicación… En sentido inverso, vinculado por `replyTo`. Cualquier operación que no sea un retorno, una
   * navegación o una relación general lo admite (el inspector decide cuándo ofrecerlo según la operación).
   */
  addResponse(requestId: string, init?: { status?: number; label?: string; result?: Edge['result']; stream?: boolean }): string | null;
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
  /**
   * Marcas de reproducción de un paso (spec interacciones): `parallel` ocurre a la vez que el anterior (no en el
   * primero) y `timeout` termina sin retorno (solo en pasos de conexión). `false` quita la marca.
   */
  setStepFlags(tourId: string, index: number, flags: { parallel?: boolean; timeout?: boolean }): void;
  /**
   * Migración de conexiones anteriores (spec interacciones): fija su operación (y el trazo que le corresponde) sin
   * marcar cambios ni sumar un paso al historial, como `loadGraph` con lo que deduce. Se guarda con el próximo guardado.
   */
  migrateOperations(operations: Record<string, NonNullable<Edge['operation']>>): void;
  /** Sube (-1) o baja (+1) un paso; fuera de rango no hace nada. */
  moveStep(tourId: string, index: number, delta: -1 | 1): void;
  removeStep(tourId: string, index: number): void;
  /**
   * Tras un guardado exitoso: adopta la versión del servidor. Limpia `dirty` solo si el grafo
   * sigue siendo el que se envió (`sent`); si hubo cambios mientras viajaba la petición, siguen pendientes.
   */
  markSaved(version: number, sent?: GraphState): void;
  /**
   * Módulos compartidos (spec modulos-compartidos, ADR-0010). `addModuleRef` pone la caja de un módulo (`moduleId` y su
   * nombre como último conocido); `setModuleDisplay` cambia su presentación en este lienzo; `relinkModule` la apunta a
   * otro módulo (sus conexiones pasan al módulo completo); `resizeNode` guarda su tamaño en `layout`.
   */
  addModuleRef(module: { id: string; name: string }, position: Position): string;
  setModuleDisplay(id: string, patch: { description?: boolean; interfaces?: boolean }): void;
  relinkModule(id: string, module: { id: string; name: string }, options?: { keepInterfaces?: boolean }): void;
  resizeNode(id: string, size: { w: number; h?: number }): void;
  /** Interfaces del lienzo de un módulo: nombre único (sin distinguir mayúsculas) y una caja existente. */
  addInterface(init: { name: string; kind: InterfaceKind; nodeId: string; description?: string; tourId?: string }): string | null;
  updateInterface(id: string, patch: InterfacePatch): void;
  /**
   * Quita una interfaz. `redirect` dice adónde pasan sus conexiones en las features (`to`: otra interfaz; sin `to`, el
   * módulo completo); sin él quedan pendientes. Las redirecciones que llegaban a ella la siguen.
   */
  removeInterface(id: string, redirect?: { to?: string }): void;
  /**
   * Reemplaza el grafo entero en un solo paso del historial (no lo olvida, a diferencia de `loadGraph`): convertir una
   * selección en módulo se deshace con Ctrl+Z.
   */
  replaceGraph(graph: WalkieCanvasGraphV0): void;
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
  interfaces: {},
  interfaceRedirects: {},
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
          interfaces: graph.interfaces ?? {},
          interfaceRedirects: graph.interfaceRedirects ?? {},
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
        // Un recurso siempre lleva su subtipo (schema).
        if (item.type === 'resource') next.resource = normalizeResource(item.resource ?? { kind: 'custom' });
        if (item.type === 'service' && item.runtime) next.runtime = item.runtime;
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
          // Las interfaces que exponía la caja dejan de existir (se deshace con Ctrl+Z).
          const interfaces = Object.values(s.interfaces).some((i) => i.nodeId === id)
            ? Object.fromEntries(Object.entries(s.interfaces).filter(([, i]) => i.nodeId !== id))
            : s.interfaces;
          // Lo que se redirigía a ellas queda pendiente (como ellas).
          let interfaceRedirects = s.interfaceRedirects;
          for (const gone of Object.values(s.interfaces).filter((i) => i.nodeId === id)) {
            interfaceRedirects = retarget(interfaceRedirects, gone.id, null);
          }
          return { nodes, layout, edges, tours, interfaces, interfaceRedirects, dirty: true };
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
        // Solo el extremo que es un módulo apunta a una de sus interfaces.
        if (init?.fromInterface && source.type === 'module') edge.fromInterface = cleanInterfaceRef(init.fromInterface);
        if (init?.toInterface && target.type === 'module') edge.toInterface = cleanInterfaceRef(init.toInterface);
        set((s) => ({ edges: { ...s.edges, [id]: edge }, dirty: true }));
        return id;
      },

      addResponse: (requestId, init) => {
        const request = get().edges[requestId];
        if (!request || request.kind === 'response' || request.kind === 'navigation' || request.kind === 'uses') return null;
        const id = newId();
        let edge: Edge = { id, from: request.to, to: request.from, kind: 'response', replyTo: requestId };
        // La respuesta sale de la misma interfaz a la que llegó la solicitud (y vuelve a la que la hizo).
        if (request.toInterface) edge.fromInterface = request.toInterface;
        if (request.fromInterface) edge.toInterface = request.fromInterface;
        if (validStatus(init?.status)) edge.status = init.status;
        const result = normalizeResult(init?.result);
        if (result) edge.result = result;
        if (init?.stream) edge.stream = true;
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
          const operation = target && target.kind !== 'response' && target.kind !== 'navigation' && target.kind !== 'uses';
          if (target && target.id !== id && operation) next.replyTo = target.id;
          else if (patch.replyTo === null) delete next.replyTo;
        }
        if (patch.correlatesWith !== undefined) {
          if (patch.correlatesWith && patch.correlatesWith !== id && get().edges[patch.correlatesWith]) {
            next.correlatesWith = patch.correlatesWith;
          } else if (patch.correlatesWith === null) delete next.correlatesWith;
        }
        if (patch.operation !== undefined) {
          if (patch.operation && next.kind !== 'response') {
            next.operation = patch.operation;
            // La operación pasa a ser la fuente de verdad: el «Lee/Escribe» anterior se va (sus entidades se conservan).
            if (next.data?.operation) {
              const entities = next.data.entities;
              delete next.data;
              if (entities?.length && !next.exchange?.entities?.length) {
                next.exchange = normalizeExchange({ ...next.exchange, entities }) ?? next.exchange;
              }
              if (entities?.length && !next.exchange) next.data = { entities };
            }
          } else if (patch.operation === null) delete next.operation;
          if (next.operation !== 'custom') delete next.customOperation;
        }
        next = withText(next, 'customOperation', patch.customOperation, EDGE_TEXT_MAX_LENGTH);
        if (next.customOperation && next.operation !== 'custom') delete next.customOperation;
        if (patch.pattern !== undefined) {
          if (patch.pattern) next.pattern = patch.pattern;
          else delete next.pattern;
        }
        next = withText(next, 'technology', patch.technology, EDGE_TEXT_MAX_LENGTH);
        if (patch.exchange !== undefined) {
          const exchange = normalizeExchange(patch.exchange ?? undefined);
          if (exchange && next.kind !== 'response') next.exchange = exchange;
          else delete next.exchange;
        }
        if (patch.result !== undefined) {
          const result = normalizeResult(patch.result ?? undefined);
          if (result && next.kind === 'response') next.result = result;
          else delete next.result;
        }
        if (patch.stream !== undefined) {
          if (patch.stream && next.kind === 'response') next.stream = true;
          else delete next.stream;
        }
        // Un retorno no tiene operación propia; una operación no tiene tipo de retorno (schema).
        if (next.kind === 'response') {
          delete next.operation;
          delete next.customOperation;
          delete next.exchange;
        } else {
          delete next.result;
          delete next.stream;
        }
        if (patch.reverse) {
          next = { ...next, from: edge.to, to: edge.from };
          delete next.branch;
          delete next.fromInterface;
          delete next.toInterface;
          if (edge.toInterface) next.fromInterface = edge.toInterface;
          if (edge.fromInterface) next.toInterface = edge.fromInterface;
        }
        for (const end of ['from', 'to'] as const) {
          const key = end === 'from' ? 'fromInterface' : 'toInterface';
          const value = patch[key];
          if (value === undefined) continue;
          if (value && get().nodes[next[end]]?.type === 'module') next[key] = cleanInterfaceRef(value);
          else if (value === null) delete next[key];
        }
        if (patch.branch !== undefined) {
          if (patch.branch && get().nodes[next.from]?.branches?.some((b) => b.id === patch.branch)) {
            next.branch = patch.branch;
          } else if (patch.branch === null) delete next.branch;
        }
        if (sameJson(edge, next)) return;
        // Invertir una operación invierte también sus retornos: siguen yendo en sentido contrario (spec interacciones).
        const flipped =
          patch.reverse && next.kind !== 'response'
            ? Object.fromEntries(
                Object.values(get().edges)
                  .filter((e) => e.kind === 'response' && e.replyTo === id)
                  .map((e) => {
                    const r: Edge = { ...e, from: e.to, to: e.from };
                    delete r.fromInterface;
                    delete r.toInterface;
                    if (e.toInterface) r.fromInterface = e.toInterface;
                    if (e.fromInterface) r.toInterface = e.fromInterface;
                    return [e.id, r];
                  }),
              )
            : {};
        set((s) => ({ edges: { ...s.edges, ...flipped, [id]: next }, dirty: true }));
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
        set((s) => ({
          tours: omit(s.tours, id),
          // El recorrido interno de una interfaz ya no existe.
          interfaces: Object.values(s.interfaces).some((i) => i.tourId === id)
            ? Object.fromEntries(
                Object.entries(s.interfaces).map(([key, i]) => [key, i.tourId === id ? withoutTour(i) : i]),
              )
            : s.interfaces,
          dirty: true,
        }));
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

      migrateOperations: (operations) => {
        const wasDirty = get().dirty;
        replaying = true;
        for (const [id, operation] of Object.entries(operations)) {
          if (!get().edges[id]?.operation) get().updateEdge(id, { operation, kind: kindFor(operation) });
        }
        set({ dirty: wasDirty });
        replaying = false;
        if (!wasDirty) saved = snapshotOf(get());
      },

      setStepFlags: (tourId, index, flags) => {
        const tour = get().tours[tourId];
        const step = tour?.steps[index];
        if (!tour || !step) return;
        const next = { ...step };
        if (flags.parallel !== undefined && index > 0) {
          if (flags.parallel) next.parallel = true;
          else delete next.parallel;
        }
        if (flags.timeout !== undefined && (step.edgeId || !flags.timeout)) {
          if (flags.timeout) next.timeout = true;
          else delete next.timeout;
        }
        if (next.parallel === step.parallel && next.timeout === step.timeout) return;
        putTour({ ...tour, steps: tour.steps.map((x, i) => (i === index ? next : x)) });
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

      addModuleRef: (module, position) => {
        const id = newId();
        const title = module.name.trim().slice(0, TITLE_MAX_LENGTH) || DEFAULT_TITLES.module;
        set((s) => ({
          nodes: { ...s.nodes, [id]: { id, type: 'module', title, moduleId: module.id } },
          layout: { ...s.layout, [id]: { x: snap(position.x), y: snap(position.y) } },
          dirty: true,
        }));
        return id;
      },

      setModuleDisplay: (id, patch) => {
        const node = get().nodes[id];
        if (!node || node.type !== 'module') return;
        // Mostrar es lo de siempre: solo se guarda lo que se oculta.
        const display = { ...node.display, ...patch };
        for (const key of ['description', 'interfaces'] as const) if (display[key] !== false) delete display[key];
        const next: Node = { ...node, display };
        if (Object.keys(display).length === 0) delete next.display;
        putNode(next);
      },

      relinkModule: (id, module, options = {}) => {
        const node = get().nodes[id];
        if (!node || node.type !== 'module' || node.moduleId === module.id) return;
        const title = module.name.trim().slice(0, TITLE_MAX_LENGTH) || node.title;
        // Una copia independiente conserva los ids de sus interfaces: las conexiones siguen unidas.
        if (options.keepInterfaces) {
          putNode({ ...node, moduleId: module.id, title });
          return;
        }
        set((s) => ({
          nodes: { ...s.nodes, [id]: { ...node, moduleId: module.id, title } },
          // Las interfaces eran del módulo anterior: las conexiones pasan al módulo completo.
          edges: Object.fromEntries(
            Object.entries(s.edges).map(([key, e]) => {
              if (!(e.from === id && e.fromInterface) && !(e.to === id && e.toInterface)) return [key, e];
              const copy = { ...e };
              if (e.from === id) delete copy.fromInterface;
              if (e.to === id) delete copy.toInterface;
              return [key, copy];
            }),
          ),
          dirty: true,
        }));
      },

      resizeNode: (id, size) => {
        const at = get().layout[id];
        if (!at || !get().nodes[id]) return;
        const next = { ...at, w: snap(Math.max(GRID * 20, size.w)) };
        if (size.h !== undefined) next.h = snap(Math.max(GRID * 10, size.h));
        if (next.w === at.w && next.h === at.h) return;
        set((s) => ({ layout: { ...s.layout, [id]: next }, dirty: true }));
      },

      addInterface: (init) => {
        const name = init.name.trim().slice(0, INTERFACE_NAME_MAX_LENGTH);
        const s = get();
        if (!name || !s.nodes[init.nodeId] || interfaceNameTaken(s.interfaces, name)) return null;
        const id = newId();
        let item: ModuleInterface = { id, name, kind: init.kind, nodeId: init.nodeId };
        item = withText(item, 'description', init.description, INTERFACE_DESCRIPTION_MAX_LENGTH);
        if (init.tourId && s.tours[init.tourId]) item.tourId = init.tourId;
        set((st) => ({ interfaces: { ...st.interfaces, [id]: item }, dirty: true }));
        return id;
      },

      updateInterface: (id, patch) => {
        const s = get();
        const current = s.interfaces[id];
        if (!current) return;
        let next: ModuleInterface = { ...current };
        if (patch.name !== undefined) {
          const name = patch.name.trim().slice(0, INTERFACE_NAME_MAX_LENGTH);
          if (name && !interfaceNameTaken(s.interfaces, name, id)) next.name = name;
        }
        if (patch.kind && INTERFACE_KINDS.includes(patch.kind)) next.kind = patch.kind;
        if (patch.nodeId && s.nodes[patch.nodeId]) next.nodeId = patch.nodeId;
        next = withText(next, 'description', patch.description, INTERFACE_DESCRIPTION_MAX_LENGTH);
        if (patch.tourId === null) delete next.tourId;
        else if (patch.tourId && s.tours[patch.tourId]) next.tourId = patch.tourId;
        if (sameJson(current, next)) return;
        set((st) => ({ interfaces: { ...st.interfaces, [id]: next }, dirty: true }));
      },

      removeInterface: (id, redirect) => {
        const s = get();
        if (!s.interfaces[id]) return;
        const target = redirect?.to && redirect.to !== id && s.interfaces[redirect.to] ? redirect.to : undefined;
        set((st) => ({
          interfaces: omit(st.interfaces, id),
          interfaceRedirects: retarget(st.interfaceRedirects, id, redirect ? { ...(target ? { to: target } : {}) } : null),
          dirty: true,
        }));
      },

      replaceGraph: (graph) => {
        const loaded = inferHierarchy(graph);
        set({
          nodes: loaded.nodes,
          edges: loaded.edges,
          layout: loaded.layout,
          tours: withStepIds(withKinds(loaded.tours ?? {}), newId),
          groups: loaded.groups ?? {},
          stickyNotes: loaded.stickyNotes ?? {},
          interfaces: loaded.interfaces ?? {},
          interfaceRedirects: loaded.interfaceRedirects ?? {},
          dirty: true,
        });
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
            s.stickyNotes === sent.stickyNotes &&
            s.interfaces === sent.interfaces &&
            s.interfaceRedirects === sent.interfaceRedirects);
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
  if (Object.keys(state.interfaces).length > 0) graph.interfaces = state.interfaces;
  if (Object.keys(state.interfaceRedirects).length > 0) graph.interfaceRedirects = state.interfaceRedirects;
  return graph;
}

/** Hook para leer el store desde componentes. */
export function useGraph<T>(store: StoreApi<GraphStore>, selector: (s: GraphStore) => T): T {
  return useStore(store, selector);
}

/** Referencia a una interfaz con el nombre dentro del límite del schema. */
function cleanInterfaceRef(ref: InterfaceRef): InterfaceRef {
  return { id: ref.id, name: ref.name.trim().slice(0, INTERFACE_NAME_MAX_LENGTH) };
}

/** ¿Otra interfaz (no `except`) ya se llama así? Sin distinguir mayúsculas. */
export function interfaceNameTaken(interfaces: Record<string, ModuleInterface>, name: string, except?: string): boolean {
  const key = name.trim().toLowerCase();
  return Object.values(interfaces).some((i) => i.id !== except && i.name.trim().toLowerCase() === key);
}

function withoutTour(item: ModuleInterface): ModuleInterface {
  const copy = { ...item };
  delete copy.tourId;
  return copy;
}

/**
 * Redirecciones al quitar la interfaz `id`: ella apunta a `redirect` (o, con `null`, queda pendiente: sin entrada) y las
 * que apuntaban a ella la siguen, así cada redirección llega a una interfaz actual en un solo paso.
 */
function retarget(redirects: InterfaceRedirects, id: string, redirect: { to?: string } | null): InterfaceRedirects {
  const next: InterfaceRedirects = {};
  for (const [from, r] of Object.entries(redirects)) {
    if (r.to !== id) next[from] = r;
    else if (redirect) next[from] = redirect;
  }
  if (redirect) next[id] = redirect;
  else delete next[id];
  return next;
}
