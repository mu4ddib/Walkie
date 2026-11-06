import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiStatus } from './ApiStatus';

function renderWithQuery() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ApiStatus />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('ApiStatus', () => {
  it('muestra ok cuando la API responde', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'ok', schemaVersion: 0 }), { status: 200 })),
    );
    renderWithQuery();
    expect(await screen.findByText('API ok')).toHaveAttribute('data-state', 'ok');
  });

  it('avisa cuando la API no responde', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    renderWithQuery();
    expect(await screen.findByText('API sin conexión')).toHaveAttribute('data-state', 'error');
  });
});
