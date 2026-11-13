import { useId } from 'react';
import {
  LIMITS,
  normalizeExchange,
  type EdgeExchange,
} from '../contracts/contracts';
import { responseStatus, statusTone } from '../edges/edgeMeta';
import { useChangeEdgeKind, useSetOperation } from '../edges/useChangeEdgeKind';
import {
  OPERATIONS,
  OPERATION_GROUPS,
  OPERATION_IDS,
  PATTERN_LABELS,
  RESULT_LABELS,
  TECHNOLOGIES,
  accessOperation,
  correlatedWith,
  effectiveOperation,
  operationConflict,
  operationName,
  patternOf,
  returnsOf,
  returnsOfEdge,
  suggestOperations,
  type Family,
  type OperationId,
  type Pattern,
  type ResultType,
} from '../interactions/operations';
import { grpcIssues, sqlIssues } from '../interactions/syntax';
import type { Edge, Field as SchemaField } from '../schema/walkie-graph';
import { EDGE_TEXT_MAX_LENGTH } from '../store/graphStore';
import { useGraphStore } from '../store/useGraphStore';
import { TextField } from './TextField';
import { FieldsEditor } from './contract/FieldsEditor';
import { removeAt, replaceAt } from './contract/lists';
import { AddButton, Check, Choice, Field, Row, Section } from './contract/rows';
import { useDraft } from './contract/useDraft';

type Select = (target: { nodeId?: string; edgeId?: string }) => void;

/** Valor del selector que convierte la conexión en el retorno de otra operación. */
const AS_RETURN = '__return';

const COMMAND_LANGUAGES = ['sql', 'procedure', 'command', 'orm', 'text'] as const;
const COMMAND_LABELS: Record<(typeof COMMAND_LANGUAGES)[number], string> = {
  sql: 'SQL',
  procedure: 'Procedimiento',
  command: 'Comando',
  orm: 'ORM',
  text: 'Descripción',
};
const ACKS = ['broker', 'consumer'] as const;

/**
 * Operación de la conexión (spec interacciones, ADR-0011): la única fuente de verdad del verbo, los retornos y las
 * secciones del inspector. Primero las sugeridas para el par; una conexión anterior sin operación se interpreta por su
 * tipo y lo dice. Si su tipo y su acceso a datos se contradicen, lo señala y deja elegir.
 */
