import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CatalogItem } from '../api/client';
import { CatalogContext, toCanvasCatalog, type CanvasCatalog } from '../catalog/catalogContext';
import { createGraphStore } from '../store/graphStore';
import { GraphStoreProvider } from '../store/GraphStoreProvider';
import { installFakeApi } from '../test/fakeApi';
import { PropertiesPanel } from './PropertiesPanel';

vi.mock('react-oidc-context', () => ({ useAuth: () => ({ user: { access_token: 'token-de-prueba' } }) }));

afterEach(() => vi.unstubAllGlobals());

const consultar: CatalogItem = {
  id: 'item-1',
  appId: 'app-1',
  type: 'api',
  title: 'Consultar cliente',
  description: 'Datos básicos',
  http: { method: 'GET', path: '/clientes/{id}' },
  version: 1,
};
const app = { id: 'app-1', name: 'Banca móvil', createdAt: '2026-01-01T00:00:00Z', featureCount: 2 };
const feature = (id: string, name: string) => ({
  id,
  appId: 'app-1',
  name,
  description: '',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});
const usedIn = (catalogId: string) => ({
  schemaVersion: 0 as const,
  version: 1,
  nodes: { r1: { id: 'r1', type: 'ref' as const, title: 'Consultar cliente', catalogId } },
  edges: {},
  layout: { r1: { x: 0, y: 0 } },
});

function renderRefPanel(catalogId: string, catalog: Partial<CanvasCatalog> = {}) {
  const api = installFakeApi({
    apps: [app],
    features: [feature('feat-1', 'Iniciar sesión'), feature('feat-2', 'Transferir')],
    catalog: [{ ...consultar }],
    canvases: { 'feat-1': usedIn('item-1'), 'feat-2': usedIn('item-1') },
  });
  const store = createGraphStore();
  const screenId = store.getState().addNode('screen', { x: 0, y: 0 });
  const id = store.getState().addRef({ id: catalogId, title: 'Título viejo' }, { x: 240, y: 0 });
  store.getState().connect(screenId, id);
  store.getState().markSaved(1);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <GraphStoreProvider store={store}>
          <CatalogContext.Provider value={{ ...toCanvasCatalog('app-1', [consultar], [], 'feat-1'), ...catalog }}>
            <PropertiesPanel nodeId={id} edgeId={null} />
          </CatalogContext.Provider>
        </GraphStoreProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { api, store, id };
}

describe('inspector de un componente', () => {
  it('separa la definición compartida (con dónde se usa) de lo propio de este lienzo', async () => {
    renderRefPanel('item-1');

    const shared = screen.getByRole('region', { name: 'Definición compartida' });
    expect(within(shared).getByLabelText('Título')).toHaveValue('Consultar cliente');
    expect(within(shared).getByLabelText('Descripción')).toHaveValue('Datos básicos');
    expect(within(shared).getByLabelText('Método')).toHaveValue('GET');
    expect(within(shared).getByLabelText('Ruta HTTP')).toHaveValue('/clientes/{id}');
    expect(await within(shared).findByText(/Se usa en 2 lienzos/)).toBeInTheDocument();
    const list = within(shared).getByRole('list', { name: 'Lienzos que lo usan' });
    expect(list).toHaveTextContent('Iniciar sesión (este lienzo)');
    expect(list).toHaveTextContent('Transferir');
    expect(within(shared).getByRole('button', { name: 'Guardar definición' })).toBeDisabled();

    const here = screen.getByRole('region', { name: 'En este lienzo' });
    expect(here).toHaveTextContent('1 conexión aquí.');
    expect(within(here).getByRole('link', { name: 'Abrir en el catálogo' })).toHaveAttribute(
      'href',
      '/apps/app-1/catalog/item-1',
    );
  });

  it('guarda la definición en el catálogo sin tocar el lienzo', async () => {
    const { api, store } = renderRefPanel('item-1');
    const shared = screen.getByRole('region', { name: 'Definición compartida' });

    await userEvent.clear(within(shared).getByLabelText('Título'));
    await userEvent.type(within(shared).getByLabelText('Título'), 'Consultar cliente v2');
    await userEvent.click(within(shared).getByRole('button', { name: 'Guardar definición' }));

    await vi.waitFor(() => expect(api.catalog[0]).toMatchObject({ title: 'Consultar cliente v2', version: 2 }));
    expect(store.getState().dirty).toBe(false);
  });

  it('la definición compartida incluye el contrato completo y lo guarda en el catálogo', async () => {
    const { api } = renderRefPanel('item-1');
    const shared = screen.getByRole('region', { name: 'Definición compartida' });

    await userEvent.selectOptions(within(shared).getByLabelText('Tipo de autenticación'), 'oauth2');
    await userEvent.click(within(shared).getByRole('button', { name: 'Guardar definición' }));

    await vi.waitFor(() =>
      expect(api.catalog[0]).toMatchObject({
        http: { method: 'GET', path: '/clientes/{id}', auth: { type: 'oauth2' } },
        version: 2,
      }),
    );
  });

  it('"Crear copia independiente" lo vuelve un nodo propio con los datos actuales', async () => {
    const { store, id } = renderRefPanel('item-1');

    await userEvent.click(screen.getByRole('button', { name: 'Crear copia independiente' }));

    expect(store.getState().nodes[id]).toEqual({
      id,
      type: 'api',
      title: 'Consultar cliente',
      description: 'Datos básicos',
      http: { method: 'GET', path: '/clientes/{id}' },
    });
    expect(store.getState().dirty).toBe(true);
    expect(screen.getByRole('button', { name: 'Guardar como componente' })).toBeInTheDocument();
  });

  it('en un enlace de solo lectura muestra la definición sin editar ni copiar', () => {
    renderRefPanel('item-1', { share: { token: 't' } });

    expect(screen.getByText('Consultar cliente')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('si el elemento no existe lo dice y muestra el último título', () => {
    renderRefPanel('nada');

    expect(screen.getByText('Elemento no encontrado')).toBeInTheDocument();
    expect(screen.getByText('Título viejo')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
