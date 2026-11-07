import { useId, useState } from 'react';

interface TextFieldProps {
  label: string;
  value: string;
  maxLength: number;
  multiline?: boolean;
  placeholder?: string;
  /** Se llama en cada tecla: el nodo cambia al instante. El store recorta y valida. */
  onChange: (value: string) => void;
  /** Motivo por el que el borrador no sirve (se muestra y no se llama a `onChange`); `null` si sirve. */
  validate?: (value: string) => string | null;
}

/**
 * Campo de texto con borrador local: el store recorta espacios, así que el campo guarda lo que
 * se escribe (con el espacio final) y solo se reemplaza si el valor del store cambia por otra vía.
 */
export function TextField({ label, value, maxLength, multiline, placeholder, onChange, validate }: TextFieldProps) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (value !== draft.trim()) setDraft(value);
  }
  const error = validate?.(draft) ?? null;

  const props = {
    id,
    value: draft,
    maxLength,
    placeholder,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `${id}-error` : undefined,
    onChange: (e: { target: { value: string } }) => {
      setDraft(e.target.value);
      if (!validate?.(e.target.value)) onChange(e.target.value);
    },
    // Si el store rechazó el borrador (ej. título vacío), al salir se muestra el valor real.
    onBlur: () => setDraft(value),
  };

  return (
    <div className="panel-field">
      <label htmlFor={id}>{label}</label>
      {multiline ? <textarea rows={4} {...props} /> : <input type="text" {...props} />}
      {error && (
        <span id={`${id}-error`} role="alert" className="panel-error">
          {error}
        </span>
      )}
    </div>
  );
}
