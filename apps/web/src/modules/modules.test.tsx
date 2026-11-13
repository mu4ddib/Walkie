import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModuleSummary } from '../api/client';
import { Palette } from '../canvas/Palette';
import { CatalogContext } from '../catalog/catalogContext';
import { GraphStoreProvider } from '../store/GraphStoreProvider';
import { createGraphStore } from '../store/graphStore';
import { installFakeApi } from '../test/fakeApi';
import { ExtractModuleDialog } from './ExtractModuleDialog';
import { InterfacePicker } from './InterfacePicker';
import { placeableModules } from './moduleMeta';

vi.mock('react-oidc-context', () => ({ useAuth: () => ({ user: { access_token: 'token-de-prueba' } }) }));

afterEach(() => vi.unstubAllGlobals());

const usuarios: ModuleSummary = {
  id: 'mod-1',
  appId: 'app-1',
  name: 'Usuarios',
  description: 'Cuentas y perfiles',
  version: 2,
  nodes: 4,
  interfaces: [
    { id: 'i-get', name: 'Consultar usuario', kind: 'provides', nodeId: 'get', nodeType: 'api', method: 'GET', path: '/usuarios/{id}' },
    { id: 'i-post', name: 'Crear usuario', kind: 'provides', nodeId: 'post', nodeType: 'api', method: 'POST', path: '/usuarios' },
    { id: 'i-db', name: 'Clientes', kind: 'requires', nodeId: 'svc', nodeType: 'service', nodeTitle: 'Servicio' },
  ],
  modules: [],
  usedBy: [],
};

describe('selector de interfaces', () => {
  it('busca por método o ruta, se maneja con teclado y ofrece el módulo completo', async () => {
    const onPick = vi.fn();
    render(<InterfacePicker module={usuarios} end="to" x={0} y={0} onPick={onPick} onCancel={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Conectar con Usuarios' });
    // Hacia el módulo, primero lo que ofrece; la dependencia va al final.
    const options = within(dialog).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining('Módulo completo'),
      expect.stringContaining('Consultar usuario'),
      expect.stringContaining('Crear usuario'),
      expect.stringContaining('Clientes'),
    ]);
    expect(within(dialog).getByLabelText('Buscar interfaces')).toHaveFocus();

    await userEvent.type(within(dialog).getByLabelText('Buscar interfaces'), 'post');
    expect(within(dialog).getAllByRole('option')).toHaveLength(2);
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'i-post' }));
  });

  it('Enter sin moverse elige el módulo completo y Esc cancela', async () => {
    const onPick = vi.fn();
    const onCancel = vi.fn();
    render(<InterfacePicker module={usuarios} end="from" x={0} y={0} onPick={onPick} onCancel={onCancel} />);
    await userEvent.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledWith(null);
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalled();
  });

  it('sin coincidencias lo dice', async () => {
    render(<InterfacePicker module={usuarios} end="to" x={0} y={0} onPick={vi.fn()} onCancel={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('Buscar interfaces'), 'zzz');
    expect(screen.getByText('Ninguna interfaz coincide.')).toBeInTheDocument();
  });
});

