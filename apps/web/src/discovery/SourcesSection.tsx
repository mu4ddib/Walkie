import { Link } from 'react-router';
import type { DiscoverySources } from '../api/client';
import { formatDayAndTime } from '../share/shareFormat';
import { reviewPath, shortCommit } from './discoveryText';
import './discovery.css';

/**
 * «Proyectos locales» en la página de una app (spec walkie-live, tarea 5): cada fuente con su último análisis (fecha,
 * completitud, commit) y acceso a su revisión, o el estado vacío con cómo empezar. Solo se monta si Discovery está
 * disponible (la API responde las fuentes): con Discovery apagado no hay nada que parezca funcionar.
 */
export function SourcesSection({ sources, onImport }: { sources: DiscoverySources; onImport: () => void }) {
  return (
    <section className="discovery-sources" aria-labelledby="discovery-sources-title">
      <div className="discovery-sources-head">
        <h3 id="discovery-sources-title">Proyectos locales</h3>
        <button type="button" className="pixel-button is-ghost" onClick={onImport}>
          Importar proyecto local
        </button>
      </div>
      {sources.sources.length === 0 ? (
        <p className="gallery-note">
          Aún no hay análisis de proyectos locales. Analiza un proyecto con <code>walkie scan .</code> y cárgalo aquí para revisar lo
          que Walkie descubrió en su código.
        </p>
      ) : (
        <ul className="item-list discovery-source-list">
          {sources.sources.map(({ source, latestSnapshot, snapshotCount }) => (
            <li key={source.id}>
              <div className="discovery-source">
                <strong>{source.name}</strong>
                <span className={`discovery-badge ${latestSnapshot.completeness === 'partial' ? 'is-partial' : 'is-complete'}`}>
                  {latestSnapshot.completeness === 'partial' ? '◐ Parcial' : '● Completo'}
                </span>
                <span className="discovery-meta">
                  Último análisis: {formatDayAndTime(latestSnapshot.generatedAt)}
                  {latestSnapshot.vcs && (
                    <>
                      {' · '}
                      <code title={latestSnapshot.vcs.commit}>{shortCommit(latestSnapshot.vcs.commit)}</code>
                      {latestSnapshot.vcs.branch && ` en ${latestSnapshot.vcs.branch}`}
                    </>
                  )}
                  {' · '}
                  {latestSnapshot.stats.entities} hallazgos · {snapshotCount === 1 ? '1 análisis' : `${snapshotCount} análisis`}
                </span>
                <Link className="pixel-button" to={reviewPath(latestSnapshot.appId, latestSnapshot.id)}>
                  Revisar
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
