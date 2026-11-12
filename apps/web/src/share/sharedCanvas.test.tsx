import { render, screen, waitFor, within } from '@testing-library/react';
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

  it('lista compacta de solo lectura: filas con ▶, sin crear ni «⋯»; sin pasos no se puede ver (criterio 7)', async () => {
    const onPlay = renderTours({
      t1: { id: 't1', name: 'Primer ingreso', steps: [{ nodeId: 's1', note: 'Aquí empieza.' }] },
      t2: { id: 't2', name: 'Borrador', steps: [] },
    });

    const rows = screen.getByRole('list', { name: 'Tours' });
    expect(rows).toHaveTextContent(/Primer ingreso\s*1 paso/);
    expect(screen.queryByRole('button', { name: 'Nuevo tour' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Más acciones' })).not.toBeInTheDocument();
    // Por nombre: «Borrador» (sin pasos) va primero.
    const [draft, first] = within(rows).getAllByRole('button', { name: 'Ver tour' });
    expect(draft).toBeDisabled();
    await userEvent.click(first!);
    expect(onPlay).toHaveBeenCalledWith('t1');
  });

  it('el detalle se lee: pasos sin asa ni menú que se abren para leer la nota (spec tours-a-escala)', async () => {
    renderTours({ t1: { id: 't1', name: 'Primer ingreso', steps: [{ nodeId: 's1', note: 'Aquí empieza.' }] } });

    await userEvent.click(screen.getByRole('button', { name: 'Primer ingreso' }));
    expect(screen.getByText('Primer ingreso', { selector: '.tour-detail-name' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mover paso 1/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Acciones del paso 1' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Agregar paso' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^Login/ }));
    expect(screen.getByText('Aquí empieza.', { selector: '.tour-step-note' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('con solo recorridos, empieza en su pestaña', () => {
    renderTours({ f1: { id: 'f1', name: 'Alta', kind: 'flow', steps: [] } });

    expect(screen.getByRole('tab', { name: /Recorridos/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('sin tours lo dice', () => {
    renderTours(undefined);

    expect(screen.getByText('Este lienzo no tiene tours ni recorridos.')).toBeInTheDocument();
  });
});
