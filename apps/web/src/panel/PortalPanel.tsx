import { useId } from 'react';
import { useOpenFeature } from '../canvas/useOpenFeature';
import { portalTarget, useCanvasCatalog } from '../catalog/catalogContext';
import { NODE_LABELS } from '../nodes/nodeMeta';
import type { Node } from '../schema/walkie-graph';
import { TEXT_MAX_LENGTH } from '../store/graphStore';
import { useGraphStore } from '../store/useGraphStore';
import { TextField } from './TextField';

/**
 * Panel de un `portal` (spec imagenes-portal, criterios 7 a 9): feature destino (de la misma app, sin la
 * actual) y "Abrir". El título del nodo guarda el último nombre conocido del destino.
 */
export function PortalPanel({ node }: { node: Node }) {
  const { features = {}, featureId } = useCanvasCatalog();
  const updateNode = useGraphStore((s) => s.updateNode);
  const open = useOpenFeature();
  const selectId = useId();
  const target = portalTarget(node, features);
  const options = Object.values(features)
    .filter((f) => f.id !== featureId)
    .sort((a, b) => a.name.localeCompare(b.name));

  function choose(id: string) {
    const feature = features[id];
    updateNode(node.id, feature ? { targetFeatureId: id, title: feature.name } : { targetFeatureId: null });
  }

  return (
    <>
      <h3>
        <span aria-hidden="true">{NODE_LABELS.portal.glyph}</span> {NODE_LABELS.portal.label}
      </h3>
      <div className="panel-field">
        <label htmlFor={selectId}>Feature destino</label>
        <select id={selectId} value={target?.id ?? ''} onChange={(e) => choose(e.target.value)}>
          <option value="">— Sin destino —</option>
          {options.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </div>
      {node.targetFeatureId && !target && (
        <p className="panel-help">
          La feature destino ya no existe. Último nombre conocido: <strong>{node.title}</strong>.
        </p>
      )}
      {options.length === 0 && <p className="panel-help">La app no tiene otras features todavía.</p>}
      <button type="button" className="pixel-button" disabled={!target} onClick={() => target && open(target.id)}>
        Abrir
      </button>
      <TextField
        label="Descripción"
        multiline
        value={node.description ?? ''}
        maxLength={TEXT_MAX_LENGTH}
        onChange={(description) => updateNode(node.id, { description })}
      />
    </>
  );
}
