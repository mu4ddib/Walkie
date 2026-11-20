import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ApiError, type DiscoveryReview, type DiscoveryReviewItem, type DiscoveryStatus } from '../api/client';
import { useApp, useAppRole, useDiscoveryReview, useDiscoverySources } from '../api/hooks';
import { appPath } from '../workspace/paths';
import { AnalysisSummary } from './AnalysisSummary';
import { formatDayAndTime } from '../share/shareFormat';
import { BASIS, CHANGE, CHANGE_ORDER, CONFIDENCE, KIND, KIND_ORDER, REASON, STATUS, STATUS_ORDER, reviewPath, type Change } from './discoveryText';
import { ReviewInspector } from './ReviewInspector';
import './discovery.css';

export const REVIEW_PAGE_SIZE = 50;

/**
 * Revisión de un análisis (spec walkie-live, tarea 5): cabecera del análisis, conteos por estado, filtros por tipo y
 * estado, la lista paginada en la API y el inspector del hallazgo elegido. Filtros y página viven en la URL (así «atrás»
 * y los enlaces conservan lo que se veía). La lista nunca trae más de una página; la evidencia se pide al elegir un
 * hallazgo. No es un editor: decidir aquí no cambia ningún lienzo.
 */
export function DiscoveryReviewPage() {
  const { appId = '', snapshotId = '' } = useParams();
  const [search, setSearch] = useSearchParams();
  const kind = search.get('kind') ?? undefined;
  const status = search.get('status') ?? undefined;
  const change = search.get('change') ?? undefined;
  const needsReview = search.get('needsReview') === 'true';
  const page = Math.max(0, Number.parseInt(search.get('page') ?? '0', 10) || 0);
  const query = useMemo(
    () => ({ kind, status, change, needsReview, page, pageSize: REVIEW_PAGE_SIZE }),
    [kind, status, change, needsReview, page],
  );

  const app = useApp(appId);
  const sources = useDiscoverySources(appId);
  const review = useDiscoveryReview(snapshotId, query);
  const [selected, setSelected] = useState<string | null>(null);
  const list = useRef<HTMLUListElement>(null);

  const data = review.data;
  const source = sources.data?.sources.find((s) => s.source.id === data?.sourceId);
  const isLatest = source?.latestSnapshot.id === snapshotId;
  // Decidir es de editor (ADR-0015): un viewer revisa hallazgos y evidencia sin decidir.
  const { canEdit } = useAppRole(appId);
  const items = data?.items ?? [];
  const current = items.find((i) => i.key === selected) ?? null;

  function filter(changes: Record<string, string | undefined>) {
    const next = new URLSearchParams(search);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!('page' in changes)) next.delete('page');
    setSearch(next);
    setSelected(null);
  }

  /** Flechas arriba y abajo recorren la lista (además de Tab). */
  function onListKey(e: KeyboardEvent<HTMLUListElement>) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>('button.discovery-item') ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = buttons[Math.min(buttons.length - 1, Math.max(0, index + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  }

  const unavailable = review.error instanceof ApiError && review.error.status === 404;
  const total = data?.page.total ?? 0;
  const from = total === 0 ? 0 : page * REVIEW_PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * REVIEW_PAGE_SIZE);

  return (
    <section className="page discovery-page">
      <nav className="breadcrumb" aria-label="Ruta">
        <Link to="/apps">Apps</Link>
        {' / '}
        <Link to={appPath(appId)}>{app.data?.name ?? 'App'}</Link>
        <span> / Revisión{source ? ` de ${source.source.name}` : ''}</span>
      </nav>
      <h2>Revisión del análisis</h2>

      {unavailable && (
        <p role="alert" className="save-error">
          Este análisis no existe o Walkie Live no está disponible en esta instalación.
        </p>
      )}
      {review.error && !unavailable && (
        <p role="alert" className="save-error">
          No se pudo cargar la revisión. <button type="button" className="pixel-button is-ghost" onClick={() => void review.refetch()}>Reintentar</button>
        </p>
      )}
      {review.isPending && <p role="status">Cargando la revisión…</p>}

      {source && (
        <>
          {isLatest ? (
            <AnalysisSummary analysis={{ ...source.latestSnapshot, source: source.source }} compact />
          ) : (
            <p className="discovery-note" role="note">
              Este no es el último análisis de <strong>{source.source.name}</strong>: se puede ver, pero las decisiones se toman sobre{' '}
              <Link to={reviewPath(appId, source.latestSnapshot.id)}>el último</Link>.
            </p>
          )}
        </>
      )}

      {data && (
        <>
          <Comparison
            data={data}
            current={source?.latestSnapshot.id === snapshotId ? source.latestSnapshot : undefined}
            appId={appId}
            change={change}
            needsReview={needsReview}
            onFilter={filter}
          />
          <div className="discovery-counts" role="group" aria-label="Hallazgos por estado">
            {STATUS_ORDER.map((s) => (
              <button
                key={s}
                type="button"
                className={`discovery-count status-${s}`}
                aria-pressed={status === s}
                title={STATUS[s].help}
                onClick={() => filter({ status: status === s ? undefined : s })}
              >
                <span aria-hidden="true">{STATUS[s].glyph}</span> {STATUS[s].label} <strong>{data.counts[s]}</strong>
              </button>
            ))}
          </div>

          <div className="discovery-filters">
            <label>
              Tipo
              <select value={kind ?? ''} onChange={(e) => filter({ kind: e.target.value || undefined })}>
                <option value="">Todos</option>
                {KIND_ORDER.map((k) => (
                  <option key={k} value={k}>
                    {KIND[k]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Estado
              <select value={status ?? ''} onChange={(e) => filter({ status: e.target.value || undefined })}>
                <option value="">Todos</option>
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {STATUS[s].label}
                  </option>
                ))}
              </select>
            </label>
            {(kind || status || change || needsReview) && (
              <button
                type="button"
                className="pixel-button is-ghost"
                onClick={() => filter({ kind: undefined, status: undefined, change: undefined, needsReview: undefined })}
              >
                Quitar filtros
              </button>
            )}
            <span role="status" className="discovery-meta">
              {review.isFetching ? 'Actualizando…' : total === 0 ? 'Ningún hallazgo con estos filtros' : `${from}–${to} de ${total}`}
            </span>
          </div>

          <div className="discovery-layout">
            <div>
              <ul ref={list} className="discovery-list" aria-label="Hallazgos" onKeyDown={onListKey}>
                {items.map((item) => (
                  <li key={item.key}>
                    <ItemRow item={item} selected={item.key === selected} onSelect={() => setSelected(item.key)} />
                  </li>
                ))}
              </ul>
              {total > REVIEW_PAGE_SIZE && (
                <nav className="discovery-pager" aria-label="Páginas">
                  <button type="button" className="pixel-button" disabled={page === 0} onClick={() => filter({ page: String(page - 1) })}>
                    ← Anterior
                  </button>
                  <span>
                    Página {page + 1} de {Math.ceil(total / REVIEW_PAGE_SIZE)}
                  </span>
                  <button type="button" className="pixel-button" disabled={to >= total} onClick={() => filter({ page: String(page + 1) })}>
                    Siguiente →
                  </button>
                </nav>
              )}
            </div>
            {current ? (
              <ReviewInspector appId={appId} snapshotId={snapshotId} item={current} canDecide={isLatest} readOnly={!canEdit} />
            ) : (
              <aside className="discovery-inspector" aria-label="Detalle del hallazgo">
                <p className="gallery-note">Elige un hallazgo para ver por qué Walkie lo detectó y decidir qué hacer con él.</p>
              </aside>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/**
 * La comparación con el análisis anterior de la fuente (tarea 10): con cuál se compara (fecha, commit, completo o
 * parcial), qué apareció, qué cambió, qué sigue igual y qué pide una decisión. Cada cifra filtra la lista en la API. La
 * clasificación es de la API: aquí solo se muestra. Sin análisis anterior, lo dice.
 */
function Comparison({
  data,
  current,
  appId,
  change,
  needsReview,
  onFilter,
}: {
  data: DiscoveryReview;
  current?: { completeness: string };
  appId: string;
  change?: string;
  needsReview: boolean;
  onFilter: (changes: Record<string, string | undefined>) => void;
}) {
  if (!data.previous || !data.comparison) {
    return (
      <p className="discovery-note" role="note">
        Es el primer análisis de esta fuente en la app: todo lo que trae es nuevo. Los siguientes se compararán con este.
      </p>
    );
  }
  const previous = data.previous;
  const commit = (previous.vcs as { commit?: string } | undefined)?.commit;
  const coverage =
    current && previous.completeness !== current.completeness
      ? current.completeness === 'partial'
        ? 'Diferencia de cobertura: el anterior fue completo y este es parcial. Lo que este no miró no se da por desaparecido (queda «Sin cobertura»).'
        : 'Diferencia de cobertura: el anterior fue parcial y este es completo. Puede aparecer como nuevo lo que el anterior no miró.'
      : current?.completeness === 'partial'
        ? 'Análisis parcial: lo que no miró no se da por desaparecido.'
        : null;
  return (
    <section className="discovery-comparison" aria-label="Comparación con el análisis anterior">
      <p>
        Comparado con el{' '}
        <Link to={reviewPath(appId, previous.id)}>análisis anterior</Link> del {formatDayAndTime(previous.generatedAt)}
        {commit ? (
          <>
            {' '}
            (commit <code>{commit.slice(0, 7)}</code>)
          </>
        ) : null}
        , {previous.completeness === 'complete' ? 'completo' : 'parcial'}.
      </p>
      {coverage && (
        <p className="discovery-note" role="note">
          {coverage}
        </p>
      )}
      <div className="discovery-counts" role="group" aria-label="Respecto del análisis anterior">
        {CHANGE_ORDER.map((c) => (
          <button
            key={c}
            type="button"
            className={`discovery-count change-${c}`}
            aria-pressed={change === c}
            title={CHANGE[c].help}
            onClick={() => onFilter({ change: change === c ? undefined : c })}
          >
            <span aria-hidden="true">{CHANGE[c].glyph}</span> {CHANGE[c].label} <strong>{data.comparison![c]}</strong>
          </button>
        ))}
        <button
          type="button"
          className="discovery-count needs-review"
          aria-pressed={needsReview}
          title="Sin decidir, sugeridos, cambiados, que ya no aparecen o con una decisión vieja que revisar."
          onClick={() => onFilter({ needsReview: needsReview ? undefined : 'true' })}
        >
          <span aria-hidden="true">!</span> Requiere revisión <strong>{data.comparison.needsReview}</strong>
        </button>
      </div>
    </section>
  );
}

/** Una fila: nombre, tipo, estado (glifo y texto, nunca solo color), base y confianza, y la coincidencia si hay. */
function ItemRow({ item, selected, onSelect }: { item: DiscoveryReviewItem; selected: boolean; onSelect: () => void }) {
  const status = STATUS[item.status as DiscoveryStatus];
  return (
    <button type="button" className="discovery-item" aria-current={selected ? 'true' : undefined} onClick={onSelect}>
      <span className={`discovery-status status-${item.status}`}>
        <span aria-hidden="true">{status.glyph}</span> {status.label}
      </span>
      <span className="discovery-item-title">{item.title}</span>
      {(item.change || item.needsReview) && (
        <span className="discovery-item-meta">
          {item.change && (
            <span className={`discovery-change change-${item.change}`}>
              <span aria-hidden="true">{CHANGE[item.change as Change].glyph}</span> {CHANGE[item.change as Change].label}
            </span>
          )}
          {item.change && item.needsReview && ' · '}
          {item.needsReview && <span className="discovery-needs-review">Requiere revisión</span>}
        </span>
      )}
      <span className="discovery-item-meta">
        {KIND[item.kind] ?? item.kind} · {(BASIS[item.basis] ?? item.basis).toLowerCase()} · confianza {CONFIDENCE[item.confidence] ?? item.confidence}
      </span>
      {item.match && (
        <span className="discovery-item-meta">
          ≈ {item.match.target.title ?? item.match.target.id} ({REASON[item.match.reason]?.label.toLowerCase()})
        </span>
      )}
      {item.candidates && <span className="discovery-item-meta">{item.candidates.length} candidatos posibles: elige uno</span>}
      <code className="discovery-item-key">{item.key}</code>
    </button>
  );
}
