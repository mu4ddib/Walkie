import { useId, useState } from 'react';
import { effectiveType, refTarget, useCanvasCatalog } from '../catalog/catalogContext';
import {
  DATA_OPERATION_LABELS,
  DATA_OPERATIONS,
  LIMITS,
  PARAM_LABELS,
  PARAM_PLACES,
  normalizeEdgeData,
  normalizeEdgeRequest,
  splitList,
  type EdgeData,
  type EdgeRequest,
} from '../contracts/contracts';
import {
  KIND_LABELS,
  SELECTABLE_KINDS,
  edgeDisplay,
  endpointText,
  interactionEdges,
  responseStatus,
  statusTone,
} from '../edges/edgeMeta';
import { useChangeEdgeKind } from '../edges/useChangeEdgeKind';
import { nodeLabel } from '../nodes/nodeMeta';
import type { Edge, Http, Node } from '../schema/walkie-graph';
import {
  EDGE_TEXT_MAX_LENGTH,
  EXAMPLE_MAX_LENGTH,
  HTTP_METHODS,
  OUTCOME_MAX_LENGTH,
  TEXT_MAX_LENGTH,
  type EdgeKind,
  type HttpMethod,
} from '../store/graphStore';
import { useGraphStore } from '../store/useGraphStore';
import { TextField } from './TextField';
import { removeAt, replaceAt } from './contract/lists';
import { AddButton, Choice, Field, Row, Section } from './contract/rows';
import { useDraft } from './contract/useDraft';

/** Lo que el inspector de una conexión necesita del lienzo; sin ello (pruebas) esas acciones no se ofrecen. */
export interface EdgePanelActions {
  /** Selecciona otra caja o conexión (ir al contrato de la API, a la solicitud o a una respuesta). */
  onSelect?: (target: { nodeId?: string; edgeId?: string }) => void;
  /** "Previsualizar interacción": recorre la conexión o el par solicitud/respuesta en el lienzo. */
  preview?: { activeEdgeId: string | null; onStart: (edgeId: string) => void; onStop: () => void };
}

/**
 * Inspector de una conexión: primero el resumen (origen → destino, tipo y etiqueta) y después solo lo que
 * corresponde a esa interacción (solicitud, respuesta, rama de decisión, acceso a datos…), con lo opcional en
 * secciones plegables. El contrato completo vive en el nodo API; aquí va lo propio de este intercambio.
 */
