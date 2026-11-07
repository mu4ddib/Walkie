import { useId } from 'react';
import { KIND_LABELS, SELECTABLE_KINDS } from '../edges/edgeMeta';
import { NODE_LABELS } from '../nodes/nodeMeta';
import {
  EDGE_TEXT_MAX_LENGTH,
  HTTP_METHODS,
  TEXT_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  type EdgeKind,
  type HttpMethod,
} from '../store/graphStore';
import { useGraphStore } from '../store/useGraphStore';
import { InputsSection, RuleUsages } from './InputsSection';
import { RefPanel } from './RefPanel';
import { TextField } from './TextField';
import './panel.css';

/**
 * Panel lateral de propiedades (spec panel-propiedades, criterios 3 a 7). Con un solo nodo o una sola
 * conexión seleccionados muestra sus propiedades; si no, un texto de ayuda. Cambia el grafo por el store.
 */
export function PropertiesPanel({ nodeId, edgeId }: { nodeId: string | null; edgeId: string | null }) {
  return (
    <aside className="properties-panel" aria-label="Propiedades">
      {nodeId ? (
        <NodePanel key={nodeId} id={nodeId} />
      ) : edgeId ? (
        <EdgePanel key={edgeId} id={edgeId} />
      ) : (
        <p className="panel-help">Selecciona un nodo o una conexión para ver y editar sus propiedades.</p>
      )}
    </aside>
  );
}

function NodePanel({ id }: { id: string }) {
  const node = useGraphStore((s) => s.nodes[id]);
  const updateNode = useGraphStore((s) => s.updateNode);
  const methodId = useId();
  if (!node) return null;
  if (node.type === 'ref') return <RefPanel node={node} />;
  const meta = NODE_LABELS[node.type];

  return (
    <>
      <h3>
        <span aria-hidden="true">{meta.glyph}</span> {meta.label}
      </h3>
      <TextField
        label="Título"
        value={node.title}
        maxLength={TITLE_MAX_LENGTH}
        onChange={(title) => updateNode(id, { title })}
      />
      <TextField
        label="Descripción"
        multiline
        value={node.description ?? ''}
        maxLength={TEXT_MAX_LENGTH}
        onChange={(description) => updateNode(id, { description })}
      />
      {node.type === 'rule' && (
        <>
          <TextField
            label="Expresión"
            multiline
            placeholder="cc: solo dígitos, de 6 a 10"
            value={node.expression ?? ''}
            maxLength={TEXT_MAX_LENGTH}
            onChange={(expression) => updateNode(id, { expression })}
          />
          <RuleUsages ruleId={id} />
        </>
      )}
      {node.type === 'screen' && <InputsSection node={node} />}
      {node.type === 'api' && (
        <>
          <div className="panel-field">
            <label htmlFor={methodId}>Método</label>
            <select
              id={methodId}
              value={node.http?.method ?? ''}
              onChange={(e) => updateNode(id, { http: { method: (e.target.value || null) as HttpMethod | null } })}
            >
              <option value="">—</option>
              {HTTP_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <TextField
            label="Ruta HTTP"
            placeholder="/clientes/{id}"
            value={node.http?.path ?? ''}
            maxLength={TEXT_MAX_LENGTH}
            onChange={(path) => updateNode(id, { http: { path } })}
          />
        </>
      )}
    </>
  );
}

function EdgePanel({ id }: { id: string }) {
  const edge = useGraphStore((s) => s.edges[id]);
  const updateEdge = useGraphStore((s) => s.updateEdge);
  const kindId = useId();
  if (!edge) return null;
  const kinds = SELECTABLE_KINDS.includes(edge.kind) ? SELECTABLE_KINDS : [edge.kind, ...SELECTABLE_KINDS];

  return (
    <>
      <h3>Conexión</h3>
      <div className="panel-field">
        <label htmlFor={kindId}>Tipo</label>
        <select id={kindId} value={edge.kind} onChange={(e) => updateEdge(id, { kind: e.target.value as EdgeKind })}>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]} ({k})
            </option>
          ))}
        </select>
      </div>
      <TextField
        label="Etiqueta"
        value={edge.label ?? ''}
        maxLength={EDGE_TEXT_MAX_LENGTH}
        onChange={(label) => updateEdge(id, { label })}
      />
      <TextField
        label="Condición"
        placeholder="200"
        value={edge.when ?? ''}
        maxLength={EDGE_TEXT_MAX_LENGTH}
        onChange={(when) => updateEdge(id, { when })}
      />
    </>
  );
}
