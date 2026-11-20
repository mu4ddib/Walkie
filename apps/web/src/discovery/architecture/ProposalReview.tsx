import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { v7 as uuidv7 } from 'uuid';
import { ApiError, type ArchitectureProposal, type DiscoveryApplyResult, type DiscoveryReviewItem } from '../../api/client';
import { useApplyDiscovery, useDiscoveryReview } from '../../api/hooks';
import { featurePath } from '../../workspace/paths';
import { planInitialCanvas, type CanvasInput } from '../initialCanvas';
import { STATUS, reviewPath } from '../discoveryText';
import { MAX_MEMBERS, choiceSummary, initialChoice, proposalOperations, type Choice } from './proposalModel';

/**
 * Revisar una propuesta de feature como conjunto: sus pantallas y APIs con su estado en Walkie, qué hacer con cada API
 * (vincular a lo existente, crear o dejar fuera), una vista previa (`dryRun`) y una sola aplicación con el mismo
 * `applyId` (un reintento no aplica dos veces). Al terminar, abre el lienzo. Nunca toca un lienzo existente.
 */
export function ProposalReview({
  appId,
  snapshotId,
  proposal,
  canEdit,
  onClose,
}: {
  appId: string;
  snapshotId: string;
  proposal: ArchitectureProposal;
  canEdit: boolean;
  onClose: () => void;
}) {
  const keys = useMemo(() => [proposal.key, ...proposal.members].slice(0, MAX_MEMBERS), [proposal]);
  const review = useDiscoveryReview(snapshotId, { keys, page: 0, pageSize: MAX_MEMBERS });
  const preview = useApplyDiscovery(snapshotId, appId);
  const commit = useApplyDiscovery(snapshotId, appId);
  const [choices, setChoices] = useState<Record<string, Choice> | null>(null);
  const [name, setName] = useState<string | null>(null);
  // Una revisión, un applyId y un id de feature: la vista previa, la confirmación y un reintento usan los mismos.
  const [applyId] = useState(() => uuidv7());
  const [featureId] = useState(() => uuidv7());
  const canvasInput = useRef<CanvasInput | undefined>(undefined);

  const items = review.data?.items ?? [];
  const self = items.find((i) => i.key === proposal.key);
  const screens = items.filter((i) => i.kind === 'screen');
  const apis = items.filter((i) => i.kind === 'api');
  // La elección inicial se calcula una vez por respuesta (un «crear» lleva su id: no puede cambiar en cada render).
  const initial = useMemo(
    () => Object.fromEntries((review.data?.items ?? []).filter((i) => i.kind === 'api').map((a) => [a.key, initialChoice(a)])),
    [review.data],
  );
  const current = choices ?? initial;
  const decided = self ? self.status !== 'new' && self.status !== 'matched' : !!proposal.decision;

  function choose(key: string, choice: Choice) {
    setChoices({ ...current, [key]: choice });
    preview.reset();
    canvasInput.current = undefined;
  }

  function operations(canvas?: CanvasInput) {
    const chosen = name?.trim();
    const suggested = preview.data?.created.find((c) => c.entityKey === proposal.key)?.target.title;
    return proposalOperations(proposal, apis, current, {
      id: featureId,
      ...(chosen && chosen !== suggested ? { name: chosen } : {}),
      ...(canvas ? { canvas } : {}),
    });
  }

  function check() {
    commit.reset();
    preview.mutate({ applyId: applyId, operations: operations(), dryRun: true });
  }

  function confirm() {
    const draft = preview.data?.created.find((c) => c.entityKey === proposal.key)?.canvas;
    if (!draft) return;
    const canvas = (canvasInput.current = planInitialCanvas(draft, canvasInput.current));
    commit.mutate({ applyId: applyId, operations: operations(canvas), dryRun: false });
  }

  const conflict = [preview.error, commit.error].find((e) => e instanceof ApiError && e.status === 409) as ApiError | undefined;
  const failure = conflict ? null : (commit.error ?? preview.error);
  // La lista llega truncada a 500: un conjunto más grande no se crea de una vez (la API también lo rechaza).
  const truncated = proposal.memberCount > proposal.members.length;
  const summary = choiceSummary(current);

  return (
    <aside className="arch-inspector arch-review" aria-label={`Revisar la propuesta ${proposal.title}`}>
      <div className="arch-review-head">
        <p className="arch-kicker">Propuesta de feature · confianza {proposal.confidence === 'medium' ? 'media' : proposal.confidence === 'high' ? 'alta' : 'baja'}</p>
        <button type="button" className="pixel-button is-ghost" onClick={onClose} aria-label="Cerrar la revisión">
          ×
        </button>
      </div>
      <h3>{proposal.title}</h3>
      {proposal.description && <p className="panel-help">{proposal.description}</p>}
      {proposal.confidence === 'low' && (
        <p className="arch-weak" role="note">
          Grupo débil: se armó con pocas pistas (por ejemplo, solo la familia de rutas). Revisa sus miembros antes de crearla.
        </p>
      )}
      {review.isPending && <p role="status">Cargando los miembros…</p>}
      {review.error && <p role="alert">No se pudieron cargar los miembros de la propuesta.</p>}

      {commit.data ? (
        <Done appId={appId} result={commit.data} entityKey={proposal.key} onClose={onClose} />
      ) : (
        review.data && (
          <>
            <section className="arch-section" aria-label="Pantallas">
              <h4>Pantallas ({screens.length})</h4>
              <p className="panel-help">Entran con la feature, con la navegación entre ellas que vio el análisis.</p>
              <ul className="arch-members">
                {screens.map((s) => (
                  <li key={s.key}>
                    <span className="arch-member-title">{s.title}</span>
                    <Status item={s} />
                  </li>
                ))}
              </ul>
            </section>

            <section className="arch-section" aria-label="APIs">
              <h4>APIs que llaman ({apis.length})</h4>
              {apis.length === 0 && <p className="panel-help">El análisis no vio llamadas de estas pantallas.</p>}
              <ul className="arch-members">
                {apis.map((a) => (
                  <ApiMember key={a.key} item={a} choice={current[a.key]!} disabled={!canEdit || decided} onChoose={(c) => choose(a.key, c)} />
                ))}
              </ul>
            </section>
            {truncated ? (
              <div className="discovery-note" role="alert">
                <p>
                  Esta propuesta tiene {proposal.memberCount} miembros y aquí se ven {proposal.members.length}: no se puede revisar ni crear como un
                  solo conjunto, porque quedarían elementos sin ver.
                </p>
                <Link to={reviewPath(appId, snapshotId)}>Decidir sus elementos uno por uno en la revisión</Link>
              </div>
            ) : decided ? (
              <p className="discovery-note" role="note">
                Esta propuesta ya tiene una decisión en Walkie ({STATUS[self?.status ?? 'created'].label.toLowerCase()}). Para cambiarla, ve a la
                revisión hallazgo por hallazgo.
              </p>
            ) : !canEdit ? (
              <p className="panel-help">Tu rol en esta app es de lectura: puedes revisar la propuesta, no crearla.</p>
            ) : (
              <div className="discovery-box">
                {!preview.data && (
                  <>
                    <p className="panel-help" aria-live="polite">
                      Entran {screens.length} {screens.length === 1 ? 'pantalla' : 'pantallas'} y{' '}
                      {summary.keep + summary.link + summary.create} {summary.keep + summary.link + summary.create === 1 ? 'API' : 'APIs'} ({summary.keep}{' '}
                      ya en Walkie, {summary.link} a vincular, {summary.create} nuevas); {summary.omit}{' '}
                      {summary.omit === 1 ? 'queda' : 'quedan'} fuera.
                    </p>
                    {summary.choose > 0 && (
                      <p className="arch-weak" role="status">
                        Elige qué hacer con {summary.choose === 1 ? '1 API' : `${summary.choose} APIs`} antes de ver qué se creará.
                      </p>
                    )}
                    <button type="button" className="pixel-button is-primary" disabled={preview.isPending || summary.choose > 0} onClick={check}>
                      {preview.isPending ? 'Revisando…' : 'Ver qué se creará'}
                    </button>
                  </>
                )}
                {preview.data && <Preview result={preview.data} entityKey={proposal.key} name={name} onName={setName} />}
                {conflict && (
                  <p role="alert" className="save-error">
                    Algo de este conjunto cambió mientras lo mirabas. La revisión se recargó: revísalo y vuelve a pedir la vista previa.
                  </p>
                )}
                {failure && (
                  <p role="alert" className="save-error">
                    {failure instanceof ApiError ? failure.userMessage : 'No se pudo conectar con Walkie. Vuelve a intentarlo: no se aplicará dos veces.'}
                  </p>
                )}
                {preview.data && (
                  <div className="import-actions">
                    <button
                      type="button"
                      className="pixel-button is-primary"
                      disabled={commit.isPending || !!conflict}
                      onClick={confirm}
                    >
                      {commit.isPending ? 'Creando…' : 'Confirmar y crear'}
                    </button>
                    <button type="button" className="pixel-button is-ghost" onClick={() => preview.reset()}>
                      Cambiar
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )
      )}
    </aside>
  );
}

function Status({ item }: { item: DiscoveryReviewItem }) {
  const s = STATUS[item.status];
  return (
    <span className={`discovery-status status-${item.status}`} title={s.help}>
      <span aria-hidden="true">{s.glyph}</span> {s.label}
      {item.basis === 'inferred' ? ' · inferida' : ''}
    </span>
  );
}

function ApiMember({
  item,
  choice,
  disabled,
  onChoose,
}: {
  item: DiscoveryReviewItem;
  choice: Choice;
  disabled: boolean;
  onChoose: (choice: Choice) => void;
}) {
  const name = `api-${item.key}`;
  if (choice.op === 'keep') {
    return (
      <li>
        <span className="arch-member-title">{item.title}</span>
        <Status item={item} />
        <span className="panel-help">Ya está en Walkie: el lienzo usa ese elemento (no se copia).</span>
      </li>
    );
  }
  const targets = [
    ...(item.match ? [item.match.target] : []),
    ...(item.candidates ?? []).map((c) => c.target),
  ];
  return (
    <li>
      <span className="arch-member-title">{item.title}</span>
      <Status item={item} />
      <fieldset className="arch-choice" disabled={disabled}>
        <legend className="sr-only">Qué hacer con {item.title}</legend>
        {targets.map((t) => (
          <label key={`${t.kind}:${t.id}`}>
            <input
              type="radio"
              name={name}
              checked={choice.op === 'link' && choice.target === `${t.kind}:${t.id}`}
              onChange={() => onChoose({ op: 'link', target: `${t.kind}:${t.id}` })}
            />{' '}
            Vincular a «{t.title ?? t.id}»
          </label>
        ))}
        {choice.op === 'choose' && (
          <span className="arch-weak">
            {item.candidates && item.candidates.length > 0
              ? 'Varias coinciden: elige una, créala aparte o déjala fuera (nunca se vincula sola).'
              : 'Coincide solo por el nombre: su método o su ruta pueden ser otros. Elige si es la misma, si se crea aparte o si queda fuera.'}
          </span>
        )}
        {item.status !== 'rejected' && item.status !== 'missing' && (
          <label>
            <input
              type="radio"
              name={name}
              checked={choice.op === 'create'}
              onChange={() => onChoose({ op: 'create', id: choice.op === 'create' ? choice.id : uuidv7() })}
            />{' '}
            Crear en el catálogo
          </label>
        )}
        <label>
          <input type="radio" name={name} checked={choice.op === 'omit'} onChange={() => onChoose({ op: 'omit' })} /> Dejar fuera del lienzo
        </label>
      </fieldset>
    </li>
  );
}

function Preview({
  result,
  entityKey,
  name,
  onName,
}: {
  result: DiscoveryApplyResult;
  entityKey: string;
  name: string | null;
  onName: (name: string) => void;
}) {
  const created = result.created.find((c) => c.entityKey === entityKey);
  const draft = created?.canvas;
  if (!created || !draft) return null;
  const screens = draft.nodes.filter((n) => n.type === 'screen').length;
  const targets = draft.nodes.filter((n) => n.type !== 'screen').length;
  const navigation = draft.edges.filter((e) => e.kind === 'navigation').length;
  const calls = draft.edges.filter((e) => e.kind === 'request').length;
  const alsoCreated = result.created.filter((c) => c.entityKey !== entityKey);
  // Un aviso por mensaje: el mismo «sin evidencia para…» de varias APIs se dice una vez.
  const warnings = [...new Map(result.warnings.filter((w) => w.code !== 'omitted').map((w) => [w.message, w])).values()];
  return (
    <section className="discovery-create" aria-label="Lo que se creará">
      <label>
        Nombre de la feature
        <input value={name ?? created.target.title ?? ''} maxLength={120} onChange={(e) => onName(e.target.value)} />
      </label>
      <dl className="discovery-facts">
        <dt>Lienzo</dt>
        <dd>
          {screens} {screens === 1 ? 'pantalla' : 'pantallas'}, {targets} {targets === 1 ? 'API' : 'APIs'}, {navigation} de navegación y {calls}{' '}
          {calls === 1 ? 'solicitud' : 'solicitudes'} HTTP
        </dd>
        <dt>Vínculos</dt>
        <dd>{result.linked.length === 0 ? 'ninguno' : result.linked.map((l) => l.target.title ?? l.target.id).join(', ')}</dd>
        <dt>Nuevo en el catálogo</dt>
        <dd>{alsoCreated.length === 0 ? 'nada' : alsoCreated.map((c) => c.target.title ?? c.entityKey).join(', ')}</dd>
      </dl>
      {draft.omitted.length > 0 && (
        <ul className="discovery-omitted" aria-label="Lo que no entra">
          {draft.omitted.map((o) => (
            <li key={o.key} data-code={o.code}>
              {o.message}
            </li>
          ))}
        </ul>
      )}
      {warnings.length > 0 && (
        <ul className="discovery-warnings" aria-label="Avisos">
          {warnings.map((w, i) => (
              <li key={`${w.code}-${i}`} data-code={w.code}>
                <span aria-hidden="true">⚠</span> {w.message}
              </li>
            ))}
        </ul>
      )}
      <p className="panel-help">Sin respuestas, códigos ni SQL: solo lo observado. Ningún lienzo existente cambia.</p>
    </section>
  );
}

function Done({ appId, result, entityKey, onClose }: { appId: string; result: DiscoveryApplyResult; entityKey: string; onClose: () => void }) {
  const feature = result.created.find((c) => c.entityKey === entityKey);
  if (result.status === 'compensated') {
    return (
      <div className="discovery-box">
        <p role="alert" className="save-error">
          No se pudo terminar: se deshizo lo creado y no quedó ninguna decisión guardada.
        </p>
        <button type="button" className="pixel-button is-ghost" onClick={onClose}>
          Cerrar
        </button>
      </div>
    );
  }
  return (
    <div className="discovery-box">
      <p role="status">
        Feature creada: «{feature?.target.title ?? entityKey}», con {result.linked.length}{' '}
        {result.linked.length === 1 ? 'vínculo' : 'vínculos'} y {result.created.length - 1} {result.created.length - 1 === 1 ? 'API nueva' : 'APIs nuevas'}.
      </p>
      {feature && (
        <Link className="pixel-button is-primary" to={featurePath(appId, feature.target.id)}>
          Abrir el lienzo
        </Link>
      )}
    </div>
  );
}
