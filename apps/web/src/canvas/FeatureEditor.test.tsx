import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { WalkieCanvasGraphV0 } from '../schema/walkie-graph';
import type { GraphStore } from '../store/graphStore';
import { installFakeApi } from '../test/fakeApi';
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
const status = () => screen.getByText(/Sin guardar|Guardado|Al día/);

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
    expect(status()).toHaveTextContent('Sin guardar');
  });
});
