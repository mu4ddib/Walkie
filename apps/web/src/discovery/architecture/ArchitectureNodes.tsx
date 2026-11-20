import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { ArchitectureEntity, ArchitectureGroup } from '../../api/client';
import { ENTITY_LABELS, GROUP_KIND_LABELS, count } from './architectureModel';

export type GroupFlowNode = Node<{ group: ArchitectureGroup; selected: boolean; dim: boolean }, 'archGroup'>;
export type EntityFlowNode = Node<{ entity: ArchitectureEntity; selected: boolean; dim: boolean }, 'archEntity'>;
export type StubFlowNode = Node<{ title: string; kind: ArchitectureGroup['kind']; entities: number; selected: boolean }, 'archStub'>;

const handles = (
  <>
    <Handle type="target" position={Position.Left} className="arch-handle" isConnectable={false} />
    <Handle type="source" position={Position.Right} className="arch-handle" isConnectable={false} />
  </>
);

/** Un grupo de la vista general: qué es, qué tiene y cuánto quedó sin ver. */
export function GroupNode({ data }: NodeProps<GroupFlowNode>) {
  const { group } = data;
  const kinds = (Object.keys(group.counts) as ArchitectureEntity['kind'][]).filter((k) => group.counts[k]! > 0 && k !== 'feature');
  return (
    <div className={`arch-node arch-group is-${group.kind}${data.selected ? ' is-selected' : ''}${data.dim ? ' is-dim' : ''}`} data-group={group.key}>
      {handles}
      <span className="arch-node-kind">{GROUP_KIND_LABELS[group.kind]}</span>
      <strong className="arch-node-title">{group.title}</strong>
      <span className="arch-node-meta">
        {kinds.map((k) => count(group.counts[k]!, k)).join(' · ')}
        {group.counts.feature ? ` · ${count(group.counts.feature, 'feature')}` : ''}
      </span>
      {group.incomplete > 0 && (
        <span className="arch-coverage" title="Limitaciones que dejan algo sin ver en sus archivos">
          ◐ {group.incomplete} sin resolver
        </span>
      )}
    </div>
  );
}

/** Un hallazgo dentro de un grupo abierto. */
export function EntityNode({ data }: NodeProps<EntityFlowNode>) {
  const { entity } = data;
  return (
    <div className={`arch-node arch-entity is-${entity.kind}${data.selected ? ' is-selected' : ''}${data.dim ? ' is-dim' : ''}`}>
      {handles}
      <span className="arch-node-kind">
        {ENTITY_LABELS[entity.kind].one}
        {entity.basis === 'inferred' ? ' · inferida' : ''}
        {entity.decision ? ` · ${entity.decision === 'rejected' ? 'descartada' : 'en Walkie'}` : ''}
      </span>
      <strong className="arch-node-title">{entity.title}</strong>
      {entity.route && <code className="arch-node-route">{entity.route}</code>}
    </div>
  );
}

/** Un grupo vecino en el detalle: se abre con doble clic. */
export function StubNode({ data }: NodeProps<StubFlowNode>) {
  return (
    <div className={`arch-node arch-stub is-${data.kind}${data.selected ? ' is-selected' : ''}`}>
      {handles}
      <span className="arch-node-kind">{GROUP_KIND_LABELS[data.kind]} vecino</span>
      <strong className="arch-node-title">{data.title}</strong>
      <span className="arch-node-meta">{data.entities === 1 ? '1 hallazgo relacionado' : `${data.entities} hallazgos relacionados`}</span>
    </div>
  );
}
