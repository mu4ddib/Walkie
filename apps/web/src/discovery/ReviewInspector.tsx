import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
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
import { catalogPath } from '../pages/catalogPaths';
import { featurePath, modulePath } from '../workspace/paths';
import { formatDayAndTime } from '../share/shareFormat';
import { BASIS, CONFIDENCE, CONTAINER_KINDS, CREATABLE_KINDS, KIND, REASON, STATUS, TARGET_KIND, targetKindFor } from './discoveryText';
import { planInitialCanvas, type CanvasDraft, type CanvasInput } from './initialCanvas';

type Decision =
  | { op: 'reject'; note: string }
  | { op: 'reset' }
  | { op: 'reset-legacy' }
  | { op: 'link'; target: DiscoveryTarget }
  | { op: 'create'; id: string; withApis?: Record<string, string> };

type Warning = DiscoveryApplyResult['warnings'][number];

/**
 * Detalle de un hallazgo (spec walkie-live, tareas 5 y 6): qué es y por qué tiene ese estado, su coincidencia o sus
 * candidatos, la decisión guardada, la evidencia (archivo, ancla, líneas, detector y confianza; se pide al elegirlo) y
 * las decisiones posibles: crear en el catálogo (api, service, database o resource), vincular, descartar o restablecer.
 * Cada decisión se previsualiza (`dryRun`) y se confirma con el mismo `applyId` y, al crear, el mismo id del elemento:
 * un reintento tras un error de red no aplica ni crea dos veces. Un 409 recarga la revisión y pide decidir otra vez.
 * Crear no agrega el elemento a ningún lienzo.
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
      {item.binding && <BindingInfo appId={appId} binding={item.binding} targetMissing={item.targetMissing === true} />}
      {item.legacyBinding && <LegacyBindingInfo binding={item.legacyBinding} />}
      <Evidence snapshotId={snapshotId} entityKey={item.key} count={item.evidenceCount} missing={item.status === 'missing'} />
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

function BindingInfo({
  appId,
  binding,
  targetMissing,
}: {
  appId: string;
  binding: NonNullable<DiscoveryReviewItem['binding']>;
  targetMissing: boolean;
}) {
  const decision =
    binding.decision === 'rejected' ? 'Descartado' : binding.decision === 'created' ? 'Creado en el catálogo como' : 'Vinculado a';
  return (
    <div className="discovery-box">
      <p>
        {decision}
        {binding.target && (
          <>
            {' '}
            <strong>{binding.target.title ?? binding.target.id}</strong> ({TARGET_KIND[binding.target.kind]?.toLowerCase()})
          </>
        )}{' '}
        el {formatDayAndTime(binding.decidedAt)}.
      </p>
      {binding.note && <p className="panel-help">Nota: {binding.note}</p>}
      {targetMissing ? (
        <p role="note" className="discovery-warning">
          <span aria-hidden="true">⚠</span> Ese elemento ya no existe en Walkie (se borró). La decisión sigue guardada pero no apunta a nada:
          restablécela para vincularlo a otro o crearlo de nuevo.
        </p>
      ) : (
        binding.target?.kind === 'catalogItem' && (
          <Link to={catalogPath(appId, binding.target.id)}>Ver en el catálogo</Link>
        )
      )}
    </div>
  );
}

/**
 * Una decisión tomada con la clave de la versión 0 (sin la app) que corresponde a este hallazgo y a otro de otra app
 * (ADR-0014). Walkie no elige a cuál pasa: decide sobre este y restablece la vieja.
 */
function LegacyBindingInfo({ binding }: { binding: NonNullable<DiscoveryReviewItem['legacyBinding']> }) {
  const decision = binding.decision === 'rejected' ? 'descartó' : 'vinculó';
  return (
    <div className="discovery-box" role="note">
      <p className="discovery-warning">
        <span aria-hidden="true">⚠</span> El {formatDayAndTime(binding.decidedAt)} se {decision} <code>{binding.entityKey}</code>
        {binding.target && (
          <>
            {' '}
            a <strong>{binding.target.title ?? binding.target.id}</strong>
          </>
        )}
        , antes de que Walkie distinguiera la app. Esa ruta está ahora en más de una app, así que no se sabe a cuál se refería.
      </p>
      <p className="panel-help">
        Decide sobre este hallazgo (y sobre el de la otra app) y después restablece la decisión vieja. Mientras tanto no se marca
        como desaparecida.
      </p>
    </div>
  );
}

