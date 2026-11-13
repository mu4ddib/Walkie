import type { Edge, Group, ModuleInterface, Node, StickyNote, Tour, WalkieCanvasGraphV0 } from '../schema/walkie-graph';
import { EDGE_TEXT_MAX_LENGTH, INTERFACE_NAME_MAX_LENGTH, TITLE_MAX_LENGTH, type InterfaceKind } from '../store/graphStore';
import { GRID } from '../theme/palette';
import { MODULE_MIN_WIDTH } from './moduleMeta';

/**
 * Convertir una selección en módulo (spec modulos-compartidos, criterios 5 a 8). Todo es puro: con el grafo de la
 * feature, lo seleccionado y lo que la persona decidió (qué cajas de fuera incluir, cómo llamar las interfaces) arma el
 * lienzo del módulo, el de la feature ya reescrito y lo que hay que contarle antes de confirmar.
 */

/** Margen del lienzo del módulo: lo de dentro conserva sus posiciones relativas a partir de aquí. */
export const MODULE_ORIGIN = { x: GRID * 10, y: GRID * 10 };

export interface ExtractOptions {
  /** Cajas, grupos y notas seleccionados (un grupo incluye todo lo suyo, a cualquier profundidad). */
  roots: readonly string[];
  /** Cajas de fuera conectadas a la selección que también entran (ej. la base de datos). */
  include?: readonly string[];
  /** Nombre de cada interfaz propuesta, por su clave (`interfaceKey`). */
  names?: Record<string, string>;
  moduleId: string;
  moduleName: string;
  /** Id de la caja del módulo que reemplaza la selección en la feature. */
  moduleNodeId: string;
  /** Genera los ids de las interfaces y los tours internos (estables entre recálculos si se pasan los mismos). */
  newId: () => string;
  /** Ids ya elegidos por clave (así un reintento propone lo mismo); los nuevos se anotan en el mismo objeto. */
  ids?: Record<string, string>;
}

/** Conexión que cruza el límite: un extremo dentro, el otro fuera. */
export interface CrossingEdge {
  edge: Edge;
  inside: string;
  outside: string;
  /** `in`: llega al módulo desde fuera; `out`: sale del módulo. */
  direction: 'in' | 'out';
  /** Clave de la interfaz por la que pasa. */
  interfaceKey: string;
}

export interface ProposedInterface {
  key: string;
  id: string;
  name: string;
  kind: InterfaceKind;
  /** Caja interna que la implementa. */
  nodeId: string;
  /** Conexiones que pasan por ella. */
  edges: string[];
  /** Una dependencia (`requires`): la caja de fuera de la que depende. */
  dependsOn?: string;
}

export interface ExtractPlan {
  nodes: string[];
  groups: string[];
  notes: string[];
  internalEdges: string[];
  crossing: CrossingEdge[];
  /** Cajas de fuera conectadas a la selección (candidatas a incluirse o a quedar como dependencia). */
  external: string[];
  interfaces: ProposedInterface[];
  /** Qué pasa con los tours y recorridos (se explica antes de confirmar). */
  tourNotes: string[];
  /** Lo que pierde su vínculo y conviene revisar. */
  warnings: string[];
  module: WalkieCanvasGraphV0;
  feature: WalkieCanvasGraphV0;
  /** Ids generados por clave: pasarlos de nuevo (`options.ids`) da el mismo plan, sin ids nuevos. */
  ids: Record<string, string>;
}

export function interfaceKey(nodeId: string, kind: InterfaceKind): string {
  return `${nodeId}:${kind}`;
}

