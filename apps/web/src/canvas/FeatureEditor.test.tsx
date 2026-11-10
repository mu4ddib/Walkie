import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { WalkieCanvasGraphV0 } from '../schema/walkie-graph';
import type { GraphStore } from '../store/graphStore';
import { installFakeApi } from '../test/fakeApi';
import { AUTOSAVE_DELAY_MS } from './FeatureEditor';
import { renderRoute } from '../test/render';

vi.mock('react-oidc-context', () => ({ useAuth: () => ({ user: { access_token: 'token-de-prueba' } }) }));

// React Flow no corre bien en jsdom: un lienzo mínimo que muestra los títulos y edita por el store.
vi.mock('./Canvas', () => ({
  Canvas: ({ store }: { store: StoreApi<GraphStore> }) => {
    const nodes = useStore(store, (s) => s.nodes);
    return (
      <div aria-label="lienzo">
        <ul>
          {Object.values(nodes).map((n) => (
            <li key={n.id}>{n.title}</li>
          ))}
        </ul>
        <button type="button" onClick={() => store.getState().addNode('screen', { x: 0, y: 0 })}>
          agregar pantalla
        </button>
      </div>
    );
  },
}));

const app = { id: 'app-1', name: 'Banca móvil', createdAt: '2026-01-01T00:00:00Z', featureCount: 1 };
const feature = { id: 'feat-1', appId: 'app-1', name: 'Iniciar sesión', createdAt: '2026-01-01T00:00:00Z', description: '', updatedAt: '2026-01-01T00:00:00Z' };
const saved: WalkieCanvasGraphV0 = {
  schemaVersion: 0,
  version: 3,
  nodes: { n1: { id: 'n1', type: 'screen', title: 'Login' } },
  edges: {},
  layout: { n1: { x: 0, y: 0 } },
};

afterEach(() => vi.unstubAllGlobals());

async function openEditor(canvases: Record<string, WalkieCanvasGraphV0> = {}) {
  const api = installFakeApi({ apps: [app], features: [feature], canvases });
  renderRoute('/apps/app-1/features/feat-1');
  await screen.findByLabelText('lienzo');
  return api;
}

const saveButton = () => screen.getByRole('button', { name: /Guardar|Guardando/ });
// El estado de guardado (hay otro `role="status"`: el de la API).
const status = () => document.querySelector('.save-status') as HTMLElement;

describe('carga', () => {
  it('muestra el grafo guardado, sin cambios pendientes', async () => {
    await openEditor({ 'feat-1': saved });

    expect(screen.getByText('Login')).toBeInTheDocument();
    expect(status()).toHaveTextContent('Al día');
    expect(saveButton()).toBeDisabled();
  });
});

