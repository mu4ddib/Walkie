import type { CatalogItem } from '../api/client';
import { refTarget } from '../catalog/catalogContext';
import { KIND_LABELS, edgeDisplay, edgeDisplayText } from '../edges/edgeMeta';
import type { Edge, Node } from '../schema/walkie-graph';
import type { TourStep } from './flows';

/** Título de un nodo como se ve en el lienzo (un `ref` muestra el de su elemento del catálogo). */
export function nodeTitle(node: Node | undefined, items: Record<string, CatalogItem>): string {
  return node ? (refTarget(node, items)?.title ?? node.title) : '(eliminado)';
}

/** Etiqueta de la rama de una decisión que toma la conexión, si la tiene. */
export function branchLabel(edge: Edge, nodes: Record<string, Node>): string | undefined {
  return edge.branch ? nodes[edge.from]?.branches?.find((b) => b.id === edge.branch)?.label : undefined;
}

/** "Creación de cuenta → API usuarios · llama · POST /usuarios" */
export function edgeSummary(edge: Edge, nodes: Record<string, Node>, items: Record<string, CatalogItem>): string {
  const from = nodes[edge.from];
  const to = nodes[edge.to];
  const display = edgeDisplay(edge, {
    branchLabel: branchLabel(edge, nodes),
    targetHttp: to && (refTarget(to, items)?.http ?? to.http),
  });
  return `${nodeTitle(from, items)} → ${nodeTitle(to, items)} · ${edgeDisplayText(display)}`;
}

/** Texto de un paso de tour o de recorrido. */
export function stepSummary(
  step: TourStep | undefined,
  edges: Record<string, Edge>,
  nodes: Record<string, Node>,
  items: Record<string, CatalogItem>,
): string {
  if (!step) return '';
  if (step.nodeId) return nodeTitle(nodes[step.nodeId], items);
  const edge = step.edgeId ? edges[step.edgeId] : undefined;
  if (edge) return edgeSummary(edge, nodes, items);
  const removed = step.removedEdge;
  if (!removed) return '';
  const label = removed.label ? ` · ${removed.label}` : '';
  return `Conexión eliminada: ${nodeTitle(nodes[removed.from], items)} → ${nodeTitle(nodes[removed.to], items)} (${KIND_LABELS[removed.kind]}${label})`;
}
