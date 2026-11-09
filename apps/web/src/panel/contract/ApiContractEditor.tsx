import { useId } from 'react';
import type { Http } from '../../schema/walkie-graph';
import {
  AUTH_LABELS,
  AUTH_TYPES,
  LIMITS,
  PARAM_LABELS,
  PARAM_PLACES,
  normalizeHttp,
  type HttpBody,
  type HttpResponse,
} from '../../contracts/contracts';
import { FieldsEditor } from './FieldsEditor';
import { removeAt, replaceAt } from './lists';
import { AddButton, Check, Choice, Field, Row, Section } from './rows';
import { useDraft } from './useDraft';

/**
 * Contrato de una API (spec espacio-de-trabajo, criterio 13): autenticación, parámetros, request y respuestas con
 * códigos y errores. Método y ruta van aparte, arriba. Sirve para un nodo y para la definición del catálogo.
 */
export function ApiContractEditor({ value, onChange }: { value: Http | undefined; onChange: (http: Http | undefined) => void }) {
  const [http, set] = useDraft(value, normalizeHttp, onChange, {});
  const params = http.params ?? [];
  const responses = http.responses ?? [];
  const request = http.request ?? {};
  const errors = responses.filter((r) => r.status >= 400).length;

  return (
    <div className="contract" aria-label="Contrato de la API" role="group">
      <Section title="Autenticación" count={http.auth ? AUTH_LABELS[http.auth.type] : undefined} defaultOpen={!!http.auth}>
        <Choice
          label="Tipo de autenticación"
          value={http.auth?.type}
          options={AUTH_TYPES}
          labels={AUTH_LABELS}
          empty="Sin documentar"
          onChange={(type) => set({ ...http, auth: type ? { ...http.auth, type } : undefined })}
        />
        {http.auth && (
          <Field
            label="Detalle de la autenticación"
            wide
            value={http.auth.description}
            maxLength={LIMITS.short}
            placeholder="Token del canal en Authorization"
            onChange={(description) => set({ ...http, auth: { ...http.auth!, description } })}
          />
        )}
      </Section>

      <Section title="Parámetros" count={params.length ? String(params.length) : undefined} defaultOpen={params.length > 0}>
        {params.map((p, i) => (
          <Row key={i} label={`parámetro ${p.name || i + 1}`} onRemove={() => set({ ...http, params: removeAt(params, i) })}>
            <Field
              label="Nombre"
              value={p.name}
              maxLength={LIMITS.name}
              onChange={(name) => set({ ...http, params: replaceAt(params, i, { ...p, name }) })}
            />
            <Choice
              label="Dónde"
              value={p.in}
              options={PARAM_PLACES}
              labels={PARAM_LABELS}
              onChange={(where) => set({ ...http, params: replaceAt(params, i, { ...p, in: where ?? 'query' }) })}
            />
            <Field
              label="Tipo"
              mono
              value={p.type}
              maxLength={LIMITS.type}
              placeholder="string"
              onChange={(type) => set({ ...http, params: replaceAt(params, i, { ...p, type }) })}
            />
            <Check
              label="Obligatorio"
              checked={!!p.required}
              onChange={(required) => set({ ...http, params: replaceAt(params, i, { ...p, required }) })}
            />
            <Field
              label="Descripción"
              wide
              value={p.description}
              maxLength={LIMITS.short}
              onChange={(description) => set({ ...http, params: replaceAt(params, i, { ...p, description }) })}
            />
            <Field
              label="Ejemplo"
              wide
              mono
              value={p.example}
              maxLength={LIMITS.short}
              onChange={(example) => set({ ...http, params: replaceAt(params, i, { ...p, example }) })}
            />
          </Row>
        ))}
        <AddButton label="Parámetro" onClick={() => set({ ...http, params: [...params, { name: '', in: 'query' }] })} />
      </Section>

      <Section
        title="Request"
        count={request.fields?.length ? (request.fields.length === 1 ? '1 campo' : `${request.fields.length} campos`) : undefined}
        defaultOpen={!!http.request}
      >
        <BodyEditor owner="request" body={request} onChange={(next) => set({ ...http, request: next })} />
      </Section>

      <Section
        title="Respuestas"
        count={responses.length ? `${responses.length}${errors ? ` · ${errors} error${errors === 1 ? '' : 'es'}` : ''}` : undefined}
        defaultOpen={responses.length > 0}
      >
        {responses.map((r, i) => (
          <ResponseEditor
            key={i}
            response={r}
            onChange={(next) => set({ ...http, responses: replaceAt(responses, i, next) })}
            onRemove={() => set({ ...http, responses: removeAt(responses, i) })}
          />
        ))}
        <AddButton
          label="Respuesta"
          onClick={() => set({ ...http, responses: [...responses, { status: responses.length === 0 ? 200 : 400 }] })}
        />
      </Section>
    </div>
  );
}

function BodyEditor({ owner, body, onChange }: { owner: string; body: HttpBody; onChange: (body: HttpBody) => void }) {
  return (
    <>
      <Field
        label="Content-Type"
        mono
        wide
        value={body.contentType}
        maxLength={LIMITS.contentType}
        placeholder="application/json"
        onChange={(contentType) => onChange({ ...body, contentType })}
      />
      <FieldsEditor owner={owner} fields={body.fields ?? []} onChange={(fields) => onChange({ ...body, fields })} />
      <Field
        label={`Ejemplo de ${owner}`}
        wide
        mono
        multiline
        value={body.example}
        maxLength={LIMITS.example}
        placeholder='{ "monto": 1000 }'
        onChange={(example) => onChange({ ...body, example })}
      />
    </>
  );
}

function ResponseEditor({
  response,
  onChange,
  onRemove,
}: {
  response: HttpResponse;
  onChange: (response: HttpResponse) => void;
  onRemove: () => void;
}) {
  const owner = `respuesta ${response.status}`;
  const statusId = useId();
  return (
    <fieldset className="contract-response" data-error={response.status >= 400 || undefined}>
      <legend>
        <span className="contract-status">{response.status}</span>
        {response.status >= 400 ? 'Error' : 'Respuesta'}
      </legend>
      <div className="contract-grid">
        <div className="contract-field">
          <label htmlFor={statusId}>Código</label>
          <input
            id={statusId}
            type="number"
            min={100}
            max={599}
            value={response.status}
            onChange={(e) => onChange({ ...response, status: Number(e.target.value) })}
          />
        </div>
        <Field
          label="Significado"
          value={response.description}
          maxLength={LIMITS.short}
          placeholder={response.status >= 400 ? 'Cuándo ocurre' : 'Creada'}
          onChange={(description) => onChange({ ...response, description })}
        />
      </div>
      <BodyEditor owner={owner} body={response} onChange={(body) => onChange({ ...response, ...body })} />
      <button type="button" className="pixel-button is-ghost contract-add" onClick={onRemove}>
        Quitar {owner}
      </button>
    </fieldset>
  );
}