describe('guardar', () => {
  it('marca "Sin guardar", envía la versión cargada y adopta la nueva', async () => {
    const api = await openEditor({ 'feat-1': saved });

    await userEvent.click(screen.getByRole('button', { name: 'agregar pantalla' }));
    expect(status()).toHaveTextContent('Sin guardar');
    await userEvent.click(saveButton());

    expect(await screen.findByText('Guardado')).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    expect(api.canvases['feat-1']?.version).toBe(4);
    expect(Object.keys(api.canvases['feat-1']!.nodes)).toHaveLength(2);

    // Un segundo guardado usa la versión nueva (si usara la vieja, la API respondería 409).
    await userEvent.click(screen.getByRole('button', { name: 'agregar pantalla' }));
    await userEvent.click(saveButton());
    expect(await screen.findByText('Guardado')).toBeInTheDocument();
    expect(api.canvases['feat-1']?.version).toBe(5);
  });

  it('Ctrl+S guarda', async () => {
    const api = await openEditor();

    await userEvent.click(screen.getByRole('button', { name: 'agregar pantalla' }));
    await userEvent.keyboard('{Control>}s{/Control}');

    expect(await screen.findByText('Guardado')).toBeInTheDocument();
    expect(api.canvases['feat-1']?.version).toBe(1);
  });

  it('con una versión vieja (409) ofrece recargar la del servidor', async () => {
    const api = await openEditor({ 'feat-1': saved });
    // Otra pestaña guarda primero.
    act(() => {
      api.canvases['feat-1'] = { ...saved, version: 4, nodes: { n1: { id: 'n1', type: 'screen', title: 'Login v2' } } };
    });

    await userEvent.click(screen.getByRole('button', { name: 'agregar pantalla' }));
    await userEvent.click(saveButton());

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('versión 4');
    expect(status()).toHaveTextContent('Sin guardar');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Recargar versión del servidor' }));

    expect(await screen.findByText('Login v2')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(status()).toHaveTextContent('Al día');
  });

  it('"Seguir editando" cierra el aviso sin perder los cambios', async () => {
    const api = await openEditor({ 'feat-1': saved });
    api.canvases['feat-1'] = { ...saved, version: 9 };

    await userEvent.click(screen.getByRole('button', { name: 'agregar pantalla' }));
    await userEvent.click(saveButton());
    await userEvent.click(await screen.findByRole('button', { name: 'Seguir editando' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getAllByText('Pantalla')).toHaveLength(1);
    expect(status()).toHaveTextContent('Sin guardar');
  });

  it('si la API rechaza el grafo (400) muestra el motivo', async () => {
    const api = await openEditor();
    api.next.putStatus = 400;

    await userEvent.click(screen.getByRole('button', { name: 'agregar pantalla' }));
    await userEvent.click(saveButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('La conexión apunta a un nodo que no existe.');
    expect(status()).toHaveTextContent('Error al guardar');

    // Los cambios siguen pendientes y "Reintentar" los guarda.
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Guardado')).toBeInTheDocument();
    expect(Object.keys(api.canvases['feat-1']!.nodes)).toHaveLength(1);
  });

  it('una respuesta de guardado no marca como guardado lo que cambió mientras viajaba', async () => {
    const api = await openEditor({ 'feat-1': saved });
    // El PUT queda en el aire hasta que la prueba lo suelta.
    const real = globalThis.fetch;
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    vi.stubGlobal('fetch', async (...args: Parameters<typeof fetch>) => {
      if (args[1]?.method === 'PUT') await held;
      return real(...args);
    });

    await userEvent.click(screen.getByRole('button', { name: 'agregar pantalla' }));
    await userEvent.click(saveButton());
    expect(status()).toHaveTextContent('Guardando');
    // Un cambio más reciente, hecho con el guardado anterior en curso.
    await userEvent.click(screen.getByRole('button', { name: 'agregar pantalla' }));
    await act(async () => {
      release();
      await held;
    });

    await waitFor(() => expect(api.canvases['feat-1']?.version).toBe(4));
    expect(Object.keys(api.canvases['feat-1']!.nodes)).toHaveLength(2);
    await waitFor(() => expect(status()).toHaveTextContent('Sin guardar'));

    // El siguiente guardado lleva el cambio pendiente con la versión nueva.
    vi.stubGlobal('fetch', real);
    await userEvent.click(saveButton());
    await waitFor(() => expect(api.canvases['feat-1']?.version).toBe(5));
    expect(Object.keys(api.canvases['feat-1']!.nodes)).toHaveLength(3);
    expect(status()).toHaveTextContent('Guardado');
  });
});

describe('autoguardado', () => {
  afterEach(() => localStorage.clear());

  it('está apagado por defecto: sin Guardar, el cambio queda pendiente', async () => {
    const api = await openEditor({ 'feat-1': saved });

    await userEvent.click(screen.getByRole('button', { name: 'agregar pantalla' }));
    await new Promise((resolve) => setTimeout(resolve, AUTOSAVE_DELAY_MS + 300));

    expect(status()).toHaveTextContent('Sin guardar');
    expect(api.canvases['feat-1']?.version).toBe(3);
  });

  it('se activa desde el estado de guardado, guarda tras una pausa y se recuerda', async () => {
    const api = await openEditor({ 'feat-1': saved });

    await userEvent.click(screen.getByRole('button', { name: /Al día/ }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Opciones de guardado' })).getByLabelText('Autoguardado'));
    expect(localStorage.getItem('walkie.autosave')).toBe('true');

    await userEvent.click(screen.getByRole('button', { name: 'agregar pantalla' }));
    expect(status()).toHaveTextContent('Sin guardar');
    await waitFor(() => expect(api.canvases['feat-1']?.version).toBe(4), { timeout: AUTOSAVE_DELAY_MS + 2000 });
    await waitFor(() => expect(status()).toHaveTextContent('Guardado'));
    // El botón Guardar sigue ahí (ya sin nada pendiente).
    expect(saveButton()).toBeDisabled();
  });

  it('si falla, conserva los cambios y deja reintentar', async () => {
    localStorage.setItem('walkie.autosave', 'true');
    const api = await openEditor({ 'feat-1': saved });
    api.next.putStatus = 400;

    await userEvent.click(screen.getByRole('button', { name: 'agregar pantalla' }));
    await waitFor(() => expect(status()).toHaveTextContent('Error al guardar'), { timeout: AUTOSAVE_DELAY_MS + 2000 });
    expect(api.canvases['feat-1']?.version).toBe(3);
    expect(screen.getAllByText('Pantalla')).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(api.canvases['feat-1']?.version).toBe(4));
    expect(status()).toHaveTextContent('Guardado');
  });
});
