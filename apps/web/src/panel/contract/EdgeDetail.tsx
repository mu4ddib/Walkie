import { useId } from 'react';
import type { Edge } from '../../schema/walkie-graph';
import {
  DATA_OPERATION_LABELS,
  DATA_OPERATIONS,
  LIMITS,
  normalizeEdgeData,
  splitList,
  type EdgeData,
} from '../../contracts/contracts';
import { EXAMPLE_MAX_LENGTH, TEXT_MAX_LENGTH } from '../../store/graphStore';
import { useGraphStore } from '../../store/useGraphStore';
import { TextField } from '../TextField';
import { useDraft } from './useDraft';

/**
 * Detalle de la interacción (spec espacio-de-trabajo, criterio 15): notas, acceso a datos y un ejemplo de payload
 * propio. El contrato reutilizable (campos, códigos) vive en la API y no se repite aquí.
 */
export function EdgeDetail({ edge }: { edge: Edge }) {
  const updateEdge = useGraphStore((s) => s.updateEdge);
  const [data, setData] = useDraft<EdgeData>(
    edge.data,
    normalizeEdgeData,
    (next) => updateEdge(edge.id, { data: next ?? null }),
    {},
  );
  const operationId = useId();
  const entitiesId = useId();

  return (
    <>
      <TextField
        label="Notas de la interacción"
        multiline
        value={edge.notes ?? ''}
        maxLength={TEXT_MAX_LENGTH}
        placeholder="Reintentos, tiempos, qué pasa si falla"
        onChange={(notes) => updateEdge(edge.id, { notes })}
      />
      <section className="panel-section" aria-label="Acceso a datos">
        <h4>Acceso a datos</h4>
        <div className="contract-grid">
          <div className="contract-field">
            <label htmlFor={operationId}>Operación</label>
            <select
              id={operationId}
              value={data.operation ?? ''}
              onChange={(e) => setData({ ...data, operation: (e.target.value || undefined) as EdgeData['operation'] })}
            >
              <option value="">—</option>
              {DATA_OPERATIONS.map((o) => (
                <option key={o} value={o}>
                  {DATA_OPERATION_LABELS[o]}
                </option>
              ))}
            </select>
          </div>
          <div className="contract-field">
            <label htmlFor={entitiesId}>Entidades</label>
            <input
              id={entitiesId}
              value={data.entities?.join(',') ?? ''}
              maxLength={LIMITS.short * 4}
              placeholder="cuentas, movimientos"
              onChange={(e) => setData({ ...data, entities: splitList(e.target.value) })}
            />
          </div>
        </div>
      </section>
      <TextField
        label="Ejemplo de payload"
        multiline
        value={edge.example ?? ''}
        maxLength={EXAMPLE_MAX_LENGTH}
        placeholder='{ "cuenta": "001-123" }'
        onChange={(example) => updateEdge(edge.id, { example })}
      />
      <p className="panel-help">El contrato completo (campos y códigos) se documenta en la API; aquí, solo lo propio de esta interacción.</p>
    </>
  );
}