export function EdgePanel({ id, onSelect, preview }: { id: string } & EdgePanelActions) {
  const edge = useGraphStore((s) => s.edges[id]);
  const edges = useGraphStore((s) => s.edges);
  const nodes = useGraphStore((s) => s.nodes);
  const updateEdge = useGraphStore((s) => s.updateEdge);
  const changeKind = useChangeEdgeKind();
  const { items } = useCanvasCatalog();
  const kindId = useId();
  // Aviso de que el cambio de tipo invirtió el sentido (con su "Deshacer").
  const [reversed, setReversed] = useState(false);
  if (!edge) return null;

  const from = nodes[edge.from];
  const to = nodes[edge.to];
  const branch = from?.branches?.find((b) => b.id === edge.branch);
  const fromDecision = from?.type === 'rule' && from.mode === 'decision';
  const targetHttp = to && (refTarget(to, items)?.http ?? to.http);
  const targetIsApi = !!to && effectiveType(to, items) === 'api';
  const display = edgeDisplay(edge, { branchLabel: branch?.label, targetHttp });
  const kinds = SELECTABLE_KINDS.includes(edge.kind) ? SELECTABLE_KINDS : [edge.kind, ...SELECTABLE_KINDS];
  const title = (node: Node | undefined) => (node ? (refTarget(node, items)?.title ?? node.title) : '—');
  const exchange = interactionEdges(edges, id);
  const previewing = !!preview?.activeEdgeId && exchange.includes(preview.activeEdgeId);
  const defaultLabel = endpointText(edge, targetHttp);

  return (
    <>
      <h3>Conexión</h3>
      <section className="edge-summary" aria-label="Resumen de la conexión">
        <div className="edge-route">
          <EndButton node={from} title={title(from)} onSelect={onSelect} />
          <span className="edge-route-arrow" aria-label="hacia">
            →
          </span>
          <EndButton node={to} title={title(to)} onSelect={onSelect} />
        </div>
        <div className="edge-summary-label">
          <span className="kind-edge-main">{display.main}</span>
          {display.code !== undefined && (
            <span className="kind-edge-code" data-tone={statusTone(display.code)}>
              {display.code}
            </span>
          )}
          {display.detail && <span className={display.mono ? 'is-mono' : undefined}>· {display.detail}</span>}
          {display.when && <span className="kind-edge-when">[{display.when}]</span>}
        </div>
        <div className="edge-summary-actions">
          <button
            type="button"
            className="pixel-button"
            data-tip="Intercambia origen y destino; la etiqueta se conserva"
            onClick={() => {
              updateEdge(id, { reverse: true });
              setReversed(false);
            }}
          >
            ⇄ Invertir sentido
          </button>
          {preview && (
            <button
              type="button"
              className="pixel-button"
              aria-pressed={previewing}
              data-tip={
                exchange.length > 1
                  ? 'Recorre en el lienzo la ida y luego la vuelta'
                  : 'Destaca los extremos y recorre la conexión en el lienzo'
              }
              onClick={() => (previewing ? preview.onStop() : preview.onStart(id))}
            >
              {previewing ? '■ Detener' : '▶ Previsualizar interacción'}
            </button>
          )}
        </div>
        {reversed && (
          <p className="edge-note" role="status">
            Se invirtió el sentido para que coincida con «{KIND_LABELS[edge.kind]}».{' '}
            <button
              type="button"
              className="link-button"
              onClick={() => {
                updateEdge(id, { reverse: true });
                setReversed(false);
              }}
            >
              Deshacer
            </button>
          </p>
        )}
      </section>

      <div className="panel-field">
        <label htmlFor={kindId}>Tipo</label>
        <select
          id={kindId}
          value={edge.kind}
          onChange={(e) => setReversed(changeKind(id, e.target.value as EdgeKind))}
        >
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
        placeholder={defaultLabel ? `Por defecto: ${defaultLabel}` : 'Opcional'}
        onChange={(label) => updateEdge(id, { label })}
      />

      {fromDecision && from && <BranchSection edge={edge} decision={from} />}
      {edge.kind === 'request' && (
        <RequestSection edge={edge} targetHttp={targetIsApi ? targetHttp : undefined} apiId={targetIsApi ? to?.id : undefined} onSelect={onSelect} />
      )}
      {edge.kind === 'response' && <ResponseSection edge={edge} onSelect={onSelect} />}
      {(edge.kind === 'reads' || edge.kind === 'writes' || edge.data) && <DataSection edge={edge} />}
      {edge.kind === 'event' && <ExampleSection edge={edge} title="Ejemplo de payload" />}
      {!fromDecision && edge.kind !== 'response' && <ConditionSection edge={edge} />}

      <Section title="Notas" defaultOpen={!!edge.notes}>
        <TextField
          label="Notas de la interacción"
          multiline
          value={edge.notes ?? ''}
          maxLength={TEXT_MAX_LENGTH}
          placeholder="Reintentos, tiempos, qué pasa si falla"
          onChange={(notes) => updateEdge(id, { notes })}
        />
      </Section>
    </>
  );
}

function EndButton({
  node,
  title,
  onSelect,
}: {
  node: Node | undefined;
  title: string;
  onSelect?: EdgePanelActions['onSelect'];
}) {
  const kind = node ? nodeLabel(node).label : '';
  if (!node || !onSelect) return <span className="edge-route-end">{title}</span>;
  return (
    <button
      type="button"
      className="edge-route-end"
      data-tip={`Ver ${kind.toLowerCase()}`}
      onClick={() => onSelect({ nodeId: node.id })}
    >
      {title}
    </button>
  );
}

