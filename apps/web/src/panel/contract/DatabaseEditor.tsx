import { useState } from 'react';
import type { Database } from '../../schema/walkie-graph';
import {
  KEY_LABELS,
  LIMITS,
  TABLE_KIND_LABELS,
  TABLE_KINDS,
  normalizeDatabase,
  splitList,
  type DbField,
  type DbTable,
} from '../../contracts/contracts';
import { removeAt, replaceAt } from './lists';
import { AddButton, Check, Choice, Field, Row, Section } from './rows';
import { useDraft } from './useDraft';

const KEYS = Object.keys(KEY_LABELS) as NonNullable<DbField['key']>[];

/**
 * Estructura de una base de datos (spec espacio-de-trabajo, criterio 14): motor, base, schemas y tablas o colecciones
 * con campos (tipo, clave, nulo) y relaciones. Sirve para un nodo y para la definición del catálogo.
 */
export function DatabaseEditor({
  value,
  onChange,
}: {
  value: Database | undefined;
  onChange: (database: Database | undefined) => void;
}) {
  const [db, set] = useDraft(value, normalizeDatabase, onChange, {});
  const tables = db.tables ?? [];

  return (
    <div className="contract" aria-label="Estructura de la base de datos" role="group">
      <div className="contract-grid">
        <Field label="Motor" value={db.engine} maxLength={LIMITS.type} placeholder="PostgreSQL" onChange={(engine) => set({ ...db, engine })} />
        <Field label="Base" value={db.name} maxLength={LIMITS.name} placeholder="core" onChange={(name) => set({ ...db, name })} />
        <Field
          label="Schemas"
          wide
          value={db.schemas?.join(',')}
          maxLength={1000}
          placeholder="pagos, clientes"
          onChange={(schemas) => set({ ...db, schemas: splitList(schemas) })}
        />
      </div>
      <Section title="Tablas" count={tables.length ? String(tables.length) : undefined} defaultOpen>
        {tables.map((t, i) => (
          <TableEditor
            key={i}
            table={t}
            index={i}
            onChange={(next) => set({ ...db, tables: replaceAt(tables, i, next) })}
            onRemove={() => set({ ...db, tables: removeAt(tables, i) })}
          />
        ))}
        <AddButton label="Tabla" onClick={() => set({ ...db, tables: [...tables, { name: '' }] })} />
      </Section>
    </div>
  );
}

function TableEditor({
  table,
  index,
  onChange,
  onRemove,
}: {
  table: DbTable;
  index: number;
  onChange: (table: DbTable) => void;
  onRemove: () => void;
}) {
  const name = table.name || `tabla ${index + 1}`;
  const fields = table.fields ?? [];
  const relations = table.relations ?? [];
  // Una tabla nueva empieza abierta y sigue así mientras se escribe su nombre.
  const [open] = useState(!table.name);
  return (
    <details className="contract-table" open={open || undefined}>
      <summary>
        <span className="mono">{name}</span>
        {fields.length > 0 && <span className="contract-count">{fields.length === 1 ? '1 campo' : `${fields.length} campos`}</span>}
      </summary>
      <div className="contract-grid">
        <Field label="Nombre" value={table.name} maxLength={LIMITS.name} onChange={(n) => onChange({ ...table, name: n })} />
        <Choice
          label="Clase"
          value={table.kind}
          options={TABLE_KINDS}
          labels={TABLE_KIND_LABELS}
          empty="—"
          onChange={(kind) => onChange({ ...table, kind })}
        />
        <Field label="Schema" value={table.schema} maxLength={LIMITS.name} onChange={(schema) => onChange({ ...table, schema })} />
        <Field
          label="Descripción"
          wide
          value={table.description}
          maxLength={LIMITS.short}
          onChange={(description) => onChange({ ...table, description })}
        />
      </div>
      <h5 className="contract-subtitle">Campos</h5>
      {fields.map((f, i) => (
        <Row key={i} label={`campo ${f.name || i + 1} de ${name}`} onRemove={() => onChange({ ...table, fields: removeAt(fields, i) })}>
          <Field label="Campo" value={f.name} maxLength={LIMITS.name} onChange={(n) => onChange({ ...table, fields: replaceAt(fields, i, { ...f, name: n }) })} />
          <Field
            label="Tipo"
            mono
            value={f.type}
            maxLength={LIMITS.type}
            placeholder="uuid"
            onChange={(type) => onChange({ ...table, fields: replaceAt(fields, i, { ...f, type }) })}
          />
          <Choice
            label="Clave"
            value={f.key}
            options={KEYS}
            labels={KEY_LABELS}
            empty="—"
            onChange={(key) => onChange({ ...table, fields: replaceAt(fields, i, { ...f, key }) })}
          />
          <Check
            label="Admite nulo"
            checked={!!f.nullable}
            onChange={(nullable) => onChange({ ...table, fields: replaceAt(fields, i, { ...f, nullable: nullable || undefined }) })}
          />
          <Field
            label="Descripción"
            wide
            value={f.description}
            maxLength={LIMITS.short}
            onChange={(description) => onChange({ ...table, fields: replaceAt(fields, i, { ...f, description }) })}
          />
        </Row>
      ))}
      <AddButton label="Campo" onClick={() => onChange({ ...table, fields: [...fields, { name: '' }] })} />
      <h5 className="contract-subtitle">Relaciones</h5>
      {relations.map((r, i) => (
        <Row key={i} label={`relación ${i + 1} de ${name}`} onRemove={() => onChange({ ...table, relations: removeAt(relations, i) })}>
          <Field
            label="Campo"
            value={r.field}
            maxLength={LIMITS.name}
            placeholder="cliente_id"
            onChange={(field) => onChange({ ...table, relations: replaceAt(relations, i, { ...r, field }) })}
          />
          <Field
            label="Referencia"
            mono
            value={r.references}
            maxLength={LIMITS.ref}
            placeholder="clientes.id"
            onChange={(references) => onChange({ ...table, relations: replaceAt(relations, i, { ...r, references }) })}
          />
        </Row>
      ))}
      <AddButton label="Relación" onClick={() => onChange({ ...table, relations: [...relations, { field: '', references: '' }] })} />
      <button type="button" className="pixel-button is-ghost contract-add" onClick={onRemove}>
        Quitar {name}
      </button>
    </details>
  );
}
