import type { Group, Node, StickyNote, WalkieCanvasGraphV0 } from '../schema/walkie-graph';

/**
 * Jerarquía de grupos (spec recorridos-y-grupos, parte 1): un nodo y una nota pertenecen a un grupo por `groupId`;
 * un grupo, a otro por `parentId`. La pertenencia es explícita y se guarda; la posición en el lienzo solo decide
 * a qué grupo va algo al soltarlo. Todo aquí es puro: lo usan el store y el lienzo.
 */
export interface Hierarchy {
  nodes: Record<string, Node>;
  groups: Record<string, Group>;
  stickyNotes: Record<string, StickyNote>;
}

/** Grupo que contiene directamente a `id` (nodo, nota o grupo); `null` si está suelto en el lienzo. */
export function ownerOf(h: Hierarchy, id: string): string | null {
  const owner = h.nodes[id]?.groupId ?? h.stickyNotes[id]?.groupId ?? h.groups[id]?.parentId;
  return owner && h.groups[owner] ? owner : null;
}

/** Grupos que contienen a `id`, del más cercano al más externo. Corta si encuentra un ciclo (datos corruptos). */
export function ancestorsOf(h: Hierarchy, id: string): string[] {
  const chain: string[] = [];
  const seen = new Set([id]);
  let current = ownerOf(h, id);
  while (current && !seen.has(current)) {
    chain.push(current);
    seen.add(current);
    current = ownerOf(h, current);
  }
  return chain;
}

/** Profundidad de un grupo (0 = suelto en el lienzo). */
export function depthOf(h: Hierarchy, id: string): number {
  return ancestorsOf(h, id).length;
}

/** ¿`id` está dentro de `groupId`, a cualquier profundidad? */
export function isInside(h: Hierarchy, id: string, groupId: string): boolean {
  return ancestorsOf(h, id).includes(groupId);
}

/** Todo lo que vive dentro de `groupId`, a cualquier profundidad. */
export function descendantsOf(h: Hierarchy, groupId: string): { groups: string[]; nodes: string[]; notes: string[] } {
  const inside = (id: string) => isInside(h, id, groupId);
  return {
    groups: Object.keys(h.groups).filter(inside),
    nodes: Object.keys(h.nodes).filter(inside),
    notes: Object.keys(h.stickyNotes).filter(inside),
  };
}

/**
 * ¿Se puede meter `id` en `groupId`? Un grupo no entra en sí mismo ni en uno de sus descendientes (no hay ciclos).
 * `null` (sacar al lienzo) siempre se puede.
 */
export function canNest(h: Hierarchy, id: string, groupId: string | null): boolean {
  if (groupId === null) return true;
  if (!h.groups[groupId] || id === groupId) return false;
  return !(h.groups[id] && isInside(h, groupId, id));
}

/**
 * Lo que se ve de `id` con los grupos `collapsed` plegados: el grupo plegado más externo que lo contiene, o él
 * mismo si ninguno lo está. Los extremos de una conexión se dibujan contra esto (parte 2).
 */
export function visibleEnd(h: Hierarchy, id: string, collapsed: ReadonlySet<string>): string {
  const chain = ancestorsOf(h, id);
  for (let i = chain.length - 1; i >= 0; i--) if (collapsed.has(chain[i]!)) return chain[i]!;
  return id;
}

/** ¿Algún grupo que contiene a `id` está plegado? (entonces `id` no se dibuja). */
export function isHidden(h: Hierarchy, id: string, collapsed: ReadonlySet<string>): boolean {
  return ancestorsOf(h, id).some((g) => collapsed.has(g));
}

/** Grupo más profundo que contiene a todos los `ids` (su ancestro común), o `null`. */
export function commonOwner(h: Hierarchy, ids: readonly string[]): string | null {
  if (ids.length === 0) return null;
  const chains = ids.map((id) => ancestorsOf(h, id));
  return chains[0]!.find((g) => chains.every((c) => c.includes(g))) ?? null;
}

/** Tamaño aproximado de una nota adhesiva (el mínimo de `.sticky-note`), para saber dónde cae. */
const NOTE_SIZE = { w: 184, h: 72 } as const;

type Box = { x: number; y: number; w: number; h: number };

/**
 * Lienzos guardados antes de la jerarquía explícita (sin `groupNesting`): cada grupo pasa a estar dentro del grupo
 * más chico cuya caja lo contiene por completo, y cada nota dentro del más chico que contiene su caja. Los `groupId`
 * de los nodos se conservan tal cual (eran la relación conocida). Contención ambigua —dos candidatos del mismo
 * tamaño, o cajas que solo se solapan— deja el elemento suelto: mejor no adivinar. No crea ciclos: el padre siempre
 * es estrictamente más grande.
 */
export function inferHierarchy(graph: WalkieCanvasGraphV0): WalkieCanvasGraphV0 {
  if (graph.groupNesting === 'explicit' || !graph.groups || Object.keys(graph.groups).length === 0) return graph;
  const boxes: Record<string, Box> = {};
  for (const id of Object.keys(graph.groups)) {
    const at = graph.layout[id];
    if (at?.w && at.h) boxes[id] = { x: at.x, y: at.y, w: at.w, h: at.h };
  }
  const area = (b: Box) => b.w * b.h;
  const contains = (outer: Box, inner: Box) =>
    outer.x <= inner.x && outer.y <= inner.y && outer.x + outer.w >= inner.x + inner.w && outer.y + outer.h >= inner.y + inner.h;
  /** El contenedor más chico; `null` si no hay o si hay empate. */
  const tightest = (inner: Box, exclude?: string) => {
    const candidates = Object.entries(boxes)
      .filter(([id, box]) => id !== exclude && contains(box, inner) && area(box) > area(inner))
      .sort((a, b) => area(a[1]) - area(b[1]));
    if (candidates.length === 0) return null;
    if (candidates.length > 1 && area(candidates[0]![1]) === area(candidates[1]![1])) return null;
    return candidates[0]![0];
  };

  const groups = Object.fromEntries(
    Object.entries(graph.groups).map(([id, group]) => {
      const box = boxes[id];
      const parent = group.parentId ?? (box ? tightest(box, id) : null);
      return [id, parent ? { ...group, parentId: parent } : group];
    }),
  );
  const stickyNotes = graph.stickyNotes
    ? Object.fromEntries(
        Object.entries(graph.stickyNotes).map(([id, note]) => {
          const at = graph.layout[id];
          const owner = note.groupId ?? (at ? tightest({ x: at.x, y: at.y, w: NOTE_SIZE.w, h: NOTE_SIZE.h }) : null);
          return [id, owner ? { ...note, groupId: owner } : note];
        }),
      )
    : undefined;
  return { ...graph, groups, ...(stickyNotes ? { stickyNotes } : {}), groupNesting: 'explicit' };
}
