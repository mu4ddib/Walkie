import { Handle, Position, type Node as FlowNode, type NodeProps } from '@xyflow/react';
import { shortDate } from '../gallery/dates';
import type { WalkieAppMapV0 } from '../schema/walkie-app-map';
import { contentsOf, plural } from './mapText';

export type MapFeatureSummary = WalkieAppMapV0['features'][number];

export type FeatureMapFlowNode = FlowNode<
  {
    name: string;
    description?: string;
    updatedAt?: string;
    summary: MapFeatureSummary;
  },
  'feature'
>;

/**
 * Una feature en el mapa de la app (spec mapa-de-la-app): nombre, descripción, qué tiene y cuándo se actualizó. Las
 * conexiones se dibujan desde sus lados (puertos); no se conecta a mano.
 */
export function FeatureMapNode({ data, selected }: NodeProps<FeatureMapFlowNode>) {
  const { name, description, updatedAt, summary } = data;
  return (
    <div className="map-feature" data-selected={selected || undefined}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <span className="map-feature-kind">Feature</span>
      <strong className="map-feature-name">{name}</strong>
      <p className="map-feature-description">{description || 'Sin descripción'}</p>
      <p className="map-feature-contents">{contentsOf(summary)}</p>
      <div className="map-feature-foot">
        {updatedAt && <span>Actualizada el {shortDate(updatedAt)}</span>}
        {summary.unresolvedPortals > 0 && (
          <span className="map-feature-warn">
            ⚠ {plural(summary.unresolvedPortals, 'portal sin destino', 'portales sin destino')}
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}
