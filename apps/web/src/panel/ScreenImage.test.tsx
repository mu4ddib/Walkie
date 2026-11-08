import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CatalogContext, toCanvasCatalog } from '../catalog/catalogContext';
import { createGraphStore } from '../store/graphStore';
import { GraphStoreProvider } from '../store/GraphStoreProvider';
import { installFakeApi } from '../test/fakeApi';
import { PropertiesPanel } from './PropertiesPanel';

vi.mock('react-oidc-context', () => ({ useAuth: () => ({ user: { access_token: 'token-de-prueba' } }) }));

const app = { id: 'app-1', name: 'Banca móvil', createdAt: '2026-01-01T00:00:00Z', featureCount: 1 };

beforeEach(() => {
  // jsdom no implementa URL.createObjectURL.
  URL.createObjectURL = vi.fn(() => 'blob:imagen-de-prueba');
});
afterEach(() => vi.unstubAllGlobals());

function renderScreenPanel() {
  const store = createGraphStore();
  const id = store.getState().addNode('screen', { x: 0, y: 0 });
  store.getState().markSaved(1);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <GraphStoreProvider store={store}>
        <CatalogContext.Provider value={toCanvasCatalog('app-1', [])}>
          <PropertiesPanel nodeId={id} edgeId={null} />
        </CatalogContext.Provider>
      </GraphStoreProvider>
    </QueryClientProvider>,
  );
  return { store, id };
}

const png = (size = 8) => new File([new Uint8Array(size)], 'pantalla.png', { type: 'image/png' });

describe('imagen de una pantalla', () => {
  it('avisa que no se suban datos reales', () => {
    installFakeApi({ apps: [app] });
    renderScreenPanel();

    expect(screen.getByRole('note')).toHaveTextContent('No subas capturas con datos reales de clientes.');
  });

  it('sube una imagen, la muestra y deja el lienzo sin guardar', async () => {
    const api = installFakeApi({ apps: [app] });
    const { store, id } = renderScreenPanel();

    await userEvent.upload(screen.getByLabelText('Subir imagen'), png());

    expect(await screen.findByRole('img', { name: /ver en grande/ })).toHaveAttribute('src', 'blob:imagen-de-prueba');
    const [assetId] = [...api.assets.keys()];
    expect(store.getState().nodes[id]?.assetId).toBe(assetId);
    expect(store.getState().dirty).toBe(true);
    expect(screen.getByLabelText('Reemplazar imagen')).toBeInTheDocument();
  });

  it('rechaza otro tipo o más de 5 MB sin llamar a la API', async () => {
    const api = installFakeApi({ apps: [app] });
    const { store, id } = renderScreenPanel();
    const input = screen.getByLabelText('Subir imagen');

    await userEvent.upload(input, new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }), { applyAccept: false });
    expect(screen.getByRole('alert')).toHaveTextContent('Solo se aceptan imágenes PNG, JPEG o WebP.');

    await userEvent.upload(input, png(5 * 1024 * 1024 + 1));
    expect(screen.getByRole('alert')).toHaveTextContent('La imagen no puede pesar más de 5 MB.');

    expect(api.fetchMock).not.toHaveBeenCalled();
    expect(store.getState().nodes[id]?.assetId).toBeUndefined();
  });

  it('muestra el error de la API y no cambia el nodo', async () => {
    const api = installFakeApi({ apps: [app] });
    api.next.uploadStatus = 400;
    const { store, id } = renderScreenPanel();

    await userEvent.upload(screen.getByLabelText('Subir imagen'), png());

    expect(await screen.findByRole('alert')).toHaveTextContent('Solo se aceptan imágenes PNG, JPEG o WebP.');
    expect(store.getState().nodes[id]?.assetId).toBeUndefined();
  });

  it('se ve en grande, se cierra con Escape y se puede quitar', async () => {
    installFakeApi({ apps: [app] });
    const { store, id } = renderScreenPanel();
    await userEvent.upload(screen.getByLabelText('Subir imagen'), png());

    await userEvent.click(await screen.findByRole('button', { name: /ver en grande/ }));
    expect(screen.getByRole('dialog', { name: 'Imagen de la pantalla' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Quitar imagen' }));
    expect(store.getState().nodes[id]?.assetId).toBeUndefined();
    expect(screen.getByLabelText('Subir imagen')).toBeInTheDocument();
  });
});
