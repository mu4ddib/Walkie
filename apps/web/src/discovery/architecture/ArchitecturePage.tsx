import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ApiError, type ArchitectureProposal } from '../../api/client';
import { useApp, useAppRole, useDiscoveryArchitecture, useDiscoveryArchitectureGroup } from '../../api/hooks';
import { appPath } from '../../workspace/paths';
import { reviewPath } from '../discoveryText';
import { ArchitectureCanvas, type ArchitectureSelection } from './ArchitectureCanvas';
import { ArchitectureInspector } from './ArchitectureInspector';
import { DEFAULT_FILTERS, GROUP_KIND_LABELS, SEMANTICS, SEMANTIC_LABELS, count, type Filters, type Semantic } from './architectureModel';
import { ProposalReview } from './ProposalReview';
import './architecture.css';
import '../discovery.css';

const PROPOSALS_STEP = 30;

const CONFIDENCE_TEXT = { high: 'alta', medium: 'media', low: 'baja' } as const;

/**
 * «Explorar arquitectura» (spec walkie-live-arquitectura, tarea 8): lo que el análisis descubrió, agrupado, antes de
 * decidir nada. Vista general (un nodo por grupo) o el detalle de un grupo (`?grupo=` en la URL, así «atrás» vuelve);
 * filtros por significado, confianza y base; el inspector con la evidencia; las propuestas de feature con «Revisar», que
 * lleva a la revisión por conjuntos (tarea 9). Abrir esta vista no escribe nada: ni catálogo, ni vínculos, ni posiciones.
 */
