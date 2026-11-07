import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useRoutes } from 'react-router';
import { routes } from '../routes';

function Routes() {
  return useRoutes(routes);
}

/** Renderiza las rutas reales de la app en `path`, con TanStack Query sin reintentos. */
export function renderRoute(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
