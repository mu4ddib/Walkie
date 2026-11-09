import type { Field as SchemaField } from '../../schema/walkie-graph';
import { LIMITS } from '../../contracts/contracts';
import { removeAt, replaceAt } from './lists';
import { AddButton, Check, Field, Row } from './rows';

/** Campos de un request o response: nombre, tipo, obligatorio, descripción y ejemplo. */
export function FieldsEditor({
  owner,
  fields,
  onChange,
}: {
  /** Para las etiquetas, ej. "request" o "respuesta 200". */
  owner: string;
  fields: SchemaField[];
  onChange: (fields: SchemaField[]) => void;
}) {
  return (
    <div className="contract-list" aria-label={`Campos de ${owner}`} role="group">
      {fields.map((f, i) => (
        <Row key={i} label={`campo ${f.name || i + 1} de ${owner}`} onRemove={() => onChange(removeAt(fields, i))}>
          <Field label="Campo" value={f.name} maxLength={LIMITS.name} onChange={(name) => onChange(replaceAt(fields, i, { ...f, name }))} />
          <Field
            label="Tipo"
            value={f.type}
            mono
            maxLength={LIMITS.type}
            placeholder="string"
            onChange={(type) => onChange(replaceAt(fields, i, { ...f, type }))}
          />
          <Check label="Obligatorio" checked={!!f.required} onChange={(required) => onChange(replaceAt(fields, i, { ...f, required }))} />
          <Field
            label="Descripción"
            wide
            value={f.description}
            maxLength={LIMITS.short}
            onChange={(description) => onChange(replaceAt(fields, i, { ...f, description }))}
          />
          <Field
            label="Ejemplo"
            wide
            mono
            value={f.example}
            maxLength={LIMITS.short}
            onChange={(example) => onChange(replaceAt(fields, i, { ...f, example }))}
          />
        </Row>
      ))}
      <AddButton label="Campo" onClick={() => onChange([...fields, { name: '' }])} />
    </div>
  );
}
