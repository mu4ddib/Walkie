import type { Resource } from '../../schema/walkie-graph';
import {
  DETAIL_KEY_MAX_LENGTH,
  DETAIL_VALUE_MAX_LENGTH,
  PROVIDERS,
  RESOURCE_DETAILS_MAX,
  RESOURCE_KINDS,
  RESOURCE_LABEL_MAX_LENGTH,
  RESOURCE_NAME_MAX_LENGTH,
  normalizeResource,
  resourceKindMeta,
  type Provider,
  type ResourceKind,
} from '../../nodes/resourceMeta';
import { removeAt, replaceAt } from './lists';
import { AddButton, Choice, Field, Row, Section } from './rows';
import { useDraft } from './useDraft';

const KINDS = RESOURCE_KINDS.map((k) => k.kind);
const KIND_LABELS = Object.fromEntries(RESOURCE_KINDS.map((k) => [k.kind, k.label])) as Record<ResourceKind, string>;
const PROVIDER_IDS = PROVIDERS.map((p) => p.provider);
const PROVIDER_LABELS = Object.fromEntries(PROVIDERS.map((p) => [p.provider, p.label])) as Record<Provider, string>;

/**
 * Recurso de infraestructura (spec nodos-de-infraestructura): subtipo (y el nombre del personalizado), proveedor,
 * nombre en su plataforma y detalles clave/valor. Sirve para un nodo y para la definición del catálogo. Cambiar el
 * subtipo conserva lo demás; al pasar a personalizado, el nombre del subtipo anterior queda como el suyo.
 */
export function ResourceEditor({ value, onChange }: { value: Resource | undefined; onChange: (resource: Resource) => void }) {
  const [draft, set] = useDraft<Resource>(
    value,
    (d) => (d ? normalizeResource(d) : undefined),
    (next) => next && onChange(next),
    { kind: 'custom' },
  );
  const details = draft.details ?? [];

  const changeKind = (kind: ResourceKind | undefined) => {
    if (!kind) return;
    const previous = draft.kind === 'custom' ? draft.label : resourceKindMeta(draft.kind).label;
    set({ ...draft, kind, label: kind === 'custom' ? draft.label || previous : undefined });
  };

  return (
    <div className="contract" aria-label="Recurso" role="group">
      <div className="contract-grid">
        <Choice label="Subtipo" value={draft.kind} options={KINDS} labels={KIND_LABELS} onChange={changeKind} />
        {draft.kind === 'custom' && (
          <Field
            label="Nombre del subtipo"
            value={draft.label}
            maxLength={RESOURCE_LABEL_MAX_LENGTH}
            placeholder="Step Functions"
            onChange={(label) => set({ ...draft, label })}
          />
        )}
        <Choice
          label="Proveedor"
          value={draft.provider}
          options={PROVIDER_IDS}
          labels={PROVIDER_LABELS}
          empty="—"
          onChange={(provider) => set({ ...draft, provider })}
        />
        <Field
          label="Nombre del recurso"
          wide
          mono
          value={draft.name}
          maxLength={RESOURCE_NAME_MAX_LENGTH}
          placeholder="pagos-pendientes"
          onChange={(name) => set({ ...draft, name })}
        />
      </div>
      <Section title="Detalles" count={details.length ? String(details.length) : undefined} defaultOpen>
        <p className="panel-help">Configuración que importa al leer la arquitectura: retención, runtime, tamaño…</p>
        {details.map((d, i) => (
          <Row key={i} label={`detalle ${i + 1}`} onRemove={() => set({ ...draft, details: removeAt(details, i) })}>
            <Field
              label="Clave"
              value={d.key}
              maxLength={DETAIL_KEY_MAX_LENGTH}
              placeholder="retención"
              onChange={(key) => set({ ...draft, details: replaceAt(details, i, { ...d, key }) })}
            />
            <Field
              label="Valor"
              value={d.value}
              maxLength={DETAIL_VALUE_MAX_LENGTH}
              placeholder="4 días"
              onChange={(value) => set({ ...draft, details: replaceAt(details, i, { ...d, value }) })}
            />
          </Row>
        ))}
        {details.length < RESOURCE_DETAILS_MAX && (
          <AddButton label="Detalle" onClick={() => set({ ...draft, details: [...details, { key: '', value: '' }] })} />
        )}
      </Section>
    </div>
  );
}
