import type { CatalogItem } from '../../api/client';
import { KIND_LABELS, edgeDisplay, edgeDisplayText } from '../../edges/edgeMeta';
import { nodeLabel } from '../../nodes/nodeMeta';
import type { Edge, Node } from '../../schema/walkie-graph';
import type { StepIssue, TourKind, TourStep } from '../../tours/flows';
import { branchLabel, nodeTitle } from '../../tours/flowText';
import { refTarget } from '../../catalog/catalogContext';

/**
 * Estado de interfaz de la sección de tours (spec tours-compactos): qué pasos están abiertos en cada tour, la búsqueda
 * y el desplazamiento de cada lista. Lo guarda el lienzo, nunca el store: abrir o cerrar no marca cambios.
 */
export interface ToursUi {
  /** Pasos abiertos por tour (ids de paso). */
  open: Record<string, string[]>;
  query: Record<TourKind, string>;
  /** Desplazamiento de la lista al abrir un tour, para volver al mismo lugar. */
  listScroll: Record<TourKind, number>;
}

export const EMPTY_TOURS_UI: ToursUi = { open: {}, query: { guide: '', flow: '' }, listScroll: { guide: 0, flow: 0 } };

/**
 * Abrir o cerrar un paso. Con uno (o ninguno) abierto, abrir otro cierra el anterior: un solo paso abierto por defecto.
 * Después de «Expandir todos», cada paso se abre y se cierra por su cuenta.
 */
export function toggleStep(open: readonly string[], id: string): string[] {
  if (open.includes(id)) return open.filter((x) => x !== id);
  return open.length > 1 ? [...open, id] : [id];
}

/** Vista previa breve de una nota: una línea, sin espacios de más. */
export function notePreview(note: string | undefined, max = 90): string {
  const flat = (note ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Lo que el encabezado de un paso dice de él: icono, título y tipo (sin abrirlo). */
export interface StepHeading {
  glyph: string;
  title: string;
  /** Tipo de nodo («Pantalla») o lo que hace la conexión («llama · POST /usuarios»). */
  kind: string;
  /** El paso apunta a algo que ya no existe. */
  missing: boolean;
}

export function stepHeading(
  step: TourStep,
  nodes: Record<string, Node>,
  edges: Record<string, Edge>,
  items: Record<string, CatalogItem>,
): StepHeading {
  if (step.nodeId) {
    const node = nodes[step.nodeId];
    if (!node) return { glyph: '⚠', title: 'Nodo eliminado', kind: 'Nodo', missing: true };
    const meta = nodeLabel(node);
    return { glyph: meta.glyph, title: nodeTitle(node, items), kind: meta.label, missing: false };
  }
  const edge = step.edgeId ? edges[step.edgeId] : undefined;
  if (edge) {
    const to = nodes[edge.to];
    const display = edgeDisplay(edge, {
      branchLabel: branchLabel(edge, nodes),
      targetHttp: to && (refTarget(to, items)?.http ?? to.http),
    });
    return {
      glyph: '⇢',
      title: `${nodeTitle(nodes[edge.from], items)} → ${nodeTitle(to, items)}`,
      kind: edgeDisplayText(display),
      missing: false,
    };
  }
  const removed = step.removedEdge;
  return {
    glyph: '⚠',
    title: removed
      ? `${nodeTitle(nodes[removed.from], items)} → ${nodeTitle(nodes[removed.to], items)}`
      : 'Conexión eliminada',
    kind: `Conexión eliminada${removed ? ` (${KIND_LABELS[removed.kind]})` : ''}`,
    missing: true,
  };
}

/** Aviso corto de un problema del paso, para el encabezado. */
export function issueShort(issue: StepIssue, nodes: Record<string, Node>, items: Record<string, CatalogItem>): string {
  if (issue.kind === 'removed') return 'Conexión eliminada: reemplázala o quita el paso';
  if (issue.kind === 'jump') return `Salto desde «${nodeTitle(nodes[issue.end], items)}»`;
  return 'Respuesta antes de su solicitud';
}
