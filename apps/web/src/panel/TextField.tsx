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
  /** Enfoca y selecciona el texto al montarse (ej. el nombre de un recorrido recién creado). */
  autoFocus?: boolean;
  /** Un área de texto que crece con lo escrito (desde unas pocas líneas) y se puede ampliar a mano. */
  autoGrow?: boolean;
  /** Etiqueta solo para lectores de pantalla (el campo se explica por su lugar, ej. el nombre en una cabecera). */
  labelHidden?: boolean;
  /** Clase extra del campo (input o textarea). */
  inputClassName?: string;
}

/**
 * Campo de texto con borrador local: el store recorta espacios, así que el campo guarda lo que
 * se escribe (con el espacio final) y solo se reemplaza si el valor del store cambia por otra vía.
 */
export function TextField({
  label,
  value,
  maxLength,
  multiline,
  placeholder,
  onChange,
  validate,
  autoFocus,
  autoGrow,
  labelHidden,
  inputClassName,
}: TextFieldProps) {
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
    autoFocus,
    className: [autoGrow ? 'is-autogrow' : '', inputClassName ?? ''].filter(Boolean).join(' ') || undefined,
    title: !multiline && draft.length > 30 ? draft : undefined,
    onFocus: autoFocus ? (e: { target: { select: () => void } }) => e.target.select() : undefined,
  };

  return (
    <div className="panel-field">
      <label htmlFor={id} className={labelHidden ? 'sr-only' : undefined}>
        {label}
      </label>
      {multiline ? <textarea rows={autoGrow ? 3 : 4} {...props} /> : <input type="text" {...props} />}
      {error && (
        <span id={`${id}-error`} role="alert" className="panel-error">
          {error}
        </span>
      )}
    </div>
  );
}
