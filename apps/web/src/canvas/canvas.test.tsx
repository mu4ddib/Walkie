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
import { MemoryRouter } from 'react-router';
import type { CatalogItem } from '../api/client';
import { CatalogContext, toCanvasCatalog } from '../catalog/catalogContext';
import { Palette } from './Palette';

// `EdgeLabelRenderer` hace un portal al contenedor de <ReactFlow>, que aquí no existe: se renderiza en línea.
vi.mock('@xyflow/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@xyflow/react')>()),
  EdgeLabelRenderer: ({ children }: { children: ReactNode }) => <foreignObject>{children}</foreignObject>,
}));

describe('Palette (barra de herramientas)', () => {
  it('ofrece los siete tipos con su tecla y agrega con clic', async () => {
    const onAdd = vi.fn();
    render(<Palette onAdd={onAdd} />);

    const tools = screen.getAllByRole('button');
    expect(tools.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Actor',
      'Pantalla',
      'Regla',
      'API',
      'Servicio',
      'Base de datos',
      'Portal',
    ]);
    expect(tools.map((b) => b.getAttribute('aria-keyshortcuts'))).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    expect(tools.every((b) => b.draggable)).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'API' }));
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

const consultar: CatalogItem = {
  id: 'item-1',
  appId: 'app-1',
  type: 'api',
  title: 'Consultar cliente',
  http: { method: 'GET', path: '/clientes/{id}' },
  version: 1,
};

describe('Palette con catálogo (Componentes)', () => {
  it('abre el panel, explica el catálogo, busca y crea un ref con clic', async () => {
    const onAddRef = vi.fn();
    const otro: CatalogItem = { id: 'item-2', appId: 'app-1', type: 'database', title: 'Clientes', version: 1 };
    render(
      <MemoryRouter>
        <Palette onAdd={vi.fn()} catalog={{ appId: 'app-1', items: [consultar, otro], onAddRef }} />
      </MemoryRouter>,
    );

    const toggle = screen.getByRole('button', { name: 'Componentes' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    const section = screen.getByRole('region', { name: 'Catálogo' });
    expect(section).toHaveTextContent('compartidos por todos los lienzos de la app');

    await userEvent.type(within(section).getByLabelText('Buscar componentes'), 'consul');
    expect(within(section).queryByRole('button', { name: /Clientes/ })).not.toBeInTheDocument();
    const item = within(section).getByRole('button', { name: /Consultar cliente/ });
    expect(item.draggable).toBe(true);
    await userEvent.click(item);
    expect(onAddRef).toHaveBeenCalledWith(consultar);
  });

  it('filtra por tipo', async () => {
    const otro: CatalogItem = { id: 'item-2', appId: 'app-1', type: 'database', title: 'Clientes', version: 1 };
    render(
      <MemoryRouter>
        <Palette onAdd={vi.fn()} catalog={{ appId: 'app-1', items: [consultar, otro], onAddRef: vi.fn() }} />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Componentes' }));
    const filter = screen.getByRole('group', { name: 'Filtrar por tipo' });

    await userEvent.click(within(filter).getByRole('button', { name: 'Base de datos' }));
    expect(within(filter).getByRole('button', { name: 'Base de datos' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: /Consultar cliente/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Clientes/ })).toBeInTheDocument();

    await userEvent.click(within(filter).getByRole('button', { name: 'Todos' }));
    expect(screen.getByRole('button', { name: /Consultar cliente/ })).toBeInTheDocument();
  });

  it('crea un componente nuevo sin salir del lienzo', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(
      <MemoryRouter>
        <Palette onAdd={vi.fn()} catalog={{ appId: 'app-1', items: [], onAddRef: vi.fn(), onCreate }} />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Componentes' }));
    const form = screen.getByRole('form', { name: 'Nuevo componente' });

    await userEvent.click(within(form).getByRole('button', { name: 'Crear y agregar' }));
    expect(within(form).getByRole('alert')).toHaveTextContent('El título es obligatorio.');
    expect(onCreate).not.toHaveBeenCalled();

    await userEvent.selectOptions(within(form).getByLabelText('Tipo de componente'), 'service');
    await userEvent.type(within(form).getByLabelText('Título del componente'), 'Motor de pagos');
    await userEvent.click(within(form).getByRole('button', { name: 'Crear y agregar' }));

    expect(onCreate).toHaveBeenCalledWith({ type: 'service', title: 'Motor de pagos' });
    expect(within(form).getByLabelText('Título del componente')).toHaveValue('');
  });

  it('con el catálogo vacío enlaza a la página del catálogo', async () => {
    render(
      <MemoryRouter>
        <Palette onAdd={vi.fn()} catalog={{ appId: 'app-1', items: [], onAddRef: vi.fn() }} />
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Componentes' }));
    expect(screen.getByRole('link', { name: /crea APIs/i })).toHaveAttribute('href', '/apps/app-1/catalog');
  });
});

describe('PixelNode de un ref', () => {
  function renderRef(catalogId: string) {
    const store = createGraphStore();
    const id = store.getState().addRef({ id: catalogId, title: 'Título viejo' }, { x: 0, y: 0 });
    const node = store.getState().nodes[id]!;
    const props = {
      id,
      data: { node, editing: false, onEditDone: vi.fn() },
      selected: false,
    } as unknown as NodeProps<WalkieFlowNode>;
    render(
      <GraphStoreProvider store={store}>
        <CatalogContext.Provider value={toCanvasCatalog('app-1', [consultar])}>
          <ReactFlowProvider>
            <PixelNode {...props} />
          </ReactFlowProvider>
        </CatalogContext.Provider>
      </GraphStoreProvider>,
    );
  }

  it('se ve como su elemento, con los datos actuales y la marca de componente', () => {
    renderRef('item-1');

    expect(document.querySelector('.pixel-node-kind')).toHaveTextContent('</> APIcomponente');
    expect(document.querySelector('.pixel-node-title')).toHaveTextContent('Consultar cliente');
    expect(screen.getByText('GET /clientes/{id}')).toBeInTheDocument();
  });

  it('si el elemento ya no existe, muestra "Elemento no encontrado" con el último título', () => {
    renderRef('nada');

    expect(document.querySelector('.pixel-node-kind')).toHaveTextContent('Elemento no encontrado');
    expect(document.querySelector('.pixel-node-title')).toHaveTextContent('Título viejo');
    expect(document.querySelector('.pixel-node')).toHaveAttribute('data-ref', 'missing');
  });
});
