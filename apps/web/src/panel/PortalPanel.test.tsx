import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UNSAVED_CONFIRM } from '../canvas/useOpenFeature';
import { CatalogContext, toCanvasCatalog } from '../catalog/catalogContext';
import { PixelNode, type WalkieFlowNode } from '../nodes/PixelNode';
import { createGraphStore, type GraphStore } from '../store/graphStore';
import { GraphStoreProvider } from '../store/GraphStoreProvider';
import { PropertiesPanel } from './PropertiesPanel';

const features = [
  { id: 'feat-1', appId: 'app-1', name: 'Iniciar sesión', createdAt: '2026-01-01T00:00:00Z' },
  { id: 'feat-2', appId: 'app-1', name: 'Transferir', createdAt: '2026-01-01T00:00:00Z' },
  { id: 'feat-3', appId: 'app-1', name: 'Pagar', createdAt: '2026-01-01T00:00:00Z' },
];
const context = toCanvasCatalog('app-1', [], features, 'feat-1');

afterEach(() => vi.restoreAllMocks());

function renderPortal(setup: (s: GraphStore, id: string) => void = () => {}) {
  const store = createGraphStore();
  const id = store.getState().addNode('portal', { x: 0, y: 0 });
  setup(store.getState(), id);
  store.getState().markSaved(1);
  render(
    <MemoryRouter initialEntries={['/apps/app-1/features/feat-1']}>
      <GraphStoreProvider store={store}>
        <CatalogContext.Provider value={context}>
          <Routes>
            <Route path="/apps/app-1/features/feat-1" element={<PropertiesPanel nodeId={id} edgeId={null} />} />
            <Route path="/apps/app-1/features/:featureId" element={<p>Lienzo destino</p>} />
          </Routes>
        </CatalogContext.Provider>
      </GraphStoreProvider>
    </MemoryRouter>,
  );
  return { store, id };
}

describe('panel de un portal', () => {
  it('ofrece las otras features de la app, ordenadas, sin la actual', () => {
    renderPortal();

    const options = [...screen.getByLabelText('Feature destino').querySelectorAll('option')].map((o) => o.textContent);
    expect(options).toEqual(['— Sin destino —', 'Pagar', 'Transferir']);
    expect(screen.getByRole('button', { name: 'Abrir' })).toBeDisabled();
  });

  it('elegir destino guarda el id y el nombre como título', async () => {
    const { store, id } = renderPortal();

    await userEvent.selectOptions(screen.getByLabelText('Feature destino'), 'Transferir');

    expect(store.getState().nodes[id]).toMatchObject({ targetFeatureId: 'feat-2', title: 'Transferir' });
    expect(store.getState().dirty).toBe(true);
  });

  it('Abrir navega al lienzo destino sin preguntar si no hay cambios', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    renderPortal((s, id) => s.updateNode(id, { targetFeatureId: 'feat-2', title: 'Transferir' }));

    await userEvent.click(screen.getByRole('button', { name: 'Abrir' }));

    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByText('Lienzo destino')).toBeInTheDocument();
  });

  it('con cambios sin guardar pide confirmación y se queda si se cancela', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { store, id } = renderPortal((s, id) => s.updateNode(id, { targetFeatureId: 'feat-2', title: 'Transferir' }));
    store.getState().updateNode(id, { description: 'Cambio sin guardar' });

    await userEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    expect(confirm).toHaveBeenCalledWith(UNSAVED_CONFIRM);
    expect(screen.queryByText('Lienzo destino')).not.toBeInTheDocument();

    confirm.mockReturnValue(true);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    expect(screen.getByText('Lienzo destino')).toBeInTheDocument();
  });

  it('un destino que ya no existe lo dice', () => {
    renderPortal((s, id) => s.updateNode(id, { targetFeatureId: 'feat-borrada', title: 'Vieja' }));

    expect(screen.getByText(/ya no existe/)).toHaveTextContent('Último nombre conocido: Vieja');
    expect(screen.getByRole('button', { name: 'Abrir' })).toBeDisabled();
  });
});

describe('nodo portal', () => {
  function renderNode(setup: (s: GraphStore, id: string) => void) {
    const store = createGraphStore();
    const id = store.getState().addNode('portal', { x: 0, y: 0 });
    setup(store.getState(), id);
    const node = store.getState().nodes[id]!;
    const props = {
      id,
      data: { node, editing: false, onEditDone: vi.fn() },
      selected: false,
    } as unknown as NodeProps<WalkieFlowNode>;
    render(
      <GraphStoreProvider store={store}>
        <CatalogContext.Provider value={context}>
          <ReactFlowProvider>
            <PixelNode {...props} />
          </ReactFlowProvider>
        </CatalogContext.Provider>
      </GraphStoreProvider>,
    );
  }

  it('sin destino dice "Sin destino"', () => {
    renderNode(() => {});
    expect(document.querySelector('.pixel-node-title')).toHaveTextContent('Sin destino');
  });

  it('con destino muestra el nombre actual de la feature', () => {
    renderNode((s, id) => s.updateNode(id, { targetFeatureId: 'feat-2', title: 'Nombre viejo' }));
    expect(document.querySelector('.pixel-node-title')).toHaveTextContent('→ Transferir');
  });

  it('con un destino que no existe lo marca', () => {
    renderNode((s, id) => s.updateNode(id, { targetFeatureId: 'feat-borrada', title: 'Vieja' }));
    expect(document.querySelector('.pixel-node-kind')).toHaveTextContent('Destino no encontrado');
    expect(document.querySelector('.pixel-node-title')).toHaveTextContent('→ Vieja');
  });
});