/**
 * La evidencia de este hallazgo solo (no la del análisis entero), con sus relaciones. Distingue un hallazgo sin
 * evidencia guardada (404: no es un fallo) de un error al pedirla (se puede reintentar).
 */
function Evidence({ snapshotId, entityKey, count, missing }: { snapshotId: string; entityKey: string; count: number; missing: boolean }) {
  const evidence = useDiscoveryEvidence(snapshotId, entityKey);
  const absent = evidence.error instanceof ApiError && evidence.error.status === 404;
  return (
    <section className="discovery-evidence" aria-label="Evidencia">
      <h4>Por qué Walkie lo detectó ({count})</h4>
      {evidence.isPending && <p role="status">Cargando la evidencia…</p>}
      {absent && (
        <p className="panel-help">
          {missing
            ? 'Ya no aparece en este análisis y la evidencia del anterior no está disponible: no hay nada que mostrar.'
            : 'Este hallazgo no tiene evidencia guardada en este análisis.'}
        </p>
      )}
      {evidence.isError && !absent && (
        <p role="alert" className="save-error">
          No se pudo cargar la evidencia.{' '}
          <button type="button" className="pixel-button is-ghost" onClick={() => void evidence.refetch()}>
            Reintentar
          </button>
        </p>
      )}
      {evidence.data && (
        <>
          {evidence.data.foundIn !== snapshotId && (
            <p className="panel-help">Es la evidencia del análisis anterior, donde todavía aparecía.</p>
          )}
          {evidence.data.evidence.length === 0 && <p className="panel-help">Sin evidencia registrada.</p>}
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
  const canCreate = CREATABLE_KINDS.includes(item.kind) && !decided && item.status !== 'missing';
  const container = CONTAINER_KINDS.includes(item.kind);
  const canCreateContainer = container && !decided && item.status !== 'missing';
  // Ids y posiciones del lienzo inicial: se calculan una vez por borrador y se reutilizan en un reintento.
  const canvasInput = useRef<CanvasInput | undefined>(undefined);
  // Nombre elegido (null: el que propone la vista previa).
  const [name, setName] = useState<string | null>(null);

  function start(next: Decision) {
    applyId.current = uuidv7(); // una decisión nueva: un applyId nuevo
    canvasInput.current = undefined;
    setName(null);
    setDecision(next);
    commit.reset();
    preview.mutate({ applyId: applyId.current, operations: operations(next), dryRun: true });
  }

  /**
   * Las operaciones de la decisión: la principal y, al crear un módulo o una feature, las APIs que la persona eligió
   * crear también en el catálogo (van primero: el lienzo las referencia). `canvas` solo al confirmar.
   */
  function operations(d: Decision, canvas?: CanvasInput): DiscoveryOperation[] {
    const main = operation(d);
    if (d.op !== 'create' || !container) return [main];
    const apis = Object.entries(d.withApis ?? {}).map(
      ([entityKey, id]): DiscoveryOperation => ({ op: 'create', entityKey, id, bindingVersion: 0 }),
    );
    const chosen = name?.trim();
    const suggested = preview.data?.created.find((c) => c.entityKey === item.key)?.target.title;
    return [
      ...apis,
      { ...main, ...(chosen && chosen !== suggested ? { name: chosen } : {}), ...(canvas ? { canvas } : {}) },
    ];
  }

  /** Suma o quita las APIs que faltan en el catálogo y vuelve a pedir la vista previa (mismo applyId). */
  function toggleApis(keys: string[], on: boolean) {
    if (decision?.op !== 'create' || !applyId.current) return;
    const next: Decision = { ...decision, withApis: on ? Object.fromEntries(keys.map((k) => [k, uuidv7()])) : undefined };
    setDecision(next);
    canvasInput.current = undefined;
    preview.mutate({ applyId: applyId.current, operations: operations(next), dryRun: true });
  }

  function operation(d: Decision): DiscoveryOperation {
    // El id del elemento es parte de la decisión: la vista previa y la confirmación (y un reintento) usan el mismo.
    if (d.op === 'create') return { op: 'create', entityKey: item.key, id: d.id, bindingVersion: version };
    if (d.op === 'reject') return { op: 'reject', entityKey: item.key, bindingVersion: version, ...(d.note ? { note: d.note } : {}) };
    if (d.op === 'link') return { op: 'link', entityKey: item.key, target: { kind: d.target.kind, id: d.target.id }, bindingVersion: version };
    if (d.op === 'reset-legacy' && item.legacyBinding) {
      return { op: 'reset', entityKey: item.legacyBinding.entityKey, bindingVersion: item.legacyBinding.version };
    }
    return { op: 'reset', entityKey: item.key, bindingVersion: version };
  }

  function confirm() {
    if (!decision || !applyId.current) return;
    // El mismo applyId que la vista previa: si la red falla y se reintenta, la API no lo aplica dos veces.
    let canvas: CanvasInput | undefined;
    if (decision.op === 'create' && container) {
      const draft = preview.data?.created.find((c) => c.entityKey === item.key)?.canvas;
      if (!draft) return;
      canvas = canvasInput.current = planInitialCanvas(draft, canvasInput.current);
    }
    commit.mutate({ applyId: applyId.current, operations: operations(decision, canvas), dryRun: false });
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
    return <Done appId={appId} entityKey={item.key} result={commit.data} onAgain={cancel} />;
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
          {canCreate && (
            <div className="discovery-link">
              <p className="panel-help">
                {item.match || item.candidates
                  ? 'Si no es el mismo que el existente, puedes crearlo aparte.'
                  : 'Crea un elemento nuevo del catálogo con lo que vio el análisis.'}{' '}
                No se agrega a ningún lienzo.
              </p>
              <button type="button" className="pixel-button is-primary" onClick={() => start({ op: 'create', id: uuidv7() })}>
                Crear en el catálogo…
              </button>
            </div>
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
          {item.legacyBinding && (
            <button type="button" className="pixel-button is-ghost" onClick={() => start({ op: 'reset-legacy' })}>
              Restablecer la decisión vieja…
            </button>
          )}
          {canCreateContainer && (
            <div className="discovery-link">
              <p className="panel-help">
                {item.kind === 'feature'
                  ? 'Crea una feature nueva con un lienzo inicial: sus pantallas, la navegación y las llamadas que el análisis vio. No cambia ningún lienzo existente.'
                  : 'Crea un módulo nuevo con un lienzo inicial: sus APIs y las interfaces que ofrece. No cambia ningún lienzo existente.'}
              </p>
              <button type="button" className="pixel-button is-primary" onClick={() => start({ op: 'create', id: uuidv7() })}>
                {item.kind === 'feature' ? 'Crear feature…' : 'Crear módulo…'}
              </button>
            </div>
          )}
        </>
      )}
      {decision && (
        <div className="discovery-box">
          {preview.isPending && <p role="status">Revisando…</p>}
          {preview.data &&
            (decision.op === 'create' && container ? (
              <CanvasPreview
                result={preview.data}
                entityKey={item.key}
                kind={item.kind}
                name={name}
                onName={setName}
                withApis={decision.withApis !== undefined}
                onApis={toggleApis}
              />
            ) : decision.op === 'create' ? (
              <CreatePreview result={preview.data} entityKey={item.key} />
            ) : (
              <>
                <p>{planned(preview.data)}</p>
                <Warnings warnings={preview.data.warnings} />
              </>
            ))}
          {commit.isPending && <p role="status">{decision.op === 'create' ? (container ? 'Creando…' : 'Creando en el catálogo…') : 'Guardando…'}</p>}
          {failure && (
            <p role="alert" className="save-error">
              {failure instanceof ApiError ? failure.userMessage : 'No se pudo conectar con Walkie. Vuelve a intentarlo: no se aplicará dos veces.'}
            </p>
          )}
          <div className="import-actions">
            <button
              type="button"
              className="pixel-button is-primary"
              disabled={!preview.data || preview.isPending || commit.isPending || !!conflict}
              onClick={confirm}
            >
              {commit.isPending ? 'Guardando…' : decision.op === 'create' ? 'Confirmar y crear' : 'Confirmar'}
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

/** Lo que se creará, tal como queda en el catálogo (lo calcula la API con las mismas reglas que al crear). */
function CreatePreview({ result, entityKey }: { result: DiscoveryApplyResult; entityKey: string }) {
  const item = result.created.find((c) => c.entityKey === entityKey)?.item;
  if (!item) return null;
  const database = [item.database?.engine, item.database?.name].filter(Boolean).join(' · ');
  return (
    <section className="discovery-create" aria-label="Lo que se creará">
      <p>Se creará en el catálogo:</p>
      <dl className="discovery-facts">
        <dt>Tipo</dt>
        <dd>{KIND[item.type] ?? item.type}</dd>
        <dt>Nombre</dt>
        <dd>{item.title}</dd>
        {item.description && (
          <>
            <dt>Descripción</dt>
            <dd>{item.description}</dd>
          </>
        )}
        {item.http && (
          <>
            <dt>Contrato</dt>
            <dd>
              <code>
                {item.http.method} {item.http.path}
              </code>
            </dd>
          </>
        )}
        {item.database && (
          <>
            <dt>Base</dt>
            <dd>{database || 'sin motor ni nombre'}</dd>
          </>
        )}
        {item.resource && (
          <>
            <dt>Recurso</dt>
            <dd>
              {item.resource.kind}
              {item.resource.name ? ` · ${item.resource.name}` : ''}
            </dd>
          </>
        )}
        {item.runtime && (
          <>
            <dt>Dónde corre</dt>
            <dd>{item.runtime}</dd>
          </>
        )}
        <dt>Id</dt>
        <dd>
          <code>{item.id}</code>
        </dd>
      </dl>
      <p className="panel-help">
        No se agrega a ningún lienzo ni cambia nada de lo que ya existe. Lo que el análisis no vio queda vacío para completarlo en el catálogo.
      </p>
      <Warnings warnings={result.warnings.filter((w) => !w.entityKey || w.entityKey === entityKey)} />
    </section>
  );
}

const OMITTED_HELP: Record<string, string> = {
  'api-undecided': 'Sin decidir',
  'api-rejected': 'Descartada',
  'api-target-missing': 'Su elemento se borró',
  'ambiguous-api': 'Ambigua',
  'screen-rejected': 'Descartada',
  'screen-decided': 'Ya en otra feature',
};

/**
 * La vista previa de un módulo o una feature (tarea 9): el nombre, qué cajas, conexiones e interfaces tendrá su lienzo
 * inicial, qué queda fuera y por qué, y los avisos. Lo arma la API con las mismas reglas que al crear.
 */
function CanvasPreview({
  result,
  entityKey,
  kind,
  name,
  onName,
  withApis,
  onApis,
}: {
  result: DiscoveryApplyResult;
  entityKey: string;
  kind: string;
  name: string | null;
  onName: (name: string) => void;
  withApis: boolean;
  onApis: (keys: string[], on: boolean) => void;
}) {
  const created = result.created.find((c) => c.entityKey === entityKey);
  const draft: CanvasDraft | undefined = created?.canvas;
  if (!created || !draft) return null;
  const screens = draft.nodes.filter((n) => n.type === 'screen');
  const targets = draft.nodes.filter((n) => n.type !== 'screen');
  const navigation = draft.edges.filter((e) => e.kind === 'navigation').length;
  const calls = draft.edges.filter((e) => e.kind === 'request').length;
  const undecided = draft.omitted.filter((o) => o.code === 'api-undecided').map((o) => o.key);
  const alsoCreated = result.created.filter((c) => c.entityKey !== entityKey);
  const title = (key: string) => draft.nodes.find((n) => n.key === key)?.title ?? key;
  return (
    <section className="discovery-create" aria-label="Lo que se creará">
      <p>{kind === 'feature' ? 'Se creará una feature nueva con su lienzo inicial:' : 'Se creará un módulo nuevo con su lienzo inicial:'}</p>
      <label>
        Nombre
        <input value={name ?? created.target.title ?? ''} maxLength={120} onChange={(e) => onName(e.target.value)} />
      </label>
      <dl className="discovery-facts">
        {kind === 'feature' && (
          <>
            <dt>Pantallas</dt>
            <dd>{screens.length === 0 ? 'ninguna' : screens.map((s) => `${s.title}${s.route ? ` (${s.route})` : ''}`).join(', ')}</dd>
          </>
        )}
        <dt>{kind === 'feature' ? 'Llama a' : 'APIs'}</dt>
        <dd>{targets.length === 0 ? 'ninguna' : targets.map((t) => (t.type === 'module' ? `${t.title} (módulo)` : t.title)).join(', ')}</dd>
        <dt>Conexiones</dt>
        <dd>
          {kind === 'feature'
            ? `${navigation} de navegación y ${calls} solicitud${calls === 1 ? '' : 'es'} HTTP, tal como las vio el análisis`
            : 'ninguna'}
        </dd>
        {draft.interfaces.length > 0 && (
          <>
            <dt>Interfaces</dt>
            <dd>{draft.interfaces.map((i) => `${i.name} (ofrece ${title(i.node)})`).join(', ')}</dd>
          </>
        )}
        {alsoCreated.length > 0 && (
          <>
            <dt>También en el catálogo</dt>
            <dd>{alsoCreated.map((c) => c.target.title ?? c.entityKey).join(', ')}</dd>
          </>
        )}
      </dl>
      {draft.omitted.length > 0 && (
        <>
          <p>No entra al lienzo:</p>
          <ul className="discovery-omitted" aria-label="Lo que no entra">
            {draft.omitted.map((o) => (
              <li key={o.key} data-code={o.code}>
                <strong>{OMITTED_HELP[o.code] ?? o.code}:</strong> {o.message}
              </li>
            ))}
          </ul>
        </>
      )}
      {(undecided.length > 0 || withApis) && (
        <label className="discovery-check">
          <input type="checkbox" checked={withApis} onChange={(e) => onApis(undecided, e.target.checked)} /> Crear también en el catálogo las APIs que
          faltan{undecided.length > 0 ? ` (${undecided.length})` : ''}
        </label>
      )}
      <p className="panel-help">
        Sin respuestas, códigos ni pasos internos: solo lo que el análisis observó. Después lo editas en el lienzo como cualquier otro; un análisis nuevo
        nunca lo sobrescribe.
      </p>
      <Warnings warnings={result.warnings.filter((w) => w.code !== 'omitted')} />
    </section>
  );
}

function Warnings({ warnings }: { warnings: Warning[] }) {
  if (warnings.length === 0) return null;
  return (
    <ul className="discovery-warnings" aria-label="Avisos">
      {warnings.map((w, i) => (
        <li key={`${w.code}-${i}`} data-code={w.code}>
          <span aria-hidden="true">⚠</span> {w.message}
        </li>
      ))}
    </ul>
  );
}

/** El resultado real: lo creado con su enlace al catálogo, o que se deshizo (compensated) y por qué. */
function Done({ appId, entityKey, result, onAgain }: { appId: string; entityKey: string; result: DiscoveryApplyResult; onAgain: () => void }) {
  const created = result.created.find((c) => c.entityKey === entityKey) ?? result.created[0];
  if (result.status === 'compensated') {
    return (
      <div className="discovery-box">
        <p role="alert" className="save-error">
          No se pudo terminar: se deshizo lo que se había creado y no quedó ninguna decisión guardada.
        </p>
        <Warnings warnings={result.warnings.filter((w) => w.code !== 'compensated')} />
        <button type="button" className="pixel-button is-ghost" onClick={onAgain}>
          Volver a decidir
        </button>
      </div>
    );
  }
  return (
    <div className="discovery-box">
      <p role="status">{done(result, created)}</p>
      {created?.target.kind === 'feature' ? (
        <Link className="pixel-button is-primary" to={featurePath(appId, created.target.id)}>
          Abrir la feature
        </Link>
      ) : created?.target.kind === 'module' ? (
        <Link className="pixel-button is-primary" to={modulePath(appId, created.target.id)}>
          Abrir el módulo
        </Link>
      ) : (
        created && (
          <Link className="pixel-button is-primary" to={catalogPath(appId, created.target.id)}>
            Abrir en el catálogo
          </Link>
        )
      )}
      <button type="button" className="pixel-button is-ghost" onClick={onAgain}>
        Tomar otra decisión
      </button>
    </div>
  );
}

function planned(result: DiscoveryApplyResult): string {
  if (result.linked[0]) {
    return `Se vinculará a «${result.linked[0].target.title ?? result.linked[0].target.id}». Ese elemento no cambia: el vínculo solo dice de qué código viene.`;
  }
  if (result.rejected.length > 0) return 'Se descartará. Seguirá descartado en los análisis siguientes de esta fuente hasta que lo restablezcas.';
  return 'Se quitará la decisión. El elemento al que estaba vinculado sigue en Walkie sin cambios.';
}

function done(result: DiscoveryApplyResult, created: DiscoveryApplyResult['created'][number] | undefined): string {
  if (created?.target.kind === 'feature') return `Feature creada: «${created.target.title ?? created.target.id}», con su lienzo inicial.`;
  if (created?.target.kind === 'module') return `Módulo creado: «${created.target.title ?? created.target.id}», con su lienzo e interfaces.`;
  if (created) return `Creado en el catálogo: «${created.target.title ?? created.target.id}».`;
  if (result.linked[0]) return `Vinculado a «${result.linked[0].target.title ?? result.linked[0].target.id}».`;
  if (result.rejected.length > 0) return 'Descartado.';
  return 'Decisión restablecida.';
}
