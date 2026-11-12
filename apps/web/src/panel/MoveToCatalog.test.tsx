import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CatalogContext, toCanvasCatalog } from '../catalog/catalogContext';
import { createGraphStore, type GraphStore } from '../store/graphStore';
import { GraphStoreProvider } from '../store/GraphStoreProvider';
import { installFakeApi } from '../test/fakeApi';
import { PropertiesPanel } from './PropertiesPanel';

vi.mock('react-oidc-context', () => ({ useAuth: () => ({ user: { access_token: 'token-de-prueba' } }) }));

afterEach(() => vi.unstubAllGlobals());

const app = { id: 'app-1', name: 'Banca móvil', createdAt: '2026-01-01T00:00:00Z', featureCount: 1 };

function renderPanel(setup: (s: GraphStore) => string, appId = 'app-1') {
  const store = createGraphStore();
  const nodeId = setup(store.getState());
  store.getState().markSaved(1);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <GraphStoreProvider store={store}>
        <CatalogContext.Provider value={toCanvasCatalog(appId, [])}>
          <PropertiesPanel nodeId={nodeId} edgeId={null} />
        </CatalogContext.Provider>
      </GraphStoreProvider>
    </QueryClientProvider>,
  );
  return { store, nodeId };
}

describe('Guardar como componente', () => {
  it('un recurso pasa con su subtipo y detalles, y un servicio con dónde corre (spec nodos-de-infraestructura)', async () => {
    const api = installFakeApi({ apps: [app] });
    const { store, nodeId } = renderPanel((s) => {
      const id = s.addResource('queue', { x: 0, y: 0 });
      s.setResource(id, { provider: 'aws', details: [{ key: 'retención', value: '4 días' }] });
      return id;
    });

    await userEvent.click(screen.getByRole('button', { name: 'Guardar como componente' }));

    await vi.waitFor(() => expect(store.getState().nodes[nodeId]?.type).toBe('ref'));
    expect(api.catalog[0]).toMatchObject({
      type: 'resource',
      title: 'Cola',
      resource: { kind: 'queue', provider: 'aws', details: [{ key: 'retención', value: '4 días' }] },
    });
  });

  it('crea el elemento con los datos del nodo y lo convierte en ref', async () => {
    const api = installFakeApi({ apps: [app] });
    const { store, nodeId } = renderPanel((s) => {
      const id = s.addNode('api', { x: 0, y: 0 });
      s.updateNode(id, {
        title: 'Consultar cliente',
        description: 'Por documento',
        http: { method: 'GET', path: '/c/{id}' },
      });
      return id;
    });

    await userEvent.click(screen.getByRole('button', { name: 'Guardar como componente' }));

    await vi.waitFor(() => expect(store.getState().nodes[nodeId]?.type).toBe('ref'));
    expect(api.catalog).toEqual([
      {
        id: expect.any(String),
        appId: 'app-1',
        type: 'api',
        title: 'Consultar cliente',
        description: 'Por documento',
        http: { method: 'GET', path: '/c/{id}' },
        version: 1,
      },
    ]);
    expect(store.getState().nodes[nodeId]).toEqual({
      id: nodeId,
      type: 'ref',
      title: 'Consultar cliente',
      catalogId: api.catalog[0]!.id,
    });
    expect(store.getState().dirty).toBe(true);
  });

  it('si la API falla, avisa y el nodo no cambia', async () => {
    installFakeApi({ apps: [] });
    const { store, nodeId } = renderPanel((s) => s.addNode('database', { x: 0, y: 0 }));

    await userEvent.click(screen.getByRole('button', { name: 'Guardar como componente' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(store.getState().nodes[nodeId]?.type).toBe('database');
  });

  it('no aparece en pantallas ni sin catálogo', () => {
    installFakeApi({ apps: [app] });
    renderPanel((s) => s.addNode('screen', { x: 0, y: 0 }));
    expect(screen.queryByRole('button', { name: 'Guardar como componente' })).not.toBeInTheDocument();
  });

  it('no aparece si el lienzo no tiene catálogo', () => {
    installFakeApi({ apps: [app] });
    renderPanel((s) => s.addNode('service', { x: 0, y: 0 }), '');
    expect(screen.queryByRole('button', { name: 'Guardar como componente' })).not.toBeInTheDocument();
  });
});
