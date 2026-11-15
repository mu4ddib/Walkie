import { Link } from 'react-router';
import { useDiscoveryProvenance } from '../api/hooks';
import { formatDayAndTime } from '../share/shareFormat';
import { BASIS, CONFIDENCE, reviewPath } from './discoveryText';
import './discovery.css';

const LATEST: Record<string, string> = {
  same: 'El último análisis lo sigue viendo igual.',
  changed: 'En el último análisis cambió en el código: revísalo en la revisión. El elemento no se cambió.',
  'not-found': 'El último análisis no lo encontró (puede que no haya mirado esa parte). El elemento no se cambió.',
};

/**
 * «De dónde viene» en el detalle de un elemento del catálogo (spec walkie-live, tarea 6): los hallazgos de Walkie Live
 * vinculados a él, con su fuente, la decisión, la evidencia del análisis en que se decidió y un enlace a la revisión.
 * Solo informa: no bloquea editar ni reescribe nada con análisis nuevos. Sin Discovery (404) o sin vínculos, no se
 * muestra. El texto viene del paquete y se pinta como texto.
 */
export function ItemProvenance({ appId, itemId }: { appId: string; itemId: string }) {
  const provenance = useDiscoveryProvenance(appId, `catalogItem:${itemId}`);
  const origins = provenance.data?.bindings ?? [];
  if (origins.length === 0) return null;

  return (
    <section className="discovery-provenance" aria-labelledby="discovery-provenance-title">
      <h3 id="discovery-provenance-title">De dónde viene</h3>
      {origins.map((origin) => (
        <div key={`${origin.source.id}-${origin.binding.entityKey}`} className="discovery-box">
          <p>
            {origin.binding.decision === 'created' ? 'Creado desde' : 'Vinculado a'} <strong>{origin.entity?.title ?? origin.binding.entityKey}</strong>{' '}
            de <strong>{origin.source.name}</strong> el {formatDayAndTime(origin.binding.decidedAt)}.
          </p>
          <p className="discovery-meta">
            <code>{origin.binding.entityKey}</code>
            {origin.entity && (
              <>
                {' · '}
                {BASIS[origin.entity.basis] ?? origin.entity.basis} · confianza {CONFIDENCE[origin.entity.confidence] ?? origin.entity.confidence}
              </>
            )}
          </p>
          {origin.evidence.length > 0 && (
            <>
              <h4>Evidencia ({origin.evidenceTotal})</h4>
              <ul>
                {origin.evidence.map((e) => (
                  <li key={e.id}>
                    <code>
                      {e.path}
                      {e.lines && `:${e.lines.start}${e.lines.end !== e.lines.start ? `-${e.lines.end}` : ''}`}
                    </code>{' '}
                    <span className="discovery-item-meta">
                      {e.detector} · confianza {CONFIDENCE[e.confidence] ?? e.confidence}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="panel-help">{LATEST[origin.latest.status]}</p>
          <Link to={reviewPath(appId, origin.latest.snapshotId)}>Ver en la revisión</Link>
        </div>
      ))}
    </section>
  );
}
