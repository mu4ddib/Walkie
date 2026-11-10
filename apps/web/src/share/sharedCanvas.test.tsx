import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CatalogContext, type CanvasCatalog } from '../catalog/catalogContext';
import { PixelNode, type WalkieFlowNode } from '../nodes/PixelNode';
import type { Node, WalkieCanvasGraphV0 } from '../schema/walkie-graph';
import { createGraphStore } from '../store/graphStore';
import { GraphStoreProvider } from '../store/GraphStoreProvider';
import { installFakeApi } from '../test/fakeApi';
import { SharedTours } from '../tours/SharedTours';

vi.mock('react-oidc-context', () => ({ useAuth: () => ({ user: null }) }));

const TOKEN = 'B'.repeat(43);
const share: CanvasCatalog = { appId: '', items: {}, share: { token: TOKEN } };

beforeEach(() => vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:imagen' })));
afterEach(() => vi.unstubAllGlobals());

function renderNode(node: Node) {
  const store = createGraphStore();
  store.getState().loadGraph({ schemaVersion: 0, version: 1, nodes: { [node.id]: node }, edges: {}, layout: {} });
  const props = { id: node.id, data: { node, editing: false, onEditDone: vi.fn() }, selected: false };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <GraphStoreProvider store={store}>
        <CatalogContext.Provider value={share}>
          <ReactFlowProvider>
            <PixelNode {...(props as unknown as NodeProps<WalkieFlowNode>)} />
          </ReactFlowProvider>
        </CatalogContext.Provider>
      </GraphStoreProvider>
    </QueryClientProvider>,
  );
}

describe('lienzo de un enlace', () => {
  it('un portal muestra su título y no se marca como "Destino no encontrado" (criterio 8)', () => {
    renderNode({ id: 'p1', type: 'portal', title: 'Transferir', targetFeatureId: '0198f0c0-0000-7000-8000-000000000001' });

    expect(document.querySelector('.pixel-node-title')).toHaveTextContent('→ Transferir');
    expect(document.querySelector('.pixel-node-title')).not.toHaveAttribute('title');
    expect(document.querySelector('.pixel-node')).toHaveAttribute('data-ref', 'ok');
  });

  it('la imagen de una pantalla se pide sin sesión por el endpoint del enlace (criterio 5)', async () => {
    const api = installFakeApi({
      shared: {
        [TOKEN]: {
          appName: 'App',
          featureName: 'Feature',
          expiresAt: '2026-12-08T12:00:00Z',
          graph: {
            schemaVersion: 0,
            version: 1,
            nodes: { s1: { id: 's1', type: 'screen', title: 'Login', assetId: 'asset-1' } },
            edges: {},
            layout: {},
          },
          catalog: [],
        },
      },
    });

    renderNode({ id: 's1', type: 'screen', title: 'Login', assetId: 'asset-1' });

    expect(await screen.findByRole('img', { name: 'Imagen de la pantalla' })).toHaveAttribute('src', 'blob:imagen');
    await waitFor(() => expect(api.fetchMock).toHaveBeenCalled());
    const [url, init] = api.fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(new RegExp(`/api/public/shares/${TOKEN}/assets/asset-1$`));
    expect(new Headers(init?.headers).has('Authorization')).toBe(false);
  });
});

describe('SharedTours', () => {
  function renderTours(tours: WalkieCanvasGraphV0['tours']) {
    const store = createGraphStore();
    store.getState().loadGraph({
      schemaVersion: 0,
      version: 1,
      nodes: { s1: { id: 's1', type: 'screen', title: 'Login' } },
      edges: {},
      layout: {},
      tours,
    });
    const onPlay = vi.fn();
    const wrapper = ({ children }: { children: ReactNode }) => <GraphStoreProvider store={store}>{children}</GraphStoreProvider>;
    render(<SharedTours onPlay={onPlay} />, { wrapper });
    return onPlay;
  }

  it('lista los tours y "Ver tour" los inicia; sin pasos no se puede ver (criterio 7)', async () => {
    const onPlay = renderTours({
      t1: { id: 't1', name: 'Primer ingreso', steps: [{ nodeId: 's1', note: 'Aquí empieza.' }] },
      t2: { id: 't2', name: 'Borrador', steps: [] },
    });

    expect(screen.getByRole('complementary', { name: 'Tours' })).toHaveTextContent('Primer ingreso (1 pasos)');
    expect(screen.getByRole('button', { name: 'Ver tour Borrador' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Ver tour Primer ingreso' }));
    expect(onPlay).toHaveBeenCalledWith('t1');
  });

  it('sin tours lo dice', () => {
    renderTours(undefined);

    expect(screen.getByText('Este lienzo no tiene tours ni recorridos.')).toBeInTheDocument();
  });
});