describe('catálogo del lienzo con módulos', () => {
  it('la pestaña «Módulos» lista, busca y agrega; vacía, explica cómo crear uno', async () => {
    const onAddModule = vi.fn();
    const { rerender } = render(
      <MemoryRouter>
        <Palette onAdd={vi.fn()} catalog={{ appId: 'app-1', items: [], onAddRef: vi.fn(), modules: [usuarios], onAddModule }} />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Catálogo' }));
    const panel = screen.getByRole('region', { name: 'Catálogo' });
    await userEvent.click(within(panel).getByRole('tab', { name: /Módulos/ }));
    expect(within(panel).getByRole('tab', { name: /Módulos/ })).toHaveAttribute('aria-selected', 'true');
    await userEvent.type(within(panel).getByLabelText('Buscar módulos'), 'cuentas');
    await userEvent.click(within(panel).getByRole('button', { name: /Usuarios/ }));
    expect(onAddModule).toHaveBeenCalledWith(usuarios);
    // Con flechas se cambia de pestaña.
    await userEvent.keyboard('{ArrowLeft}');

    rerender(
      <MemoryRouter>
        <Palette onAdd={vi.fn()} catalog={{ appId: 'app-1', items: [], onAddRef: vi.fn(), modules: [], onAddModule }} />
      </MemoryRouter>,
    );
    await userEvent.click(within(panel).getByRole('tab', { name: /Módulos/ }));
    expect(panel).toHaveTextContent('Aún no hay módulos');
  });

  it('en el lienzo de un módulo no se ofrecen él mismo ni los que lo contienen', () => {
    const a = { ...usuarios, id: 'a', modules: ['b'] };
    const b = { ...usuarios, id: 'b', modules: [] };
    const c = { ...usuarios, id: 'c', modules: [] };
    expect(placeableModules({ a, b, c }, 'b').map((m) => m.id)).toEqual(['c']);
    expect(placeableModules({ a, b, c }).map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('convertir en módulo', () => {
  function renderDialog(onDone = vi.fn()) {
    const api = installFakeApi({
      apps: [{ id: 'app-1', name: 'Banca', createdAt: '2026-11-01T00:00:00Z', featureCount: 1 }],
      features: [
        { id: 'f-1', appId: 'app-1', name: 'Alta', description: '', createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z' },
      ],
    });
    const store = createGraphStore();
    store.getState().loadGraph({
      schemaVersion: 0,
      version: 0,
      nodes: {
        s: { id: 's', type: 'screen', title: 'Formulario' },
        a: { id: 'a', type: 'api', title: 'POST usuarios', http: { method: 'POST', path: '/usuarios' } },
        d: { id: 'd', type: 'database', title: 'Clientes' },
      },
      edges: {
        r: { id: 'r', from: 's', to: 'a', kind: 'request' },
        w: { id: 'w', from: 'a', to: 'd', kind: 'writes' },
      },
      layout: { s: { x: 0, y: 0 }, a: { x: 300, y: 0 }, d: { x: 600, y: 0 } },
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <GraphStoreProvider store={store}>
          <CatalogContext.Provider value={{ appId: 'app-1', featureId: 'f-1', items: {}, modules: {} }}>
            <ExtractModuleDialog roots={['a']} onClose={vi.fn()} onDone={onDone} />
          </CatalogContext.Provider>
        </GraphStoreProvider>
      </QueryClientProvider>,
    );
    return { api, store, onDone };
  }

  async function goToConfirm() {
    const dialog = screen.getByRole('dialog', { name: 'Convertir en módulo' });
    await userEvent.clear(within(dialog).getByLabelText('Nombre del módulo'));
    await userEvent.type(within(dialog).getByLabelText('Nombre del módulo'), 'Usuarios');
    for (let i = 0; i < 4; i++) await userEvent.click(within(dialog).getByRole('button', { name: 'Siguiente' }));
    return dialog;
  }

  it('si la API falla no cambia nada y reintentar con los mismos ids termina', async () => {
    const { api, store, onDone } = renderDialog();
    api.next.extractStatus = 500;
    const dialog = await goToConfirm();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Convertir en módulo' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('no quedó nada a medias');
    expect(Object.keys(store.getState().nodes).sort()).toEqual(['a', 'd', 's']);
    const first = JSON.parse(String(api.fetchMock.mock.calls.at(-1)![1]!.body)) as { moduleId: string };

    await userEvent.click(within(dialog).getByRole('button', { name: 'Reintentar' }));
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    const second = JSON.parse(String(api.fetchMock.mock.calls.at(-1)![1]!.body)) as { moduleId: string };
    expect(second.moduleId).toBe(first.moduleId);

    // La feature quedó con la caja del módulo, guardada, y el módulo existe con su dependencia.
    const box = Object.values(store.getState().nodes).find((n) => n.type === 'module')!;
    expect(box.moduleId).toBe(first.moduleId);
    expect(store.getState().dirty).toBe(false);
    expect(store.getState().version).toBe(1);
    expect(api.canvases[first.moduleId]!.interfaces).toBeDefined();
    expect(Object.values(api.canvases[first.moduleId]!.interfaces!).map((i) => [i.name, i.kind]).sort()).toEqual([
      ['Clientes', 'requires'],
      ['POST usuarios', 'provides'],
    ]);
  });

  it('con un 409 explica que el lienzo cambió', async () => {
    const { api } = renderDialog();
    api.next.extractStatus = 409;
    const dialog = await goToConfirm();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Convertir en módulo' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('El lienzo cambió');
  });

  it('el nombre es obligatorio y la base de fuera puede incluirse', async () => {
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'Convertir en módulo' });
    await userEvent.clear(within(dialog).getByLabelText('Nombre del módulo'));
    expect(within(dialog).getByText('El nombre es obligatorio.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Siguiente' })).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Nombre del módulo'), 'Usuarios');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Siguiente' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Siguiente' }));
    const clientes = within(dialog).getByRole('radiogroup', { name: 'Qué hacer con Clientes' });
    expect(within(clientes).getByLabelText('Dependencia externa')).toBeChecked();
    await userEvent.click(within(clientes).getByLabelText('Incluir en el módulo'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Siguiente' }));
    expect(within(dialog).queryByLabelText('Nombre de la interfaz de POST usuarios')).toHaveValue('POST usuarios');
    expect(within(dialog).queryByText(/depende de Clientes/)).not.toBeInTheDocument();
  });
});
