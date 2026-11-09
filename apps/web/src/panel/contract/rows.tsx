import { useId, useState, type ReactNode } from 'react';

/** Sección plegable del inspector (detalle progresivo): abierta si ya tiene contenido. */
export function Section({
  title,
  count,
  defaultOpen,
  children,
}: {
  title: string;
  count?: string;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  // Solo el estado inicial: después la abre o pliega la persona (si no, se plegaría al escribir).
  const [open] = useState(defaultOpen);
  return (
    <details className="contract-section" open={open || undefined}>
      <summary>
        {title}
        {count && <span className="contract-count">{count}</span>}
      </summary>
      <div className="contract-body">{children}</div>
    </details>
  );
}

/** Campo compacto con etiqueta visible. */
export function Field({
  label,
  value,
  onChange,
  maxLength,
  placeholder,
  mono,
  wide,
  multiline,
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string) => void;
  maxLength: number;
  placeholder?: string;
  mono?: boolean;
  wide?: boolean;
  multiline?: boolean;
}) {
  const id = useId();
  const props = {
    id,
    value: value ?? '',
    maxLength,
    placeholder,
    className: mono ? 'mono' : undefined,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
  };
  return (
    <div className={wide ? 'contract-field is-wide' : 'contract-field'}>
      <label htmlFor={id}>{label}</label>
      {multiline ? <textarea rows={4} spellCheck={false} {...props} /> : <input type="text" {...props} />}
    </div>
  );
}

export function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="contract-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function Choice<T extends string>({
  label,
  value,
  options,
  labels,
  onChange,
  empty,
}: {
  label: string;
  value: T | undefined;
  options: readonly T[];
  labels: Record<T, string>;
  onChange: (value: T | undefined) => void;
  /** Texto de la opción vacía; sin él, no se puede dejar vacío. */
  empty?: string;
}) {
  const id = useId();
  return (
    <div className="contract-field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value ?? ''} onChange={(e) => onChange((e.target.value || undefined) as T | undefined)}>
        {empty !== undefined && <option value="">{empty}</option>}
        {options.map((o) => (
          <option key={o} value={o}>
            {labels[o]}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Fila de una lista (parámetro, campo, respuesta, tabla…) con su botón para quitarla. */
export function Row({ label, onRemove, children }: { label: string; onRemove: () => void; children: ReactNode }) {
  return (
    <fieldset className="contract-row">
      <legend className="sr-only">{label}</legend>
      <div className="contract-grid">{children}</div>
      <button type="button" className="pixel-button is-ghost contract-remove" aria-label={`Quitar ${label}`} onClick={onRemove}>
        ✕
      </button>
    </fieldset>
  );
}

export function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="pixel-button is-ghost contract-add" onClick={onClick}>
      + {label}
    </button>
  );
}
