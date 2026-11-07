import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';

interface NameFormProps {
  label: string;
  submitLabel: string;
  pending: boolean;
  error: unknown;
  onSubmit: (name: string) => Promise<unknown>;
}

/** Formulario de un solo campo "nombre" (crear app o feature). Valida igual que la API. */
export function NameForm({ label, submitLabel, pending, error, onSubmit }: NameFormProps) {
  const [name, setName] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const clean = name.trim();
    if (clean.length === 0) {
      setLocalError('El nombre es obligatorio.');
      return;
    }
    setLocalError(null);
    try {
      await onSubmit(clean);
      setName('');
    } catch {
      // El error de la API llega por `error`.
    }
  }

  const message = localError ?? (error instanceof ApiError ? error.userMessage : error ? 'No se pudo guardar.' : null);

  return (
    <form className="name-form" onSubmit={(e) => void handleSubmit(e)}>
      <label>
        {label}
        <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} disabled={pending} />
      </label>
      <button type="submit" className="pixel-button" disabled={pending}>
        {submitLabel}
      </button>
      {message && <p role="alert">{message}</p>}
    </form>
  );
}
