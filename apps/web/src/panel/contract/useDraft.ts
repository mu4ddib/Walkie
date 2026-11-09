import { useState } from 'react';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Borrador local de una estructura (contrato, base de datos, lista): guarda lo que se escribe tal cual (con espacios
 * o filas aún sin nombre) y entrega la versión normalizada. Solo se reemplaza si el valor cambia por otra vía.
 */
export function useDraft<T>(
  value: T | undefined,
  normalize: (draft: T | undefined) => T | undefined,
  onChange: (next: T | undefined) => void,
  empty: T,
) {
  const [draft, setDraft] = useState<T>(value ?? empty);
  const [seen, setSeen] = useState(value);
  if (!same(value, seen)) {
    setSeen(value);
    if (!same(value, normalize(draft))) setDraft(value ?? empty);
  }
  const update = (next: T) => {
    setDraft(next);
    onChange(normalize(next));
  };
  return [draft, update] as const;
}
