import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { SharedFeature } from '../api/client';
import { App } from '../App';
import type { CanvasCatalog } from '../catalog/catalogContext';
import type { GraphStore } from '../store/graphStore';
import { installFakeApi } from '../test/fakeApi';
import { formatDay } from './shareFormat';

// Sin sesión: si la ruta pasara por AuthGate, se vería "Iniciar sesión".
vi.mock('react-oidc-context', () => ({
  useAuth: () => ({ isLoading: false, isAuthenticated: false, user: null, signinRedirect: vi.fn() }),
}));
// React Flow no corre bien en jsdom: un lienzo mínimo que muestra lo que recibe.
vi.mock('../canvas/Canvas', () => ({
  Canvas: ({ store, catalog }: { store: StoreApi<GraphStore>; catalog: CanvasCatalog }) => {
    const nodes = useStore(store, (s) => s.nodes);
    return (
      <div aria-label="lienzo" data-share-token={catalog.share?.token} data-items={Object.keys(catalog.items).join(',')}>
        {Object.values(nodes).map((n) => (
          <span key={n.id}>{n.title}</span>
        ))}
      </div>
    );
  },
}));

const TOKEN = 'A'.repeat(43);
const shared: SharedFeature = {
  appName: 'Banca de prueba',
  featureName: 'Iniciar sesión',
  expiresAt: '2026-12-08T12:00:00Z',
  graph: {
    schemaVersion: 0,
    version: 4,
    nodes: {
      s1: { id: 's1', type: 'screen', title: 'Login' },
      c1: { id: 'c1', type: 'ref', title: 'Consultar cliente', catalogId: 'item-1' },
    },
    edges: {},
    layout: {},
  },
  catalog: [{ id: 'item-1', appId: 'app-1', type: 'api', title: 'Consultar cliente', version: 1 }],
};

afterEach(() => vi.unstubAllGlobals());

function renderApp(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('vista de un enlace (/s/:token)', () => {
  it('sin sesión muestra la app, la feature, la caducidad y el lienzo de solo lectura (criterio 5)', async () => {
    const api = installFakeApi({ shared: { [TOKEN]: shared } });

    renderApp(`/s/${TOKEN}`);

    expect(await screen.findByRole('heading', { name: 'Banca de prueba / Iniciar sesión' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      `Solo lectura · disponible hasta el ${formatDay(shared.expiresAt)}`,
    );
    const canvas = screen.getByLabelText('lienzo');
    expect(canvas).toHaveTextContent('Login');
    expect(canvas).toHaveAttribute('data-share-token', TOKEN);
    expect(canvas).toHaveAttribute('data-items', 'item-1');
    expect(screen.queryByRole('button', { name: 'Iniciar sesión' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Salir' })).not.toBeInTheDocument();
    // La petición no lleva token de sesión.
    const [, init] = api.fetchMock.mock.calls[0]!;
    expect(new Headers(init?.headers).has('Authorization')).toBe(false);
  });

  it('un enlace revocado, caducado o inexistente muestra que ya no está disponible (criterio 10)', async () => {
    installFakeApi({ shared: {} });

    renderApp(`/s/${TOKEN}`);

    expect(await screen.findByRole('alert')).toHaveTextContent('Este enlace ya no está disponible');
    expect(screen.queryByLabelText('lienzo')).not.toBeInTheDocument();
  });

  it('las demás rutas siguen pidiendo iniciar sesión', () => {
    installFakeApi();

    renderApp('/');

    expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeInTheDocument();
  });
});