export function OperationField({
  edge,
  fromFamily,
  toFamily,
  onReversed,
}: {
  edge: Edge;
  fromFamily: Family;
  toFamily: Family;
  /** El cambio a retorno invirtió el sentido. */
  onReversed: (reversed: boolean) => void;
}) {
  const updateEdge = useGraphStore((s) => s.updateEdge);
  const setOperation = useSetOperation();
  const changeKind = useChangeEdgeKind();
  const selectId = useId();
  const techId = useId();
  const techList = useId();
  const effective = effectiveOperation(edge, fromFamily, toFamily);
  const suggested = suggestOperations(fromFamily, toFamily);
  const conflict = operationConflict(edge, fromFamily, toFamily);
  const op = effective?.id;
  const profile = op ? OPERATIONS[op] : undefined;
  const pattern = op ? patternOf(edge, op) : undefined;
  const others = OPERATION_IDS.filter((id) => !suggested.includes(id));

  function choose(value: string) {
    if (value === AS_RETURN) onReversed(changeKind(edge.id, 'response'));
    else if (value === '') updateEdge(edge.id, { operation: null, pattern: null, customOperation: '' });
    else {
      const next = value as OperationId;
      // El patrón anterior se conserva solo si la operación nueva lo admite.
      const keep = edge.pattern && OPERATIONS[next].patterns.includes(edge.pattern) ? edge.pattern : undefined;
      setOperation(edge.id, next, keep);
      if (!keep && edge.pattern) updateEdge(edge.id, { pattern: null });
    }
  }

  return (
    <section className="panel-section" aria-label="Interacción">
      <div className="panel-field">
        <label htmlFor={selectId}>Operación</label>
        <select id={selectId} value={edge.operation ?? ''} onChange={(e) => choose(e.target.value)}>
          {!edge.operation && (
            <option value="">{effective ? `Según el tipo: ${OPERATIONS[effective.id].name}` : '—'}</option>
          )}
          <optgroup label="Sugeridas">
            {suggested.map((id) => (
              <option key={id} value={id}>
                {OPERATIONS[id].name}
              </option>
            ))}
          </optgroup>
          {OPERATION_GROUPS.map((group) => {
            const ids = others.filter((id) => OPERATIONS[id].group === group);
            return ids.length ? (
              <optgroup key={group} label={group}>
                {ids.map((id) => (
                  <option key={id} value={id}>
                    {OPERATIONS[id].name}
                  </option>
                ))}
              </optgroup>
            ) : null;
          })}
          <optgroup label="Retorno">
            <option value={AS_RETURN}>Es el retorno de otra operación</option>
          </optgroup>
        </select>
        {effective && !effective.explicit && (
          <span className="panel-help">Conexión anterior: se interpreta por su tipo. Elige la operación para fijarla.</span>
        )}
      </div>

      {conflict && (
        <div className="edge-review" role="alert">
          <strong>Necesita revisión.</strong> El tipo dice «{conflict.kindSays === 'read' ? 'lee' : 'escribe'}» y el acceso a
          datos dice «{conflict.dataSays === 'read' ? 'lee' : 'escribe'}». ¿Cuál es la operación?
          <div className="edge-review-actions">
            {(['read', 'write'] as const).map((access) => {
              const id = accessOperation(access, toFamily);
              return (
                <button key={access} type="button" className="pixel-button" onClick={() => setOperation(edge.id, id)}>
                  {OPERATIONS[id].name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {op === 'custom' && (
        <TextField
          label="Nombre de la operación"
          value={edge.customOperation ?? ''}
          maxLength={60}
          placeholder="Ej. Conciliar"
          onChange={(customOperation) => updateEdge(edge.id, { customOperation })}
        />
      )}

      {profile && profile.patterns.length > 1 && (
        <Choice
          label="Patrón"
          value={pattern}
          options={profile.patterns}
          labels={PATTERN_LABELS}
          onChange={(next) => (edge.operation ? setOperation(edge.id, edge.operation, next as Pattern) : op && setOperation(edge.id, op, next as Pattern))}
        />
      )}

      <div className="panel-field">
        <label htmlFor={techId}>Tecnología</label>
        <input
          id={techId}
          list={techList}
          value={edge.technology ?? ''}
          maxLength={60}
          placeholder={TECHNOLOGIES[toFamily][0] ?? TECHNOLOGIES[fromFamily][0] ?? 'Opcional'}
          onChange={(e) => updateEdge(edge.id, { technology: e.target.value })}
        />
        <datalist id={techList}>
          {[...new Set([...TECHNOLOGIES[toFamily], ...TECHNOLOGIES[fromFamily]])].map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </div>
    </section>
  );
}

/**
 * Detalle técnico del intercambio según el perfil de la operación (comando, parámetros, entidades, contrato del
 * resultado, errores, timeout y reintentos, gRPC, mensajería y correlación), todo en secciones plegables.
 */
export function ExchangeSections({
  edge,
  operation,
  tables,
  onSelect,
}: {
  edge: Edge;
  operation: OperationId;
  /** Tablas o colecciones documentadas en la base de destino (sugerencias de entidades). */
  tables?: string[];
  onSelect?: Select;
}) {
  const updateEdge = useGraphStore((s) => s.updateEdge);
  const edges = useGraphStore((s) => s.edges);
  const nodes = useGraphStore((s) => s.nodes);
  const [x, setX] = useDraft<EdgeExchange>(edge.exchange, normalizeExchange, (next) => updateEdge(edge.id, { exchange: next ?? null }), {});
  const entitiesList = useId();
  const correlationId = useId();
  const sections = new Set(OPERATIONS[operation].sections);
  const params = x.params ?? [];
  const errors = x.errors ?? [];
  const has = (...values: unknown[]) => values.some((v) => (Array.isArray(v) ? v.length > 0 : v !== undefined && v !== ''));

  // Respuesta asíncrona: la operación original (cualquier conexión que no sea un retorno ni esta).
  const candidates = Object.values(edges).filter((e) => e.id !== edge.id && e.kind !== 'response' && e.kind !== 'navigation');
  const describe = (e: Edge) => `${nodes[e.from]?.title ?? '—'} → ${nodes[e.to]?.title ?? '—'}${e.label ? ` · ${e.label}` : ''}`;

  return (
    <>
      <Section title="Descripción del intercambio" defaultOpen={!!x.description}>
        <Field label="Qué hace" wide multiline value={x.description} maxLength={2000} onChange={(description) => setX({ ...x, description })} />
      </Section>

      {sections.has('command') && (
        <Section title="Comando o query" defaultOpen={!!x.command?.text}>
          <Choice
            label="Lenguaje"
            value={x.command?.language ?? 'sql'}
            options={COMMAND_LANGUAGES}
            labels={COMMAND_LABELS}
            onChange={(language) => setX({ ...x, command: { language: language ?? 'sql', text: x.command?.text ?? '' } })}
          />
          <Field
            label="Comando"
            wide
            multiline
            mono
            value={x.command?.text}
            maxLength={10000}
            placeholder="SELECT saldo FROM cuentas WHERE id = :cuenta"
            onChange={(text) => setX({ ...x, command: { language: x.command?.language ?? 'sql', text } })}
          />
          <SyntaxNotes
            issues={sqlIssues(
              x.command?.text ?? '',
              x.command?.language ?? 'sql',
              params.map((p) => p.name),
            )}
          />
        </Section>
      )}

      {sections.has('grpc') && (
        <Section title="gRPC" defaultOpen={has(x.grpc?.service, x.grpc?.method)}>
          <div className="contract-grid">
            <Field label="Servicio gRPC" mono value={x.grpc?.service} maxLength={200} placeholder="cuentas.v1.Cuentas" onChange={(service) => setX({ ...x, grpc: { ...x.grpc, service } })} />
            <Field label="Método gRPC" mono value={x.grpc?.method} maxLength={200} placeholder="ObtenerSaldo" onChange={(method) => setX({ ...x, grpc: { ...x.grpc, method } })} />
          </div>
          <SyntaxNotes issues={grpcIssues(x.grpc?.service, x.grpc?.method)} />
        </Section>
      )}

      {sections.has('params') && (
        <Section title="Parámetros" count={params.length ? String(params.length) : undefined} defaultOpen={params.length > 0}>
          {params.map((p, i) => (
            <Row key={i} label={`parámetro ${p.name || i + 1}`} onRemove={() => setX({ ...x, params: removeAt(params, i) })}>
              <Field label="Nombre" value={p.name} maxLength={LIMITS.name} onChange={(name) => setX({ ...x, params: replaceAt(params, i, { ...p, name }) })} />
              <Field label="Tipo" mono value={p.type} maxLength={LIMITS.name} placeholder="string" onChange={(type) => setX({ ...x, params: replaceAt(params, i, { ...p, type }) })} />
              <Field label="Ejemplo" wide mono value={p.example} maxLength={LIMITS.short} onChange={(example) => setX({ ...x, params: replaceAt(params, i, { ...p, example }) })} />
            </Row>
          ))}
          <AddButton label="Parámetro" onClick={() => setX({ ...x, params: [...params, { name: '' }] })} />
        </Section>
      )}

      {sections.has('entities') && (
        <Section title="Entidades" count={x.entities?.length ? String(x.entities.length) : undefined} defaultOpen={!!x.entities?.length}>
          <div className="contract-field is-wide">
            <label htmlFor={`${entitiesList}-input`}>Tablas o entidades</label>
            <input
              id={`${entitiesList}-input`}
              list={entitiesList}
              value={x.entities?.join(', ') ?? ''}
              maxLength={LIMITS.short * 4}
              placeholder="cuentas, movimientos"
              onChange={(e) => setX({ ...x, entities: e.target.value.split(',').map((s) => s.trimStart()) })}
            />
            <datalist id={entitiesList}>
              {(tables ?? []).map((t) => (
                <option key={t} value={[...(x.entities ?? []).slice(0, -1), t].join(', ')} />
              ))}
            </datalist>
          </div>
        </Section>
      )}

      {sections.has('result') && (
        <Section title="Contrato del resultado" count={x.result?.fields?.length ? String(x.result.fields.length) : undefined} defaultOpen={has(x.result?.description, x.result?.fields)}>
          <Field label="Qué devuelve" wide value={x.result?.description} maxLength={500} placeholder="Saldo disponible de la cuenta" onChange={(description) => setX({ ...x, result: { ...x.result, description } })} />
          <FieldsEditor owner="resultado" fields={(x.result?.fields ?? []) as SchemaField[]} onChange={(fields) => setX({ ...x, result: { ...x.result, fields } })} />
          <Field label="Ejemplo del resultado" wide multiline mono value={x.result?.example} maxLength={4000} onChange={(example) => setX({ ...x, result: { ...x.result, example } })} />
        </Section>
      )}

      {sections.has('errors') && (
        <Section title="Errores" count={errors.length ? String(errors.length) : undefined} defaultOpen={errors.length > 0}>
          {errors.map((er, i) => (
            <Row key={i} label={`error ${er.code || i + 1}`} onRemove={() => setX({ ...x, errors: removeAt(errors, i) })}>
              <Field label="Código" mono value={er.code} maxLength={60} placeholder="ORA-00001" onChange={(code) => setX({ ...x, errors: replaceAt(errors, i, { ...er, code }) })} />
              <Field label="Descripción" wide value={er.description} maxLength={500} onChange={(description) => setX({ ...x, errors: replaceAt(errors, i, { ...er, description }) })} />
            </Row>
          ))}
          <AddButton label="Error" onClick={() => setX({ ...x, errors: [...errors, { code: '' }] })} />
        </Section>
      )}

      {sections.has('policy') && (
        <Section title="Timeout y reintentos" defaultOpen={has(x.timeoutMs, x.retry, x.retries)}>
          <div className="contract-grid">
            <Field
              label="Timeout (ms)"
              mono
              value={x.timeoutMs === undefined ? '' : String(x.timeoutMs)}
              maxLength={7}
              placeholder="3000"
              onChange={(v) => {
                const n = Number(v.replace(/\D/g, ''));
                setX({ ...x, timeoutMs: v.trim() && n > 0 ? n : undefined });
              }}
            />
            <Field
              label="Reintentos (cantidad)"
              mono
              value={x.retries === undefined ? '' : String(x.retries)}
              maxLength={2}
              placeholder="0"
              onChange={(v) => {
                const n = Number(v.replace(/\D/g, ''));
                setX({ ...x, retries: v.trim() && Number.isFinite(n) ? Math.min(n, 10) : undefined });
              }}
            />
            <Field label="Política de reintentos" wide value={x.retry} maxLength={500} placeholder="Con espera exponencial" onChange={(retry) => setX({ ...x, retry })} />
          </div>
        </Section>
      )}

      {sections.has('messaging') && (
        <Section title="Mensajería" defaultOpen={has(x.channel, x.message, x.correlationKey, x.replyChannel, x.acks)}>
          <div className="contract-grid">
            <Field label="Canal (cola o tópico)" mono value={x.channel} maxLength={200} placeholder="pagos.solicitados" onChange={(channel) => setX({ ...x, channel })} />
            <Field label="Mensaje" value={x.message} maxLength={200} placeholder="PagoSolicitado" onChange={(message) => setX({ ...x, message })} />
            <Field label="Clave de correlación" mono value={x.correlationKey} maxLength={200} placeholder="pagoId" onChange={(correlationKey) => setX({ ...x, correlationKey })} />
            <Field label="Canal de respuesta" mono value={x.replyChannel} maxLength={200} placeholder="pagos.resultado" onChange={(replyChannel) => setX({ ...x, replyChannel })} />
          </div>
          <fieldset className="edge-acks">
            <legend>Confirmaciones esperadas</legend>
            {ACKS.map((ack) => (
              <Check
                key={ack}
                label={ack === 'broker' ? 'Del broker' : 'Del consumidor'}
                checked={!!(x.acks as readonly string[] | undefined)?.includes(ack)}
                onChange={(on) => {
                  const current: (typeof ACKS)[number][] = [...(x.acks ?? [])];
                  const acks = on ? [...current, ack] : current.filter((a) => a !== ack);
                  setX({ ...x, acks: acks as EdgeExchange['acks'] });
                }}
              />
            ))}
          </fieldset>
        </Section>
      )}

      {sections.has('correlation') && (
        <section className="panel-section" aria-label="Correlación">
          <h4>Responde a</h4>
          <div className="panel-field">
            <label htmlFor={correlationId}>Operación original</label>
            <select id={correlationId} value={edge.correlatesWith ?? ''} onChange={(e) => updateEdge(edge.id, { correlatesWith: e.target.value || null })}>
              <option value="">Sin correlacionar</option>
              {candidates.map((e) => (
                <option key={e.id} value={e.id}>
                  {describe(e)}
                </option>
              ))}
            </select>
            {edge.correlatesWith && onSelect && (
              <button type="button" className="link-button" onClick={() => onSelect({ edgeId: edge.correlatesWith })}>
                Ir a la operación original
              </button>
            )}
          </div>
        </section>
      )}
    </>
  );
}

/** Avisos de sintaxis (no bloquean): lo que conviene revisar de un query o de un nombre de gRPC. */
function SyntaxNotes({ issues }: { issues: string[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="edge-syntax" aria-label="Revisar la sintaxis">
      {issues.map((issue) => (
        <li key={issue}>{issue}</li>
      ))}
    </ul>
  );
}

/**
 * Retornos de una operación: resultados, respuestas, confirmaciones o mensajes de un flujo, según el intercambio. Se
 * crean en sentido inverso vinculados por `replyTo`; varios son escenarios alternativos (salvo los de un stream).
 */
export function ReturnsSection({
  edge,
  operation,
  pattern,
  documented,
  onSelect,
}: {
  edge: Edge;
  operation: OperationId;
  pattern: Pattern;
  /** Códigos HTTP documentados en el contrato del destino (solo HTTP). */
  documented?: number[];
  onSelect?: Select;
}) {
  const addResponse = useGraphStore((s) => s.addResponse);
  const edges = useGraphStore((s) => s.edges);
  const profile = returnsOf(operation, pattern);
  const returns = returnsOfEdge(edges, edge.id);
  const replies = correlatedWith(edges, edge.id);
  if (!profile && returns.length === 0 && replies.length === 0) return null;
  const http = operation === 'http.request';
  const used = new Set(returns.map((r) => responseStatus(r)));
  const codes = (documented ?? []).filter((s) => !used.has(s));
  const usedTypes = new Set(returns.map((r) => r.result?.type));

  function add(init: { status?: number; result?: Edge['result']; stream?: boolean }) {
    const id = addResponse(edge.id, init);
    if (id) onSelect?.({ edgeId: id });
  }

  return (
    <section className="panel-section" aria-label="Retornos">
      <h4>{http ? 'Respuestas' : 'Retornos'}</h4>
      {returns.length > 0 && (
        <ul className="edge-links">
          {returns.map((r) => {
            const code = responseStatus(r);
            return (
              <li key={r.id}>
                <button type="button" className="edge-link" onClick={() => onSelect?.({ edgeId: r.id })} disabled={!onSelect}>
                  {code !== undefined ? (
                    <span className="kind-edge-code" data-tone={statusTone(code)}>
                      {code}
                    </span>
                  ) : r.result ? (
                    <span className="edge-link-type" data-error={r.result.type === 'error' || r.result.type === 'nack' || undefined}>
                      {RESULT_LABELS[r.result.type]}
                      {r.result.code ? ` ${r.result.code}` : ''}
                    </span>
                  ) : (
                    <span className="edge-link-muted">sin tipo</span>
                  )}
                  <span>{r.label ?? r.outcome ?? r.result?.description ?? (r.stream ? 'Mensaje del flujo' : 'Retorno')}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {returns.length > 1 && !returns.every((r) => r.stream) && (
        <p className="panel-help">Son escenarios alternativos: al previsualizar eliges cuál ocurre.</p>
      )}
      {profile && (
        <div className="edge-add-responses">
          <button
            type="button"
            className="pixel-button"
            data-tip="Crea el retorno en sentido inverso, vinculado a esta operación"
            onClick={() => add(http ? {} : { result: { type: profile.types[0]! }, stream: pattern === 'stream' || undefined })}
          >
            + {profile.action}
          </button>
          {http &&
            codes.slice(0, 6).map((status) => (
              <button
                key={status}
                type="button"
                className="pixel-button is-ghost"
                aria-label={`Añadir respuesta ${status}`}
                data-tip="Código documentado en el contrato"
                onClick={() => add({ status })}
              >
                + {status}
              </button>
            ))}
          {!http &&
            profile.types.slice(1).map((type: ResultType) => (
              <button
                key={type}
                type="button"
                className="pixel-button is-ghost"
                aria-label={`Añadir retorno ${RESULT_LABELS[type]}`}
                disabled={usedTypes.has(type) && type !== 'message'}
                onClick={() => add({ result: { type }, stream: pattern === 'stream' || undefined })}
              >
                + {RESULT_LABELS[type]}
              </button>
            ))}
        </div>
      )}
      {replies.length > 0 && (
        <>
          <h5 className="edge-subtitle">Respuestas correlacionadas</h5>
          <ul className="edge-links">
            {replies.map((r) => (
              <li key={r.id}>
                <button type="button" className="edge-link" onClick={() => onSelect?.({ edgeId: r.id })} disabled={!onSelect}>
                  <span>{operationName(r) ?? r.label ?? 'Respuesta'}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/**
 * Retorno: la operación a la que responde (cualquier intercambio, no solo HTTP), su tipo y código, si es un mensaje de
 * un flujo, y qué ocurre después. El código HTTP sigue en su campo propio cuando la operación es HTTP.
 */
export function ReturnTypeFields({ edge, parent }: { edge: Edge; parent: Edge | undefined }) {
  const updateEdge = useGraphStore((s) => s.updateEdge);
  const parentOp = parent?.operation;
  const types: ResultType[] = parentOp ? (OPERATIONS[parentOp].returns?.types ?? []) : (Object.keys(RESULT_LABELS) as ResultType[]);
  const options = edge.result && !types.includes(edge.result.type) ? [edge.result.type, ...types] : types;
  const all = [...new Set<ResultType>([...options, 'error'])];
  const parentPattern = parentOp ? patternOf(parent, parentOp) : undefined;
  return (
    <>
      <Choice
        label="Tipo de retorno"
        value={edge.result?.type}
        options={all}
        labels={RESULT_LABELS}
        empty="Sin tipo"
        onChange={(type) => updateEdge(edge.id, { result: type ? { ...edge.result, type } : null })}
      />
      {edge.result && (
        <TextField
          label="Código del resultado"
          value={edge.result.code ?? ''}
          maxLength={60}
          placeholder="Ej. ORA-01403, NOT_FOUND"
          onChange={(code) => updateEdge(edge.id, { result: { ...edge.result!, code } })}
        />
      )}
      {edge.result && (
        <TextField
          label="Descripción del resultado"
          value={edge.result.description ?? ''}
          maxLength={EDGE_TEXT_MAX_LENGTH}
          placeholder="Ej. la cuenta no existe"
          onChange={(description) => updateEdge(edge.id, { result: { ...edge.result!, description } })}
        />
      )}
      {(parentPattern === 'stream' || edge.stream) && (
        <Check label="Mensaje de un flujo (secuencia, no alternativa)" checked={!!edge.stream} onChange={(stream) => updateEdge(edge.id, { stream })} />
      )}
    </>
  );
}
