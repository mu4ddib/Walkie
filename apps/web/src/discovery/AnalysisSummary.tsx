import type { DiscoverySnapshot, DiscoveryUpload } from '../api/client';
import { formatDayAndTime } from '../share/shareFormat';
import { DETECTOR_STATUS, KIND, KIND_ORDER, plural, shortCommit } from './discoveryText';

type Analysis = Pick<DiscoverySnapshot, 'analyzer' | 'vcs' | 'generatedAt' | 'completeness' | 'detectors' | 'technologies' | 'limitations' | 'stats'> & {
  source: { name: string };
};

/**
 * Qué trae un análisis (spec walkie-live, tarea 5): fuente, analizador, fecha, commit, tecnologías, componentes por tipo,
 * detectores y limitaciones. Un análisis parcial se distingue con texto, no solo con color, y sus limitaciones se
 * muestran todas: es un paquete válido que no pudo mirar todo, no un fallo.
 */
export function AnalysisSummary({
  analysis,
  entities,
  compact = false,
}: {
  analysis: Analysis;
  /** Entidades por tipo (lo trae el resumen de la subida). */
  entities?: DiscoveryUpload['summary']['entities'];
  compact?: boolean;
}) {
  const partial = analysis.completeness === 'partial';
  const skipped = analysis.detectors.filter((d) => d.status !== 'ran');
  return (
    <div className="discovery-summary" aria-label="Resumen del análisis">
      <p className="discovery-summary-head">
        <strong>{analysis.source.name}</strong>
        <span className={`discovery-badge ${partial ? 'is-partial' : 'is-complete'}`}>
          {partial ? '◐ Análisis parcial' : '● Análisis completo'}
        </span>
      </p>
      <p className="discovery-meta">
        {analysis.analyzer.name} {analysis.analyzer.version} · {formatDayAndTime(analysis.generatedAt)}
        {analysis.vcs && (
          <>
            {' · '}
            <code title={analysis.vcs.commit}>{shortCommit(analysis.vcs.commit)}</code>
            {analysis.vcs.branch && <> en {analysis.vcs.branch}</>}
          </>
        )}
      </p>
      {partial && (
        <p className="discovery-note">
          El paquete es válido, pero el análisis no pudo mirar todo{skipped.length > 0 ? ' (ver detectores)' : ''}. Walkie no dará por
          desaparecido nada de lo que no se miró.
        </p>
      )}
      {analysis.technologies.length > 0 && (
        <p>
          Tecnologías:{' '}
          {analysis.technologies.map((t, i) => (
            <span key={t.id}>
              {i > 0 && ', '}
              {t.name}
              {t.version && ` ${t.version}`}
            </span>
          ))}
        </p>
      )}
      {entities && (
        <p>
          {Object.keys(entities).length === 0
            ? 'Ningún componente descubierto.'
            : KIND_ORDER.filter((k) => entities[k])
                .map((k) => `${entities[k]} ${KIND[k] ?? k}`)
                .join(' · ')}
          {' · '}
          {plural(analysis.stats.relations, 'relación', 'relaciones')}
        </p>
      )}
      {!entities && (
        <p>
          {plural(analysis.stats.entities, 'hallazgo', 'hallazgos')} · {plural(analysis.stats.relations, 'relación', 'relaciones')} ·{' '}
          {plural(analysis.stats.evidence, 'evidencia', 'evidencias')}
        </p>
      )}
      {!compact && (
        <details className="discovery-details" open={partial && skipped.length > 0}>
          <summary>Detectores ({analysis.detectors.length})</summary>
          <ul>
            {analysis.detectors.map((d) => (
              <li key={d.id}>
                <code>{d.id}</code> {DETECTOR_STATUS[d.status] ?? d.status}
                {d.reason && <span className="import-note"> — {d.reason}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
      {analysis.limitations.length > 0 && (
        <details className="discovery-details" open={!compact}>
          <summary>Limitaciones ({analysis.limitations.length})</summary>
          <ul>
            {analysis.limitations.map((l, i) => (
              <li key={`${l.code}-${l.path ?? ''}-${i}`}>
                <code>{l.code}</code>
                {l.path && (
                  <>
                    {' '}
                    <code>{l.path}</code>
                  </>
                )}{' '}
                {l.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