/** Rama de decisión: a qué salida corresponde esta conexión, su etiqueta y la condición que la activa. */
function BranchSection({ edge, decision }: { edge: Edge; decision: Node }) {
  const updateEdge = useGraphStore((s) => s.updateEdge);
  const renameBranch = useGraphStore((s) => s.renameBranch);
  const branchId = useId();
  const branches = decision.branches ?? [];
  const branch = branches.find((b) => b.id === edge.branch);

  return (
    <section className="panel-section" aria-label="Rama de decisión">
      <h4>Rama de decisión</h4>
      <div className="panel-field">
        <label htmlFor={branchId}>Salida</label>
        <select id={branchId} value={branch?.id ?? ''} onChange={(e) => updateEdge(edge.id, { branch: e.target.value || null })}>
          <option value="">Sin asignar</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
      </div>
      {branch && (
        <TextField
          // La etiqueta es de la salida: cambia en la caja y en todas las conexiones de esa rama.
          key={branch.id}
          label="Etiqueta de salida"
          value={branch.label}
          maxLength={EDGE_TEXT_MAX_LENGTH}
          onChange={(label) => renameBranch(decision.id, branch.id, label)}
        />
      )}
      <TextField
        label="Condición"
        placeholder="Qué debe cumplirse para tomar esta rama"
        value={edge.when ?? ''}
        maxLength={EDGE_TEXT_MAX_LENGTH}
        onChange={(when) => updateEdge(edge.id, { when })}
      />
    </section>
  );
}

