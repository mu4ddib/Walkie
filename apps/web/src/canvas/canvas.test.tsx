import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { KindEdge, type WalkieFlowEdge } from '../edges/KindEdge';
import { PixelNode, type WalkieFlowNode } from '../nodes/PixelNode';
import type { EdgeProps } from '@xyflow/react';
import { createGraphStore, type GraphStore, type NodeType } from '../store/graphStore';
import { GraphStoreProvider } from '../store/GraphStoreProvider';
import { Palette } from './Palette';

// `EdgeLabelRenderer` hace un portal al contenedor de <ReactFlow>, que aquí no existe: se renderiza en línea.
vi.mock('@xyflow/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@xyflow/react')>()),
  EdgeLabelRenderer: ({ children }: { children: ReactNode }) => <foreignObject>{children}</foreignObject>,
}));

describe('Palette', () => {
  it('ofrece los seis tipos y agrega con clic', async () => {
    const onAdd = vi.fn();
    render(<Palette onAdd={onAdd} />);

    const items = screen.getAllByRole('button');
    expect(items.map((b) => b.textContent)).toEqual([
      'o/ Actor',
      '[ ] Pantalla',
      '§ Regla',
      '</> API',
      '{ } Servicio',
      '(=) Base de datos',
    ]);
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

describe('contenido de PixelNode', () => {
  function renderContent(type: NodeType, setup: (s: GraphStore, id: string) => void) {
    const store = createGraphStore();
    const id = store.getState().addNode(type, { x: 0, y: 0 });
    setup(store.getState(), id);
    const node = store.getState().nodes[id]!;
    const props = {
      id,
      data: { node, editing: false, onEditDone: vi.fn() },
      selected: false,
    } as unknown as NodeProps<WalkieFlowNode>;
    render(
      <GraphStoreProvider store={store}>
        <ReactFlowProvider>
          <PixelNode {...props} />
        </ReactFlowProvider>
      </GraphStoreProvider>,
    );
  }

  it('lista los inputs con * en los obligatorios, hasta 5 y "+N más"', () => {
    renderContent('screen', (s, id) => {
      s.addInput(id, { name: 'documento', required: true });
      for (const name of ['a', 'b', 'c', 'd', 'e', 'f']) s.addInput(id, { name });
    });

    const items = within(screen.getByRole('list', { name: 'Inputs' })).getAllByRole('listitem');
    expect(items.map((i) => i.textContent)).toEqual([
      'documento* : string',
      'a : string',
      'b : string',
      'c : string',
      'd : string',
      '+2 más',
    ]);
  });

  it('muestra hasta 3 líneas de la expresión de una regla', () => {
    renderContent('rule', (s, id) =>
      s.updateNode(id, { expression: 'cc: solo dígitos\nde 6 a 10\n\nsin espacios\nobligatorio' }),
    );

    expect(screen.getByLabelText('Expresión').textContent).toBe('cc: solo dígitosde 6 a 10sin espacios+1 más');
  });

  it('muestra MÉTODO /ruta de una API y la descripción', () => {
    renderContent('api', (s, id) =>
      s.updateNode(id, { description: 'Consulta un cliente', http: { method: 'GET', path: '/clientes/{id}' } }),
    );

    expect(screen.getByText('GET /clientes/{id}')).toBeInTheDocument();
    expect(screen.getByText('Consulta un cliente')).toBeInTheDocument();
  });

  it('un nodo sin contenido solo muestra tipo y título', () => {
    renderContent('service', () => {});

    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Expresión')).not.toBeInTheDocument();
  });
});

describe('KindEdge', () => {
  it('muestra el tipo, la etiqueta y la condición', () => {
    const props = {
      id: 'e1',
      data: { kind: 'response', label: 'Cliente', when: '404' },
      selected: false,
      sourceX: 0,
      sourceY: 0,
      targetX: 100,
      targetY: 0,
      sourcePosition: 'right',
      targetPosition: 'left',
    } as unknown as EdgeProps<WalkieFlowEdge>;
    render(
      <GraphStoreProvider store={createGraphStore()}>
        <ReactFlowProvider>
          <svg>
            <KindEdge {...props} />
          </svg>
        </ReactFlowProvider>
      </GraphStoreProvider>,
    );

    expect(document.querySelector('.kind-edge-label')?.textContent).toBe('responde · Cliente [404]');
  });
});