export function ArchitecturePage() {
  const { appId = '', snapshotId = '' } = useParams();
  const [search, setSearch] = useSearchParams();
  const groupKey = search.get('grupo');
  const app = useApp(appId);
  const { canEdit } = useAppRole(appId);
  const architecture = useDiscoveryArchitecture(snapshotId);
  const detail = useDiscoveryArchitectureGroup(snapshotId, groupKey, 0, 500);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [selection, setSelection] = useState<ArchitectureSelection | null>(null);
  const [highlighted, setHighlighted] = useState<ArchitectureProposal | null>(null);
  const [reviewing, setReviewing] = useState<ArchitectureProposal | null>(null);
  // Un análisis grande puede traer miles de propuestas: se muestran de a PROPOSALS_STEP.
  const [shown, setShown] = useState(PROPOSALS_STEP);

  const data = architecture.data;
  const groups = data?.groups ?? [];
  const highlight = useMemo(() => {
    if (!highlighted) return undefined;
    return groupKey ? new Set(highlighted.members) : new Set(highlighted.group ? [highlighted.group] : []);
  }, [highlighted, groupKey]);

  function open(key: string | null) {
    const next = new URLSearchParams(search);
    if (key) next.set('grupo', key);
    else next.delete('grupo');
    setSearch(next);
    setSelection(key ? null : selection?.kind === 'group' ? selection : null);
  }

  function toggleSemantic(s: Semantic) {
    const semantics = new Set(filters.semantics);
    if (semantics.has(s)) semantics.delete(s);
    else semantics.add(s);
    setFilters({ ...filters, semantics });
  }

  const unavailable = architecture.error instanceof ApiError && architecture.error.status === 404;
  const current = groupKey ? groups.find((g) => g.key === groupKey) : undefined;
  const incomplete = data?.limitations.filter((l) => l.incomplete).length ?? 0;

  return (
    <section className="page arch-page">
      <nav className="breadcrumb" aria-label="Ruta">
        <Link to="/apps">Apps</Link>
        {' / '}
        <Link to={appPath(appId)}>{app.data?.name ?? 'App'}</Link>
        {' / '}
        <Link to={reviewPath(appId, snapshotId)}>Revisión</Link>
        <span> / Arquitectura</span>
      </nav>
      <div className="discovery-heading">
        <h2>Arquitectura descubierta</h2>
        <Link className="pixel-button" to={reviewPath(appId, snapshotId)}>
          Volver a la revisión
        </Link>
      </div>
      <p className="discovery-note arch-banner" role="note">
        Descubierta, no confirmada: es lo que el análisis vio en el código. Explorarla no crea nada en Walkie; para incorporar
        algo, revisa una propuesta o decide hallazgo por hallazgo.
      </p>

      {unavailable && (
        <p role="alert" className="save-error">
          Este análisis no existe o Walkie Live no está disponible en esta instalación.
        </p>
      )}
      {architecture.error && !unavailable && (
        <p role="alert" className="save-error">
          No se pudo cargar la arquitectura.{' '}
          <button type="button" className="pixel-button is-ghost" onClick={() => void architecture.refetch()}>
            Reintentar
          </button>
        </p>
      )}
      {architecture.isPending && <p role="status">Cargando la arquitectura…</p>}

      {data && (
        <>
          <div className="arch-toolbar" role="group" aria-label="Filtros de la vista">
            <span className="arch-summary">
              {data.totals.entities} {data.totals.entities === 1 ? 'hallazgo' : 'hallazgos'} ·{' '}
              {data.totals.relations} {data.totals.relations === 1 ? 'relación' : 'relaciones'} · cobertura{' '}
              <strong className={data.completeness === 'complete' ? 'is-ok' : 'is-warn'}>
                {data.completeness === 'complete' ? 'completa' : `parcial (${incomplete} sin resolver)`}
              </strong>
            </span>
            <fieldset className="arch-filters">
              <legend className="sr-only">Relaciones a la vista</legend>
              {SEMANTICS.map((s) => (
                <label key={s} className={`arch-chip is-${s}`}>
                  <input type="checkbox" checked={filters.semantics.has(s)} onChange={() => toggleSemantic(s)} /> {SEMANTIC_LABELS[s]}
                </label>
              ))}
              <label className="arch-chip">
                <input type="checkbox" checked={filters.showLow} onChange={(e) => setFilters({ ...filters, showLow: e.target.checked })} />{' '}
                Confianza baja
              </label>
              <label className="arch-chip">
                <input
                  type="checkbox"
                  checked={filters.onlyObserved}
                  onChange={(e) => setFilters({ ...filters, onlyObserved: e.target.checked })}
                />{' '}
                Solo observadas
              </label>
            </fieldset>
          </div>

          <div className="arch-layout">
            <aside className="arch-side" aria-label="Grupos y propuestas">
              {current ? (
                <div className="arch-side-section">
                  <button type="button" className="pixel-button is-ghost" onClick={() => open(null)}>
                    ← Vista general
                  </button>
                  <h3>{current.title}</h3>
                  <p className="panel-help">
                    {GROUP_KIND_LABELS[current.kind]}
                    {detail.data ? ` · ${detail.data.total} ${detail.data.total === 1 ? 'hallazgo' : 'hallazgos'}` : ''}
                    {detail.data && detail.data.total > detail.data.entities.length ? ` (se ven ${detail.data.entities.length})` : ''}
                  </p>
                </div>
              ) : (
                <div className="arch-side-section">
                  <h3>Grupos ({groups.length})</h3>
                  <ul className="arch-group-list">
                    {groups.map((g) => (
                      <li key={g.key}>
                        <button
                          type="button"
                          className="link-button"
                          aria-current={selection?.kind === 'group' && selection.key === g.key ? 'true' : undefined}
                          onClick={() => setSelection({ kind: 'group', key: g.key })}
                          onDoubleClick={() => open(g.key)}
                        >
                          {g.title}
                        </button>
                        <span className="arch-evidence-meta">
                          {GROUP_KIND_LABELS[g.kind]}
                          {g.incomplete > 0 ? ` · ◐ ${g.incomplete}` : ''}
                        </span>
                        <button type="button" className="pixel-button is-ghost arch-open" aria-label={`Abrir ${g.title}`} onClick={() => open(g.key)}>
                          Abrir
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="arch-side-section">
                <h3>Propuestas de feature ({data.proposals.length})</h3>
                {data.proposals.length === 0 && <p className="panel-help">El análisis no propuso features.</p>}
                <ul className="arch-proposals">
                  {data.proposals.slice(0, shown).map((p) => (
                    <li key={p.key} className={highlighted?.key === p.key ? 'is-highlighted' : undefined}>
                      <strong>{p.title}</strong>
                      <span className="arch-evidence-meta">
                        {count(p.screens, 'screen')} · {count(p.apis, 'api')} · confianza {CONFIDENCE_TEXT[p.confidence as keyof typeof CONFIDENCE_TEXT] ?? p.confidence}
                        {p.decision ? ` · ${p.decision === 'rejected' ? 'descartada' : 'ya en Walkie'}` : ''}
                      </span>
                      {p.confidence === 'low' && <span className="arch-weak">Grupo débil: revisa sus miembros antes de crearla.</span>}
                      <span className="arch-proposal-actions">
                        <button
                          type="button"
                          className="pixel-button is-ghost"
                          aria-pressed={highlighted?.key === p.key}
                          onClick={() => setHighlighted(highlighted?.key === p.key ? null : p)}
                        >
                          Resaltar
                        </button>
                        <button type="button" className="pixel-button" onClick={() => setReviewing(p)}>
                          Revisar
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
                {data.proposals.length > shown && (
                  <button type="button" className="pixel-button is-ghost" onClick={() => setShown(shown + PROPOSALS_STEP)}>
                    Mostrar {Math.min(PROPOSALS_STEP, data.proposals.length - shown)} más (quedan {data.proposals.length - shown})
                  </button>
                )}
              </div>
            </aside>

            <div className="arch-canvas" aria-label={current ? `Detalle de ${current.title}` : 'Vista general de la arquitectura'} role="region">
              {groupKey && detail.isPending && <p role="status">Cargando el grupo…</p>}
              {groupKey && detail.error && <p role="alert">No se pudo cargar este grupo.</p>}
              {!groupKey && (
                <ArchitectureCanvas
                  mode="overview"
                  groups={groups}
                  links={data.links}
                  filters={filters}
                  selection={selection}
                  onSelect={setSelection}
                  onOpen={open}
                  highlight={highlight}
                />
              )}
              {groupKey && detail.data && (
                <ArchitectureCanvas
                  mode="detail"
                  groups={groups}
                  detail={detail.data}
                  filters={filters}
                  selection={selection}
                  onSelect={setSelection}
                  onOpen={open}
                  highlight={highlight}
                />
              )}
            </div>

            {reviewing ? (
              <ProposalReview
                key={reviewing.key}
                appId={appId}
                snapshotId={snapshotId}
                proposal={reviewing}
                canEdit={canEdit}
                onClose={() => setReviewing(null)}
              />
            ) : (
              <ArchitectureInspector
                snapshotId={snapshotId}
                architecture={data}
                selection={selection}
                onSelect={setSelection}
                onOpen={open}
              />
            )}
          </div>
        </>
      )}
    </section>
  );
}