/** Solicitud: endpoint vinculado al contrato de la API, parámetros y ejemplo de este paso, y sus respuestas. */
function RequestSection({
  edge,
  targetHttp,
  apiId,
  onSelect,
}: {
  edge: Edge;
  targetHttp: Http | undefined;
  apiId: string | undefined;
  onSelect?: EdgePanelActions['onSelect'];
}) {
  const updateEdge = useGraphStore((s) => s.updateEdge);
  const addResponse = useGraphStore((s) => s.addResponse);
  const edges = useGraphStore((s) => s.edges);
  const [request, setRequest] = useDraft<EdgeRequest>(
    edge.request,
    normalizeEdgeRequest,
    (next) => updateEdge(edge.id, { request: next ?? null }),
    {},
  );
  const methodId = useId();
  const params = request.params ?? [];
  const contract = [targetHttp?.method, targetHttp?.path].filter(Boolean).join(' ');
  const own = !!(edge.request?.method || edge.request?.path);
  const responses = Object.values(edges).filter((e) => e.kind === 'response' && e.replyTo === edge.id);
  const used = new Set(responses.map((r) => responseStatus(r)));
  // Códigos documentados en el contrato que este intercambio aún no tiene: se añaden con un clic.
  const documented = [...new Set((targetHttp?.responses ?? []).map((r) => r.status))].filter((s) => !used.has(s));

  function add(status?: number) {
    const id = addResponse(edge.id, { status });
    if (id) onSelect?.({ edgeId: id });
  }

  return (
    <>
      <section className="panel-section" aria-label="Solicitud">
        <h4>Solicitud</h4>
        {apiId && (
          <p className="edge-contract">
            <span>
              {contract ? (
                <>
                  Contrato de la API: <code>{contract}</code>
                </>
              ) : (
                'La API aún no documenta método ni ruta.'
              )}
            </span>
            {onSelect && (
              <button type="button" className="link-button" onClick={() => onSelect({ nodeId: apiId })}>
                Ver contrato
              </button>
            )}
          </p>
        )}
        <div className="contract-grid">
          <div className="contract-field">
            <label htmlFor={methodId}>Método</label>
            <select
              id={methodId}
              value={request.method ?? ''}
              onChange={(e) => setRequest({ ...request, method: (e.target.value || undefined) as HttpMethod | undefined })}
            >
              <option value="">{targetHttp?.method ? `${targetHttp.method} (API)` : '—'}</option>
              {HTTP_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <Field
            label="Ruta de este paso"
            mono
            value={request.path}
            maxLength={2000}
            placeholder={targetHttp?.path ?? '/recurso'}
            onChange={(path) => setRequest({ ...request, path })}
          />
        </div>
        {own && apiId && (
          <button
            type="button"
            className="link-button"
            onClick={() => setRequest({ ...request, method: undefined, path: undefined })}
          >
            Usar el endpoint del contrato
          </button>
        )}
      </section>

      <Section title="Parámetros y headers" count={params.length ? String(params.length) : undefined} defaultOpen={params.length > 0}>
        {params.map((p, i) => (
          <Row key={i} label={`parámetro ${p.name || i + 1}`} onRemove={() => setRequest({ ...request, params: removeAt(params, i) })}>
            <Field
              label="Nombre"
              value={p.name}
              maxLength={LIMITS.name}
              onChange={(name) => setRequest({ ...request, params: replaceAt(params, i, { ...p, name }) })}
            />
            <Choice
              label="Dónde"
              value={p.in}
              options={PARAM_PLACES}
              labels={PARAM_LABELS}
              onChange={(where) => setRequest({ ...request, params: replaceAt(params, i, { ...p, in: where ?? 'query' }) })}
            />
            <Field
              label="Valor en este paso"
              wide
              mono
              value={p.value}
              maxLength={LIMITS.short}
              onChange={(value) => setRequest({ ...request, params: replaceAt(params, i, { ...p, value }) })}
            />
          </Row>
        ))}
        <AddButton label="Parámetro o header" onClick={() => setRequest({ ...request, params: [...params, { name: '', in: 'query' }] })} />
      </Section>

      <ExampleSection edge={edge} title="Ejemplo de payload" />

      <section className="panel-section" aria-label="Respuestas">
        <h4>Respuestas</h4>
        {responses.length > 0 && (
          <ul className="edge-links">
            {responses.map((r) => {
              const code = responseStatus(r);
              return (
                <li key={r.id}>
                  <button type="button" className="edge-link" onClick={() => onSelect?.({ edgeId: r.id })} disabled={!onSelect}>
                    {code !== undefined ? (
                      <span className="kind-edge-code" data-tone={statusTone(code)}>
                        {code}
                      </span>
                    ) : (
                      <span className="edge-link-muted">sin código</span>
                    )}
                    <span>{r.label ?? r.outcome ?? 'Respuesta'}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="edge-add-responses">
          <button
            type="button"
            className="pixel-button"
            data-tip="Crea el retorno en sentido inverso, vinculado a esta solicitud"
            onClick={() => add()}
          >
            + Añadir respuesta
          </button>
          {documented.slice(0, 6).map((status) => (
            <button
              key={status}
              type="button"
              className="pixel-button is-ghost"
              aria-label={`Añadir respuesta ${status}`}
              data-tip="Código documentado en el contrato"
              onClick={() => add(status)}
            >
              + {status}
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

/** Respuesta: solicitud asociada, código HTTP (campo propio, no una condición), ejemplo y qué ocurre después. */
function ResponseSection({ edge, onSelect }: { edge: Edge; onSelect?: EdgePanelActions['onSelect'] }) {
  const updateEdge = useGraphStore((s) => s.updateEdge);
  const edges = useGraphStore((s) => s.edges);
  const nodes = useGraphStore((s) => s.nodes);
  const { items } = useCanvasCatalog();
  const requestId = useId();
  const statusId = useId();
  const codesId = useId();
  const status = responseStatus(edge);
  const legacyCode = status !== undefined && edge.status === undefined;
  // Texto del campo: lo que se escribe, aunque todavía no sea un código completo.
  const [draft, setDraft] = useState(status === undefined ? '' : String(status));
  const [seen, setSeen] = useState(status);
  if (status !== seen) {
    setSeen(status);
    if (String(status ?? '') !== draft.trim()) setDraft(status === undefined ? '' : String(status));
  }
  const invalid = draft.trim() !== '' && !/^[1-5]\d\d$/.test(draft.trim());

  // Solicitudes candidatas: primero las que van en sentido contrario entre los mismos nodos.
  const requests = Object.values(edges).filter((e) => e.kind === 'request');
  const mirrored = requests.filter((r) => r.from === edge.to && r.to === edge.from);
  const others = requests.filter((r) => !mirrored.includes(r));
  const describe = (r: Edge) => {
    const target = nodes[r.to];
    const text = r.label ?? endpointText(r, target && (refTarget(target, items)?.http ?? target.http));
    return `${nodes[r.from]?.title ?? '—'} → ${target ? (refTarget(target, items)?.title ?? target.title) : '—'}${text ? ` · ${text}` : ''}`;
  };
  const source = nodes[edge.from];
  const contract = source && (refTarget(source, items)?.http ?? source.http);
  const documented = contract?.responses?.find((r) => r.status === status);

  function setStatus(value: string) {
    setDraft(value);
    const clean = value.trim();
    if (clean === '') updateEdge(edge.id, { status: null, when: legacyCode ? '' : undefined });
    // Un código que venía en la condición pasa a su campo propio.
    else if (/^[1-5]\d\d$/.test(clean)) updateEdge(edge.id, { status: Number(clean), when: legacyCode ? '' : undefined });
  }

  return (
    <>
      <section className="panel-section" aria-label="Respuesta">
        <h4>Respuesta</h4>
        <div className="panel-field">
          <label htmlFor={requestId}>Solicitud asociada</label>
          <select id={requestId} value={edge.replyTo ?? ''} onChange={(e) => updateEdge(edge.id, { replyTo: e.target.value || null })}>
            <option value="">Sin vincular</option>
            {mirrored.map((r) => (
              <option key={r.id} value={r.id}>
                {describe(r)}
              </option>
            ))}
            {others.length > 0 && (
              <optgroup label="Otras solicitudes del lienzo">
                {others.map((r) => (
                  <option key={r.id} value={r.id}>
                    {describe(r)}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          {edge.replyTo && onSelect && (
            <button type="button" className="link-button" onClick={() => onSelect({ edgeId: edge.replyTo })}>
              Ir a la solicitud
            </button>
          )}
        </div>
        <div className="panel-field">
          <label htmlFor={statusId}>Código HTTP</label>
          <input
            id={statusId}
            className="mono edge-status-input"
            inputMode="numeric"
            maxLength={3}
            placeholder="200"
            list={codesId}
            value={draft}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? `${statusId}-error` : undefined}
            onChange={(e) => setStatus(e.target.value)}
            onBlur={() => setDraft(status === undefined ? '' : String(status))}
          />
          <datalist id={codesId}>
            {(contract?.responses ?? []).map((r) => (
              <option key={r.status} value={r.status}>
                {r.description}
              </option>
            ))}
          </datalist>
          {invalid && (
            <span id={`${statusId}-error`} role="alert" className="panel-error">
              Un código HTTP va de 100 a 599.
            </span>
          )}
          {documented?.description && <span className="edge-contract">En el contrato: {documented.description}</span>}
        </div>
        <TextField
          label="Qué ocurre después"
          multiline
          value={edge.outcome ?? ''}
          maxLength={OUTCOME_MAX_LENGTH}
          placeholder="Ej. se muestra la confirmación y se navega al inicio"
          onChange={(outcome) => updateEdge(edge.id, { outcome })}
        />
      </section>
      <ExampleSection edge={edge} title="Ejemplo de respuesta" />
      {edge.when && !legacyCode && <ConditionSection edge={edge} />}
    </>
  );
}

/** Acceso a datos: operación y entidades (lectura o escritura). */
function DataSection({ edge }: { edge: Edge }) {
  const updateEdge = useGraphStore((s) => s.updateEdge);
  const [data, setData] = useDraft<EdgeData>(edge.data, normalizeEdgeData, (next) => updateEdge(edge.id, { data: next ?? null }), {});
  const operationId = useId();
  const entitiesId = useId();
  const implied = edge.kind === 'reads' ? 'read' : edge.kind === 'writes' ? 'write' : undefined;

  return (
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
            <option value="">{implied ? `${DATA_OPERATION_LABELS[implied]} (por el tipo)` : '—'}</option>
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
      <ExampleField edge={edge} label="Ejemplo de payload" />
    </section>
  );
}

function ExampleField({ edge, label }: { edge: Edge; label: string }) {
  const updateEdge = useGraphStore((s) => s.updateEdge);
  return (
    <TextField
      label={label}
      multiline
      value={edge.example ?? ''}
      maxLength={EXAMPLE_MAX_LENGTH}
      placeholder='{ "cuenta": "001-123" }'
      onChange={(example) => updateEdge(edge.id, { example })}
    />
  );
}

/** Ejemplo propio de este intercambio (opcional, plegado si está vacío). */
function ExampleSection({ edge, title }: { edge: Edge; title: string }) {
  return (
    <Section title={title} defaultOpen={!!edge.example}>
      <ExampleField edge={edge} label={title} />
    </Section>
  );
}

/** Condición que activa la conexión (opcional). El código de una respuesta tiene su campo propio. */
function ConditionSection({ edge }: { edge: Edge }) {
  const updateEdge = useGraphStore((s) => s.updateEdge);
  return (
    <Section title="Condición" defaultOpen={!!edge.when}>
      <TextField
        label="Condición"
        placeholder="Cuándo ocurre, ej. saldo insuficiente"
        value={edge.when ?? ''}
        maxLength={EDGE_TEXT_MAX_LENGTH}
        onChange={(when) => updateEdge(edge.id, { when })}
      />
    </Section>
  );
}
