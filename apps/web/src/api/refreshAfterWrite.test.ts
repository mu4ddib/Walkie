import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { refreshAfterWrite } from './hooks';

/**
 * Carrera de los E2E intermitentes (catalogo.spec.ts, export-markdown.spec.ts): la primera carga de la lista
 * leyó la base antes de crear la app, pero responde después. Invalidar solo reutiliza ese fetch y la lista
 * queda sin la app nueva.
 */
function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const db = ['A'];
  const pending: (() => void)[] = [];
  // Cada fetch lee la "base" al empezar y responde cuando la prueba lo suelta.
  const queryFn = () => {
    const snapshot = [...db];
    return new Promise<string[]>((resolve) => pending.push(() => resolve(snapshot)));
  };
  const observer = new QueryObserver(queryClient, { queryKey: ['apps'], queryFn });
  const unsubscribe = observer.subscribe(() => {});
  return { queryClient, db, pending, unsubscribe };
}

describe('refreshAfterWrite', () => {
  it('con la primera carga en curso, invalidar solo deja la lista vieja (la trampa)', async () => {
    const { queryClient, db, pending, unsubscribe } = setup();
    db.push('B');
    const invalidated = queryClient.invalidateQueries({ queryKey: ['apps'] });
    pending.shift()!();
    await invalidated;

    expect(queryClient.getQueryData(['apps'])).toEqual(['A']);
    expect(pending).toHaveLength(0);
    unsubscribe();
  });

  it('cancela la carga en curso y vuelve a pedir: la lista trae lo creado', async () => {
    const { queryClient, db, pending, unsubscribe } = setup();
    db.push('B');
    let done = false;
    const refreshed = refreshAfterWrite(queryClient, { queryKey: ['apps'] }).then(() => (done = true));
    // Suelta cada respuesta en orden (la vieja y la nueva) hasta que termine.
    while (!done) {
      pending.shift()?.();
      await new Promise((r) => setTimeout(r, 0));
    }
    await refreshed;

    expect(queryClient.getQueryData(['apps'])).toEqual(['A', 'B']);
    unsubscribe();
  });
});
