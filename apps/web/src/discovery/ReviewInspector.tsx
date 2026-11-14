import { useMemo, useRef, useState } from 'react';
import { v7 as uuidv7 } from 'uuid';
import {
  ApiError,
  type DiscoveryApplyResult,
  type DiscoveryOperation,
  type DiscoveryReviewItem,
  type DiscoveryStatus,
  type DiscoveryTarget,
} from '../api/client';
import { useApplyDiscovery, useCatalog, useDiscoveryEvidence, useFeatures, useModules } from '../api/hooks';
import { formatDayAndTime } from '../share/shareFormat';
import { BASIS, CONFIDENCE, KIND, REASON, STATUS, TARGET_KIND, targetKindFor } from './discoveryText';

type Decision =
  | { op: 'reject'; note: string }
  | { op: 'reset' }
  | { op: 'link'; target: DiscoveryTarget };

/**
 * Detalle de un hallazgo (spec walkie-live, tarea 5): qué es y por qué tiene ese estado, su coincidencia o sus
 * candidatos, la decisión guardada, la evidencia (archivo, ancla, líneas, detector y confianza; se pide al elegirlo) y
 * las decisiones posibles: vincular, descartar o restablecer. Cada decisión se previsualiza (`dryRun`) y se confirma
 * con el mismo `applyId`; un reintento tras un error de red usa el mismo, así no se aplica dos veces. Un 409 recarga la
 * revisión y pide decidir otra vez sobre lo actual. Crear elementos todavía no existe (tarea 6): no hay botón para eso.
 */
export function ReviewInspector({
  appId,
  snapshotId,
  item,
  canDecide,
}: {
  appId: string;
  snapshotId: string;
  item: DiscoveryReviewItem;
  canDecide: boolean;
}) {
  const status = STATUS[item.status as DiscoveryStatus];
  return (
    <aside className="discovery-inspector" aria-label="Detalle del hallazgo">
      <h3>{item.title}</h3>
      <p className={`discovery-status status-${item.status}`}>
        <span aria-hidden="true">{status.glyph}</span> {status.label}
      </p>
      <p className="panel-help">{status.help}</p>
      <dl className="discovery-facts">
        <dt>Tipo</dt>
        <dd>{KIND[item.kind] ?? item.kind}</dd>
        <dt>Origen</dt>
        <dd>
          {BASIS[item.basis] ?? item.basis} · confianza {CONFIDENCE[item.confidence] ?? item.confidence}
        </dd>
        <dt>Clave</dt>
        <dd>
          <code>{item.key}</code>
        </dd>
      </dl>
      {item.match && <Match target={item.match.target} reason={item.match.reason} />}
      {item.binding && <BindingInfo binding={item.binding} />}
      <Evidence snapshotId={snapshotId} entityKey={item.key} count={item.evidenceCount} />
      {canDecide ? (
        <Decisions key={item.key} appId={appId} snapshotId={snapshotId} item={item} />
      ) : (
        <p className="discovery-note">Las decisiones se toman sobre el último análisis de la fuente.</p>
      )}
    </aside>
  );
}

function Match({ target, reason }: { target: DiscoveryTarget; reason: string }) {
  return (
    <div className="discovery-box">
      <p>
        Coincide con <strong>{target.title ?? target.id}</strong> ({TARGET_KIND[target.kind]?.toLowerCase() ?? target.kind}).
      </p>
      <p className="panel-help">
        {REASON[reason]?.label}: {REASON[reason]?.help} No se vincula hasta que lo confirmes.
      </p>
    </div>
  );
}

function BindingInfo({ binding }: { binding: NonNullable<DiscoveryReviewItem['binding']> }) {
  const decision = binding.decision === 'rejected' ? 'Descartado' : binding.decision === 'created' ? 'Creado' : 'Vinculado';
  return (
    <div className="discovery-box">
      <p>
        {decision}
        {binding.target && (
          <>
            {' a '}
            <strong>{binding.target.title ?? binding.target.id}</strong> ({TARGET_KIND[binding.target.kind]?.toLowerCase()})
          </>
        )}{' '}
        el {formatDayAndTime(binding.decidedAt)}.
      </p>
      {binding.note && <p className="panel-help">Nota: {binding.note}</p>}
    </div>
  );
}

