import type { Edge, Group, ModuleInterface, Node, StickyNote, Tour, WalkieCanvasGraphV0 } from '../schema/walkie-graph';

/** Interfaces quitadas de un módulo → a qué interfaz pasan sus conexiones (`to`) o, sin él, al módulo completo. */
export type InterfaceRedirects = NonNullable<WalkieCanvasGraphV0['interfaceRedirects']>;

/**
 * Historial del lienzo (deshacer y rehacer). Guarda instantáneas del grafo: como el store nunca muta (cada acción
 * crea objetos nuevos solo donde cambia algo), una instantánea son ocho referencias y no cuesta copiar nada.
 * Selección, vista, reproducción y plegados temporales no son del grafo: no entran aquí.
 */
export interface Snapshot {
  nodes: Record<string, Node>;
  edges: Record<string, Edge>;
  layout: WalkieCanvasGraphV0['layout'];
  tours: Record<string, Tour>;
  groups: Record<string, Group>;
  stickyNotes: Record<string, StickyNote>;
  /** Interfaces de un módulo (spec modulos-compartidos); vacío en una feature. */
  interfaces: Record<string, ModuleInterface>;
  /** Interfaces quitadas y adónde pasan sus conexiones (las features las resuelven al leer el módulo). */
  interfaceRedirects: InterfaceRedirects;
}

const FIELDS = ['nodes', 'edges', 'layout', 'tours', 'groups', 'stickyNotes', 'interfaces', 'interfaceRedirects'] as const;

/** Pasos que se recuerdan; los más viejos se olvidan. */
export const HISTORY_LIMIT = 100;
/** Cambios seguidos sobre lo mismo (escribir en un campo, redimensionar) dentro de este tiempo son un solo paso. */
export const COALESCE_MS = 800;

export function snapshotOf(state: Snapshot): Snapshot {
  return {
    nodes: state.nodes,
    edges: state.edges,
    layout: state.layout,
    tours: state.tours,
    groups: state.groups,
    stickyNotes: state.stickyNotes,
    interfaces: state.interfaces,
    interfaceRedirects: state.interfaceRedirects,
  };
}

/** ¿Mismo grafo? Por referencia: el store no muta, así que referencias iguales son contenido igual. */
export function sameSnapshot(a: Snapshot, b: Snapshot): boolean {
  return FIELDS.every((f) => a[f] === b[f]);
}

/** Qué cambió entre dos instantáneas ("nodes:n1,layout:n1"): sirve para unir cambios seguidos sobre lo mismo. */
export function changeKey(a: Snapshot, b: Snapshot): string {
  const parts: string[] = [];
  for (const field of FIELDS) {
    const before = a[field] as Record<string, unknown>;
    const after = b[field] as Record<string, unknown>;
    if (before === after) continue;
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const x = before[key];
      const y = after[key];
      if (x === y) continue;
      // Dentro de un elemento, qué propiedades cambiaron: escribir el título y luego la descripción son dos pasos.
      if (x && y && typeof x === 'object' && typeof y === 'object') {
        const a = x as Record<string, unknown>;
        const b = y as Record<string, unknown>;
        const props = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((p) => a[p] !== b[p]);
        parts.push(`${field}:${key}.${props.sort().join('+')}`);
      } else parts.push(`${field}:${key}`);
    }
  }
  return parts.sort().join(',');
}

/**
 * Pila de deshacer/rehacer con agrupación. Un cambio se une al paso anterior si:
 * - ocurre dentro de un lote (`begin`/`end`: un arrastre de principio a fin),
 * - ocurre en la misma tarea que el anterior (un gesto que dispara varias acciones seguidas: crear una caja y
 *   meterla en un grupo, borrar una selección con sus conexiones), o
 * - toca exactamente lo mismo que el anterior hace menos de `COALESCE_MS` (cada tecla al escribir un título).
 */
export class History {
  private past: Snapshot[] = [];
  private future: Snapshot[] = [];
  private lastKey = '';
  private lastAt = 0;
  private sameTask = false;
  private depth = 0;
  private batchStarted = false;

  constructor(private readonly now: () => number = () => Date.now()) {}

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }

  /** Olvida todo (al cargar otro grafo). */
  reset() {
    this.past = [];
    this.future = [];
    this.lastKey = '';
    this.depth = 0;
    this.batchStarted = false;
  }

  /** Anota que el grafo pasó de `before` a `after`. */
  record(before: Snapshot, after: Snapshot) {
    const key = changeKey(before, after);
    const at = this.now();
    const join =
      (this.depth > 0 && this.batchStarted) ||
      this.sameTask ||
      (key === this.lastKey && at - this.lastAt < COALESCE_MS);
    if (!join) {
      this.past.push(before);
      if (this.past.length > HISTORY_LIMIT) this.past.shift();
    }
    this.future = [];
    if (this.depth > 0) this.batchStarted = true;
    this.lastKey = key;
    this.lastAt = at;
    if (!this.sameTask) {
      this.sameTask = true;
      queueMicrotask(() => {
        this.sameTask = false;
      });
    }
  }

  /** Lo que hay que mostrar al deshacer desde `current`, o `null` si no hay nada. */
  undo(current: Snapshot): Snapshot | null {
    const previous = this.past.pop();
    if (!previous) return null;
    this.future.push(current);
    this.lastKey = '';
    return previous;
  }

  redo(current: Snapshot): Snapshot | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(current);
    this.lastKey = '';
    return next;
  }

  begin() {
    if (this.depth === 0) this.batchStarted = false;
    this.depth++;
  }

  end() {
    if (this.depth > 0) this.depth--;
    if (this.depth === 0) this.lastKey = '';
  }
}
