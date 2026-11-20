import { useMemo } from 'react';
import { MarkerType, ReactFlow, ReactFlowProvider, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { ArchitectureGroup, ArchitectureLink, DiscoveryArchitectureGroup } from '../../api/client';
import {
  RELATION_LABELS,
  detailLayout,
  linkText,
  overviewLayout,
  stubKey,
  visibleLinks,
  visibleRelations,
  type Filters,
  type Semantic,
} from './architectureModel';
import { architectureNodeTypes } from './architectureTypes';

/** Lo elegido en la vista: un grupo, un vínculo entre grupos, un hallazgo o una relación. */
export type ArchitectureSelection =
  | { kind: 'group'; key: string }
  | { kind: 'link'; link: ArchitectureLink }
  | { kind: 'entity'; key: string; title?: string }
  | { kind: 'relation'; key: string; from: string; to: string; relation: string };

type Props = {
  groups: readonly ArchitectureGroup[];
  filters: Filters;
  selection: ArchitectureSelection | null;
  onSelect: (selection: ArchitectureSelection | null) => void;
  /** Abrir un grupo (doble clic en un grupo o en un vecino). */
  onOpen: (groupKey: string) => void;
  /** Resaltar un conjunto (una propuesta): el resto se atenúa. */
  highlight?: ReadonlySet<string>;
} & ({ mode: 'overview'; links: readonly ArchitectureLink[] } | { mode: 'detail'; detail: DiscoveryArchitectureGroup });

const edgeClass = (semantic: Semantic, inferred: boolean, low: boolean) =>
  `arch-edge is-${semantic}${inferred ? ' is-inferred' : ''}${low ? ' is-low' : ''}`;

const marker = (semantic: Semantic) => (semantic === 'containment' ? undefined : { type: MarkerType.ArrowClosed, width: 14, height: 14 });

/**
 * La arquitectura descubierta en React Flow, de solo lectura (spec walkie-live-arquitectura): la vista general (un nodo
 * por grupo y un vínculo por tipo de relación entre grupos) o el detalle de un grupo (sus hallazgos y una caja por grupo
 * vecino). Las posiciones salen de columnas por tipo y no se guardan; nada se arrastra ni se conecta.
 */
export function ArchitectureCanvas(props: Props) {
  const { groups, filters, selection, onSelect, onOpen, highlight } = props;
  const byKey = useMemo(() => new Map(groups.map((g) => [g.key, g])), [groups]);

  const { nodes, edges } = useMemo(() => {
    if (props.mode === 'overview') {
      const links = visibleLinks(props.links, filters);
      // Una flecha por par de grupos (si no, «lee» y «escribe» se enciman): la etiqueta suma cada tipo y el clic elige
      // el de más relaciones; el inspector ofrece los demás.
      const pairs = new Map<string, ArchitectureLink[]>();
      for (const link of links) pairs.set(`${link.from}|${link.to}`, [...(pairs.get(`${link.from}|${link.to}`) ?? []), link]);
      const labels = new Map([...pairs].map(([id, list]) => [id, [...list].sort((a, b) => b.total - a.total).map(linkText).join(' · ')]));
      // Las columnas se separan lo que pide la etiqueta más larga: así ninguna tapa una caja.
      const positions = overviewLayout(groups, Math.max(0, ...[...labels.values()].map((l) => l.length)));
      const nodes: Node[] = groups.map((group) => ({
        id: group.key,
        type: 'archGroup',
        position: positions[group.key]!,
        data: {
          group,
          selected: selection?.kind === 'group' && selection.key === group.key,
          dim: highlight ? !highlight.has(group.key) : false,
        },
      }));
      const edges: Edge[] = [...pairs.entries()].map(([id, list]) => {
        const sorted = [...list].sort((a, b) => b.total - a.total);
        const main = sorted[0]!;
        const selected = selection?.kind === 'link' && list.some((l) => l === selection.link);
        return {
          id,
          source: main.from,
          target: main.to,
          label: labels.get(id),
          className:
            edgeClass(main.semantic, list.every((l) => l.observed === 0), list.every((l) => l.low === l.total)) + (selected ? ' is-selected' : ''),
          markerEnd: marker(main.semantic),
          data: { link: main },
        };
      });
      return { nodes, edges };
    }

    const { detail } = props;
    const { positions, stubs } = detailLayout(detail);
    const inGroup = new Set(detail.entities.map((e) => e.key));
    const neighborGroup = new Map(detail.neighbors.map((n) => [n.key, n.group]));
    const nodes: Node[] = [
      ...detail.entities.map((entity) => ({
        id: entity.key,
        type: 'archEntity',
        position: positions[entity.key]!,
        data: {
          entity,
          selected: selection?.kind === 'entity' && selection.key === entity.key,
          dim: highlight ? !highlight.has(entity.key) : false,
        },
      })),
      ...stubs.map((stub) => ({
        id: stub.key,
        type: 'archStub',
        position: positions[stub.key]!,
        data: {
          title: byKey.get(stub.group)?.title ?? stub.group,
          kind: byKey.get(stub.group)?.kind ?? 'unassigned',
          entities: stub.entities,
          selected: selection?.kind === 'group' && selection.key === stub.group,
        },
      })),
    ];
    // Dentro del grupo, una flecha por relación; hacia un vecino, una por hallazgo, vecino y tipo (sumadas).
    const edges = new Map<string, Edge>();
    for (const r of visibleRelations(detail.relations, filters)) {
      const from = inGroup.has(r.from) ? r.from : neighborGroup.has(r.from) ? stubKey(neighborGroup.get(r.from)!) : null;
      const to = inGroup.has(r.to) ? r.to : neighborGroup.has(r.to) ? stubKey(neighborGroup.get(r.to)!) : null;
      if (!from || !to || from === to) continue;
      const id = inGroup.has(r.from) && inGroup.has(r.to) ? r.key : `${from}|${to}|${r.kind}`;
      const previous = edges.get(id);
      const total = ((previous?.data?.total as number | undefined) ?? 0) + 1;
      edges.set(id, {
        id,
        source: from,
        target: to,
        label: total > 1 ? `${RELATION_LABELS[r.kind]} ×${total}` : RELATION_LABELS[r.kind],
        className:
          edgeClass(r.semantic, r.basis === 'inferred', r.confidence === 'low') + (selection?.kind === 'relation' && selection.key === r.key ? ' is-selected' : ''),
        markerEnd: marker(r.semantic),
        data: { relation: r, total },
      });
    }
    return { nodes, edges: [...edges.values()] };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cada rama lee lo suyo de props
  }, [props.mode, props.mode === 'overview' ? props.links : props.detail, groups, filters, selection, highlight, byKey]);

  return (
    <ReactFlowProvider>
      <ReactFlow
        key={props.mode === 'overview' ? 'general' : props.detail.key}
        nodes={nodes}
        edges={edges}
        nodeTypes={architectureNodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable
        elementsSelectable={false}
        onlyRenderVisibleElements
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.1}
        maxZoom={1.5}
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
        onPaneClick={() => onSelect(null)}
        onNodeClick={(_, node) => {
          if (node.type === 'archGroup') onSelect({ kind: 'group', key: node.id });
          else if (node.type === 'archStub') onSelect({ kind: 'group', key: node.id.slice('grupo:'.length) });
          else onSelect({ kind: 'entity', key: node.id, title: (node.data as { entity?: { title: string } }).entity?.title });
        }}
        onNodeDoubleClick={(_, node) => {
          if (node.type === 'archGroup') onOpen(node.id);
          else if (node.type === 'archStub') onOpen(node.id.slice('grupo:'.length));
        }}
        onEdgeClick={(_, edge) => {
          if (edge.data?.link) onSelect({ kind: 'link', link: edge.data.link as ArchitectureLink });
          else if (edge.data?.relation) {
            const r = edge.data.relation as { key: string; from: string; to: string; kind: string };
            onSelect({ kind: 'relation', key: r.key, from: r.from, to: r.to, relation: r.kind });
          }
        }}
      />
    </ReactFlowProvider>
  );
}