/** La evidencia de este hallazgo solo (no la del análisis entero), con sus relaciones. */
function Evidence({ snapshotId, entityKey, count }: { snapshotId: string; entityKey: string; count: number }) {
  const evidence = useDiscoveryEvidence(snapshotId, entityKey);
  return (
    <section className="discovery-evidence" aria-label="Evidencia">
      <h4>Por qué Walkie lo detectó ({count})</h4>
      {evidence.isPending && <p role="status">Cargando la evidencia…</p>}
      {evidence.isError && <p className="save-error">No se pudo cargar la evidencia.</p>}
      {evidence.data && (
        <>
          {evidence.data.foundIn !== snapshotId && (
            <p className="panel-help">Es la evidencia del análisis anterior, donde todavía aparecía.</p>
          )}
          <ul>
            {evidence.data.evidence.map((e) => (
              <li key={e.id}>
                <code>
                  {e.path}
                  {e.lines && `:${e.lines.start}${e.lines.end !== e.lines.start ? `-${e.lines.end}` : ''}`}
                </code>
                {e.symbol && (
                  <>
                    {' '}
                    <span className="discovery-item-meta">en {e.symbol}</span>
                  </>
                )}
                <span className="discovery-item-meta">
                  {' '}
                  · {e.detector} · confianza {CONFIDENCE[e.confidence] ?? e.confidence}
                </span>
                {e.note && <p className="panel-help">{e.note}</p>}
              </li>
            ))}
          </ul>
          {evidence.data.relations.length > 0 && (
            <>
              <h4>Relaciones ({evidence.data.relations.length})</h4>
              <ul>
                {evidence.data.relations.map((r) => (
                  <li key={r.key}>
                    <code>{r.from}</code> <span className="discovery-item-meta">{r.kind}</span> <code>{r.to}</code>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}

/** Vincular, descartar o restablecer: vista previa, confirmación y conflicto. */
function Decisions({ appId, snapshotId, item }: { appId: string; snapshotId: string; item: DiscoveryReviewItem }) {
  const preview = useApplyDiscovery(snapshotId, appId);
  const commit = useApplyDiscovery(snapshotId, appId);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [note, setNote] = useState('');
  const [chosen, setChosen] = useState<string>(item.match ? `${item.match.target.kind}:${item.match.target.id}` : '');
  const applyId = useRef<string | null>(null);
  const targetKind = targetKindFor(item.kind);
  const options = useCompatibleTargets(appId, item, targetKind);
  const version = item.binding?.version ?? 0;
  const decided = item.binding !== undefined;

  function start(next: Decision) {
    applyId.current = uuidv7(); // una decisión nueva: un applyId nuevo
    setDecision(next);
    commit.reset();
    preview.mutate({ applyId: applyId.current, operations: [operation(next)], dryRun: true });
  }

  function operation(d: Decision): DiscoveryOperation {
    if (d.op === 'link') return { op: 'link', entityKey: item.key, target: { kind: d.target.kind, id: d.target.id }, bindingVersion: version };
    if (d.op === 'reject') return { op: 'reject', entityKey: item.key, bindingVersion: version, ...(d.note ? { note: d.note } : {}) };
    return { op: 'reset', entityKey: item.key, bindingVersion: version };
  }

  function confirm() {
    if (!decision || !applyId.current) return;
    // El mismo applyId que la vista previa: si la red falla y se reintenta, la API no lo aplica dos veces.
    commit.mutate({ applyId: applyId.current, operations: [operation(decision)], dryRun: false });
  }

  function cancel() {
    setDecision(null);
    preview.reset();
    commit.reset();
  }

  const conflict = [preview.error, commit.error].find((e) => e instanceof ApiError && e.status === 409) as ApiError | undefined;
  const failure = conflict ? null : (commit.error ?? preview.error);
  const known = [...options, ...(item.candidates ?? []).map((c) => c.target), ...(item.match ? [item.match.target] : [])];
  const target = known.find((o) => `${o.kind}:${o.id}` === chosen);

  if (commit.data) {
    return (
      <div className="discovery-box">
        <p role="status">{done(commit.data)}</p>
        <button type="button" className="pixel-button is-ghost" onClick={cancel}>
          Tomar otra decisión
        </button>
      </div>
    );
  }

  return (
    <section className="discovery-decisions" aria-label="Decidir">
      <h4>Decidir</h4>
      {conflict && (
        <p role="alert" className="save-error">
          Alguien decidió sobre este hallazgo mientras lo mirabas. La revisión se recargó con lo actual: revísalo y vuelve a decidir.
        </p>
      )}
      {!decision && (
        <>
          {item.candidates && (
            <fieldset className="discovery-candidates">
              <legend>Varios elementos coinciden ({item.candidates.length}). Elige uno para vincular:</legend>
              {item.candidates.map((c) => (
                <label key={`${c.target.kind}:${c.target.id}`}>
                  <input
                    type="radio"
                    name={`candidato-${item.key}`}
                    checked={chosen === `${c.target.kind}:${c.target.id}`}
                    onChange={() => setChosen(`${c.target.kind}:${c.target.id}`)}
                  />{' '}
                  {c.target.title ?? c.target.id} <span className="discovery-item-meta">({REASON[c.reason]?.label.toLowerCase()})</span>
                </label>
              ))}
            </fieldset>
          )}
          {targetKind ? (
            item.status !== 'missing' && (
              <div className="discovery-link">
                <label>
                  Vincular a un elemento existente
                  <select value={chosen} onChange={(e) => setChosen(e.target.value)}>
                    <option value="">Elige uno…</option>
                    {options.map((o) => (
                      <option key={`${o.kind}:${o.id}`} value={`${o.kind}:${o.id}`}>
                        {o.title}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" className="pixel-button is-primary" disabled={!target} onClick={() => target && start({ op: 'link', target })}>
                  Vincular…
                </button>
              </div>
            )
          ) : (
            <p className="panel-help">Una pantalla no se vincula sola: entra con su feature.</p>
          )}
          {item.status !== 'rejected' && item.status !== 'missing' && (
            <div className="discovery-link">
              <label>
                Nota (opcional)
                <input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
              </label>
              <button type="button" className="pixel-button" onClick={() => start({ op: 'reject', note: note.trim() })}>
                Descartar…
              </button>
            </div>
          )}
          {decided && (
            <button type="button" className="pixel-button is-ghost" onClick={() => start({ op: 'reset' })}>
              Restablecer decisión…
            </button>
          )}
          {item.proposal.op === 'create' && (
            <p className="panel-help">Crear un elemento nuevo desde este hallazgo llegará más adelante; por ahora puedes vincularlo o descartarlo.</p>
          )}
        </>
      )}
      {decision && (
        <div className="discovery-box">
          {preview.isPending && <p role="status">Revisando…</p>}
          {preview.data && <p>{planned(preview.data)}</p>}
          {failure && (
            <p role="alert" className="save-error">
              {failure instanceof ApiError ? failure.userMessage : 'No se pudo conectar con Walkie. Vuelve a intentarlo: no se aplicará dos veces.'}
            </p>
          )}
          <div className="import-actions">
            <button type="button" className="pixel-button is-primary" disabled={!preview.data || commit.isPending || !!conflict} onClick={confirm}>
              {commit.isPending ? 'Guardando…' : 'Confirmar'}
            </button>
            <button type="button" className="pixel-button is-ghost" onClick={cancel}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Elementos de la app a los que se puede vincular este hallazgo: los del mismo tipo (como valida la API). */
function useCompatibleTargets(appId: string, item: DiscoveryReviewItem, targetKind: string | null): DiscoveryTarget[] {
  const catalog = useCatalog(appId);
  const modules = useModules(appId);
  const features = useFeatures(appId);
  return useMemo(() => {
    if (targetKind === 'catalogItem') {
      return (catalog.data ?? []).filter((c) => c.type === item.kind).map((c) => ({ kind: 'catalogItem', id: c.id, title: c.title }));
    }
    if (targetKind === 'module') return (modules.data ?? []).map((m) => ({ kind: 'module', id: m.id, title: m.name }));
    if (targetKind === 'feature') return (features.data ?? []).map((f) => ({ kind: 'feature', id: f.id, title: f.name }));
    return [];
  }, [targetKind, catalog.data, modules.data, features.data, item.kind]);
}

function planned(result: DiscoveryApplyResult): string {
  if (result.linked[0]) {
    return `Se vinculará a «${result.linked[0].target.title ?? result.linked[0].target.id}». Ese elemento no cambia: el vínculo solo dice de qué código viene.`;
  }
  if (result.rejected.length > 0) return 'Se descartará. Seguirá descartado en los análisis siguientes de esta fuente hasta que lo restablezcas.';
  return 'Se quitará la decisión. El elemento al que estaba vinculado sigue en Walkie sin cambios.';
}

function done(result: DiscoveryApplyResult): string {
  if (result.linked[0]) return `Vinculado a «${result.linked[0].target.title ?? result.linked[0].target.id}».`;
  if (result.rejected.length > 0) return 'Descartado.';
  return 'Decisión restablecida.';
}