/** Lo que entra al módulo: lo seleccionado, todo lo de dentro de sus grupos y las cajas de fuera elegidas. */
export function membersOf(graph: WalkieCanvasGraphV0, roots: readonly string[], include: readonly string[] = []) {
  const groups = graph.groups ?? {};
  const notes = graph.stickyNotes ?? {};
  const inGroups = new Set<string>();
  const pending = roots.filter((id) => groups[id]);
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (inGroups.has(id)) continue;
    inGroups.add(id);
    for (const g of Object.values(groups)) if (g.parentId === id) pending.push(g.id);
  }
  const nodes = new Set<string>();
  for (const id of [...roots, ...include]) if (graph.nodes[id]) nodes.add(id);
  for (const n of Object.values(graph.nodes)) if (n.groupId && inGroups.has(n.groupId)) nodes.add(n.id);
  const noteIds = new Set<string>();
  for (const id of roots) if (notes[id]) noteIds.add(id);
  for (const n of Object.values(notes)) if (n.groupId && inGroups.has(n.groupId)) noteIds.add(n.id);
  return { nodes, groups: inGroups, notes: noteIds };
}

/** El plan completo de la conversión. */
export function planExtraction(graph: WalkieCanvasGraphV0, options: ExtractOptions): ExtractPlan {
  const { nodes: inNodes, groups: inGroups, notes: inNotes } = membersOf(graph, options.roots, options.include);
  const edges = Object.values(graph.edges);
  const inside = (id: string) => inNodes.has(id);
  const internal = edges.filter((e) => inside(e.from) && inside(e.to));
  const internalIds = new Set(internal.map((e) => e.id));
  const crossingRaw = edges.filter((e) => inside(e.from) !== inside(e.to));
  const warnings: string[] = [];
  const tourNotes: string[] = [];
  const title = (id: string) => graph.nodes[id]?.title ?? id;

  // Interfaces: una por caja interna y tipo. Una respuesta sale por la interfaz de su solicitud.
  const proposals = new Map<string, ProposedInterface>();
  // Se anotan aquí los ids nuevos: pasar el mismo objeto en el siguiente cálculo da los mismos ids.
  const ids = options.ids ?? {};
  const keyOf = new Map<string, string>();
  const crossingById = new Map(crossingRaw.map((e) => [e.id, e]));
  for (const e of crossingRaw) {
    if (e.kind === 'response' && e.replyTo && crossingById.has(e.replyTo)) continue;
    const direction = inside(e.to) ? 'in' : 'out';
    const innerId = direction === 'in' ? e.to : e.from;
    const outerId = direction === 'in' ? e.from : e.to;
    const kind: InterfaceKind = e.kind === 'event' ? 'event' : direction === 'in' ? 'provides' : 'requires';
    const key = interfaceKey(innerId, kind);
    keyOf.set(e.id, key);
    const found = proposals.get(key);
    if (found) {
      found.edges.push(e.id);
      continue;
    }
    ids[key] ??= options.newId();
    proposals.set(key, {
      key,
      id: ids[key]!,
      // Una dependencia se llama como lo que necesita de fuera; lo demás, como su caja interna.
      name: kind === 'requires' ? title(outerId) : title(innerId),
      kind,
      nodeId: innerId,
      edges: [e.id],
      dependsOn: kind === 'requires' ? outerId : undefined,
    });
  }
  for (const e of crossingRaw) {
    if (keyOf.has(e.id)) continue;
    const key = keyOf.get(e.replyTo!);
    if (key) {
      keyOf.set(e.id, key);
      proposals.get(key)!.edges.push(e.id);
    }
  }
  // Nombres únicos (los que la persona escribió mandan).
  const taken = new Set<string>();
  for (const p of proposals.values()) {
    const base = (options.names?.[p.key] ?? p.name).trim().slice(0, INTERFACE_NAME_MAX_LENGTH) || 'Interfaz';
    let name = base;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base.slice(0, INTERFACE_NAME_MAX_LENGTH - 3)} ${n}`;
    taken.add(name.toLowerCase());
    p.name = name;
  }
  const interfaces = [...proposals.values()];
  const crossing: CrossingEdge[] = crossingRaw.map((e) => ({
    edge: e,
    inside: inside(e.to) ? e.to : e.from,
    outside: inside(e.to) ? e.from : e.to,
    direction: inside(e.to) ? 'in' : 'out',
    interfaceKey: keyOf.get(e.id)!,
  }));
  const external = [...new Set(crossing.map((c) => c.outside))];

  // ---------- Lienzo del módulo ----------
  const boxes = [...inNodes, ...inGroups, ...inNotes].map((id) => graph.layout[id]).filter((b) => !!b);
  const minX = boxes.length ? Math.min(...boxes.map((b) => b.x)) : 0;
  const minY = boxes.length ? Math.min(...boxes.map((b) => b.y)) : 0;
  const shift = (id: string) => {
    const b = graph.layout[id];
    return b ? { ...b, x: b.x - minX + MODULE_ORIGIN.x, y: b.y - minY + MODULE_ORIGIN.y } : undefined;
  };
  const moduleNodes: Record<string, Node> = {};
  for (const id of inNodes) {
    const node: Node = JSON.parse(JSON.stringify(graph.nodes[id])) as Node;
    if (node.groupId && !inGroups.has(node.groupId)) delete node.groupId;
    // Una regla de fuera deja de validar el input (y al revés, más abajo).
    if (node.inputs?.some((i) => i.ruleIds?.some((r) => !inNodes.has(r)))) {
      warnings.push(`«${node.title}»: sus inputs dejan de apuntar a reglas que quedan fuera del módulo.`);
      node.inputs = node.inputs.map((i) => {
        const ruleIds = i.ruleIds?.filter((r) => inNodes.has(r));
        const copy = { ...i, ruleIds };
        if (!ruleIds?.length) delete copy.ruleIds;
        return copy;
      });
    }
    moduleNodes[id] = node;
  }
  const moduleGroups: Record<string, Group> = {};
  for (const id of inGroups) {
    const group = { ...graph.groups![id]! };
    if (group.parentId && !inGroups.has(group.parentId)) delete group.parentId;
    moduleGroups[id] = group;
  }
  const moduleNotes: Record<string, StickyNote> = {};
  for (const id of inNotes) {
    const note = { ...graph.stickyNotes![id]! };
    if (note.groupId && !inGroups.has(note.groupId)) delete note.groupId;
    moduleNotes[id] = note;
  }
  const moduleEdges: Record<string, Edge> = {};
  for (const e of internal) {
    const copy = { ...e };
    if (copy.replyTo && !internalIds.has(copy.replyTo)) delete copy.replyTo;
    moduleEdges[e.id] = copy;
  }
  const moduleLayout: WalkieCanvasGraphV0['layout'] = {};
  for (const id of [...inNodes, ...inGroups, ...inNotes]) {
    const at = shift(id);
    if (at) moduleLayout[id] = at;
  }

  // ---------- Tours y recorridos ----------
  const moduleTours: Record<string, Tour> = {};
  const featureTours: Record<string, Tour> = {};
  const tourOfInterface = new Map<string, string>();
  for (const tour of Object.values(graph.tours ?? {})) {
    const flow = tour.kind === 'flow' || (!tour.kind && tour.steps.some((s) => s.edgeId || s.removedEdge));
    if (flow) {
      const insideSteps = tour.steps.filter((s) => s.edgeId && internalIds.has(s.edgeId));
      const kept = tour.steps.filter((s) => !(s.edgeId && internalIds.has(s.edgeId)));
      if (insideSteps.length > 0) {
        const id = (ids[`tour:${tour.id}`] ??= options.newId());
        moduleTours[id] = { id, name: tour.name, kind: 'flow', steps: insideSteps.map((s) => ({ ...s })) };
        // La interfaz por la que entra el recorrido muestra lo de dentro con su recorrido interno.
        for (const s of kept) {
          const key = s.edgeId ? keyOf.get(s.edgeId) : undefined;
          if (key && !tourOfInterface.has(key)) tourOfInterface.set(key, id);
        }
        tourNotes.push(
          `«${tour.name}»: ${insideSteps.length} ${insideSteps.length === 1 ? 'paso pasa' : 'pasos pasan'} al recorrido interno «${tour.name}» del módulo; ${
            kept.length === 0
              ? 'en la feature el recorrido queda vacío.'
              : `en la feature quedan ${kept.length} (las conexiones que cruzan siguen siendo las mismas).`
          }`,
        );
      } else if (tour.steps.some((s) => s.edgeId && crossingById.has(s.edgeId))) {
        tourNotes.push(`«${tour.name}»: sus pasos por conexiones que cruzan se conservan (ahora llegan a la caja del módulo).`);
      }
      featureTours[tour.id] = { ...tour, steps: kept };
    } else {
      const insideSteps = tour.steps.filter((s) => s.nodeId && inNodes.has(s.nodeId));
      if (insideSteps.length > 0) {
        const id = (ids[`tour:${tour.id}`] ??= options.newId());
        moduleTours[id] = { id, name: tour.name, kind: 'guide', steps: insideSteps.map((s) => ({ ...s })) };
        tourNotes.push(
          `«${tour.name}»: ${insideSteps.length} ${insideSteps.length === 1 ? 'paso apuntaba' : 'pasos apuntaban'} a lo convertido; en la feature apuntan a la caja del módulo y el detalle queda en el tour «${tour.name}» del módulo.`,
        );
      }
      // Pasos seguidos sobre lo convertido se juntan en uno (con la primera nota).
      const steps: Tour['steps'] = [];
      for (const s of tour.steps) {
        const moved = s.nodeId && inNodes.has(s.nodeId);
        const step = moved ? { ...s, nodeId: options.moduleNodeId } : s;
        const last = steps[steps.length - 1];
        if (moved && last?.nodeId === options.moduleNodeId) continue;
        steps.push(step);
      }
      featureTours[tour.id] = { ...tour, steps };
    }
  }

  const moduleInterfaces: Record<string, ModuleInterface> = {};
  for (const p of interfaces) {
    const item: ModuleInterface = { id: p.id, name: p.name, kind: p.kind, nodeId: p.nodeId };
    const tourId = tourOfInterface.get(p.key);
    if (tourId) item.tourId = tourId;
    moduleInterfaces[p.id] = item;
  }

  const module: WalkieCanvasGraphV0 = {
    schemaVersion: 0,
    version: 0,
    nodes: moduleNodes,
    edges: moduleEdges,
    layout: moduleLayout,
  };
  if (Object.keys(moduleTours).length > 0) module.tours = moduleTours;
  if (Object.keys(moduleGroups).length > 0) {
    module.groups = moduleGroups;
    module.groupNesting = 'explicit';
  }
  if (Object.keys(moduleNotes).length > 0) module.stickyNotes = moduleNotes;
  if (interfaces.length > 0) module.interfaces = moduleInterfaces;

  // ---------- Lienzo de la feature ----------
  const featureNodes: Record<string, Node> = {};
  for (const n of Object.values(graph.nodes)) {
    if (inNodes.has(n.id)) continue;
    let node = n;
    if (n.inputs?.some((i) => i.ruleIds?.some((r) => inNodes.has(r)))) {
      warnings.push(`«${n.title}»: sus inputs dejan de apuntar a reglas que pasan al módulo.`);
      node = {
        ...n,
        inputs: n.inputs.map((i) => {
          const ruleIds = i.ruleIds?.filter((r) => !inNodes.has(r));
          const copy = { ...i, ruleIds };
          if (!ruleIds?.length) delete copy.ruleIds;
          return copy;
        }),
      };
    }
    featureNodes[n.id] = node;
  }
  // La caja del módulo queda donde estaba lo seleccionado (dentro de su grupo común, si lo tenía).
  const owners = new Set(
    [...inNodes].map((id) => graph.nodes[id]?.groupId).concat([...inGroups].map((id) => graph.groups?.[id]?.parentId)),
  );
  const owner = owners.size === 1 ? [...owners][0] : undefined;
  const moduleNode: Node = {
    id: options.moduleNodeId,
    type: 'module',
    title: options.moduleName.trim().slice(0, TITLE_MAX_LENGTH) || 'Módulo',
    moduleId: options.moduleId,
  };
  if (owner && !inGroups.has(owner) && graph.groups?.[owner]) moduleNode.groupId = owner;
  featureNodes[moduleNode.id] = moduleNode;

  const featureEdges: Record<string, Edge> = {};
  for (const e of edges) {
    if (internalIds.has(e.id)) continue;
    const c = crossing.find((x) => x.edge.id === e.id);
    if (!c) {
      featureEdges[e.id] = e;
      continue;
    }
    const p = proposals.get(c.interfaceKey);
    const copy: Edge = { ...e };
    const ref = p ? { id: p.id, name: p.name } : undefined;
    if (c.direction === 'in') {
      copy.to = options.moduleNodeId;
      if (ref) copy.toInterface = ref;
    } else {
      copy.from = options.moduleNodeId;
      if (ref) copy.fromInterface = ref;
      // La salida de una decisión era de una caja que pasó al módulo: se conserva su etiqueta como condición.
      if (copy.branch) {
        const label = graph.nodes[e.from]?.branches?.find((b) => b.id === copy.branch)?.label;
        delete copy.branch;
        if (label && !copy.when) copy.when = label.slice(0, EDGE_TEXT_MAX_LENGTH);
        warnings.push(`La rama «${label ?? '?'}» de «${title(e.from)}» sale ahora del módulo: queda como condición de la conexión.`);
      }
    }
    if (copy.replyTo && internalIds.has(copy.replyTo)) {
      delete copy.replyTo;
      warnings.push(`Una respuesta hacia «${title(c.outside)}» respondía a una solicitud que pasa al módulo: queda sin su solicitud.`);
    }
    featureEdges[e.id] = copy;
  }

  const featureLayout: WalkieCanvasGraphV0['layout'] = {};
  for (const [id, at] of Object.entries(graph.layout)) {
    if (!inNodes.has(id) && !inGroups.has(id) && !inNotes.has(id)) featureLayout[id] = at;
  }
  const width = boxes.length ? Math.max(...boxes.map((b) => b.x + (b.w ?? 0))) - minX : 0;
  featureLayout[moduleNode.id] = {
    x: minX,
    y: minY,
    w: Math.max(MODULE_MIN_WIDTH, Math.min(GRID * 40, Math.round(width / GRID) * GRID)),
  };

  const featureGroups = Object.fromEntries(Object.entries(graph.groups ?? {}).filter(([id]) => !inGroups.has(id)));
  const featureNotes = Object.fromEntries(Object.entries(graph.stickyNotes ?? {}).filter(([id]) => !inNotes.has(id)));
  // Una interfaz del lienzo de origen (si es otro módulo) cuya caja pasa al módulo nuevo, apunta a su caja.
  const featureInterfaces = Object.fromEntries(
    Object.entries(graph.interfaces ?? {}).map(([id, i]) => [id, inNodes.has(i.nodeId) ? { ...i, nodeId: moduleNode.id } : i]),
  );
  const feature: WalkieCanvasGraphV0 = {
    schemaVersion: 0,
    version: graph.version,
    nodes: featureNodes,
    edges: featureEdges,
    layout: featureLayout,
  };
  if (Object.keys(featureTours).length > 0) feature.tours = featureTours;
  if (Object.keys(featureGroups).length > 0) {
    feature.groups = featureGroups;
    feature.groupNesting = 'explicit';
  }
  if (Object.keys(featureNotes).length > 0) feature.stickyNotes = featureNotes;
  if (Object.keys(featureInterfaces).length > 0) feature.interfaces = featureInterfaces;

  for (const step of Object.values(graph.tours ?? {}).flatMap((t) => t.steps)) {
    if (step.removedEdge && (inNodes.has(step.removedEdge.from) || inNodes.has(step.removedEdge.to))) {
      warnings.push('Un paso de recorrido ya marcado como pendiente (su conexión se había eliminado) apunta a algo convertido: revísalo.');
      break;
    }
  }

  return {
    nodes: [...inNodes],
    groups: [...inGroups],
    notes: [...inNotes],
    internalEdges: [...internalIds],
    crossing,
    external,
    interfaces,
    tourNotes,
    warnings,
    module,
    feature,
    ids,
  };
}
