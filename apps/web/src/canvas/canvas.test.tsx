import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import { describe, expect, it, vi } from 'vitest';
import { PixelNode, type WalkieFlowNode } from '../nodes/PixelNode';
import { createGraphStore } from '../store/graphStore';
import { GraphStoreProvider } from '../store/GraphStoreProvider';
import { Palette } from './Palette';

describe('Palette', () => {
  it('ofrece los tres tipos de la fase y agrega con clic', async () => {
    const onAdd = vi.fn();
    render(<Palette onAdd={onAdd} />);

    const items = screen.getAllByRole('button');
    expect(items.map((b) => b.textContent)).toEqual(['[ ] Pantalla', '</> API', '(=) Base de datos']);
    expect(items.every((b) => b.draggable)).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: /API/ }));
    expect(onAdd).toHaveBeenCalledWith('api');
  });
});

describe('PixelNode', () => {
  function renderNode(editing: boolean) {
    const store = createGraphStore();
    const id = store.getState().addNode('screen', { x: 0, y: 0 });
    const node = store.getState().nodes[id]!;
    const onEditDone = vi.fn();
    const props = { id, data: { node, editing, onEditDone }, selected: false } as unknown as NodeProps<WalkieFlowNode>;
    render(
      <GraphStoreProvider store={store}>
        <ReactFlowProvider>
          <PixelNode {...props} />
        </ReactFlowProvider>
      </GraphStoreProvider>,
    );
    return { store, id, onEditDone };
  }

  it('muestra el tipo y el título', () => {
    renderNode(false);

    expect(screen.getByText('Pantalla', { selector: '.pixel-node-title' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Título del nodo')).not.toBeInTheDocument();
  });

  it('en edición, Enter renombra por el store y termina la edición', async () => {
    const { store, id, onEditDone } = renderNode(true);

    const input = screen.getByLabelText('Título del nodo');
    await userEvent.clear(input);
    await userEvent.type(input, 'Login{Enter}');

    expect(store.getState().nodes[id]?.title).toBe('Login');
    expect(onEditDone).toHaveBeenCalled();
  });

  it('Escape cancela sin cambiar el título', async () => {
    const { store, id, onEditDone } = renderNode(true);

    await userEvent.type(screen.getByLabelText('Título del nodo'), ' cambio{Escape}');

    expect(store.getState().nodes[id]?.title).toBe('Pantalla');
    expect(store.getState().dirty).toBe(true); // solo por addNode
    expect(onEditDone).toHaveBeenCalled();
  });
});
