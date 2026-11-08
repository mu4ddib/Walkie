import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';
import type { GraphStore } from '../store/graphStore';
import { installFakeApi } from '../test/fakeApi';
import { renderRoute } from '../test/render';
import { SAMPLE_APP_NAME } from './sampleFlow';
import { setLastWorkspace } from './session';

vi.mock('react-oidc-context', () => ({ useAuth: () => ({ user: { access_token: 'token-de-prueba' } }) }));
// Un lienzo mínimo que deja cambiar el store (React Flow no corre bien en jsdom).
vi.mock('../canvas/Canvas', () => ({
  Canvas: ({ store }: { store: StoreApi<GraphStore> }) => (
    <button type="button" aria-label="lienzo" onClick={() => store.getState().addNode('screen', { x: 0, y: 0 })}>
      lienzo
    </button>
  ),
}));

const app = { id: 'app-1', name: 'Banca móvil', createdAt: '2026-01-01T00:00:00Z', featureCount: 1 };
const login = { id: 'feat-1', appId: 'app-1', name: 'Iniciar sesión', createdAt: '2026-01-01T00:00:00Z', description: '', updatedAt: '2026-01-01T00:00:00Z' };
const transferir = { id: 'feat-2', appId: 'app-1', name: 'Transferir', createdAt: '2026-01-01T00:00:00Z', description: '', updatedAt: '2026-01-01T00:00:00Z' };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

const ruta = () => screen.getByRole('navigation', { name: 'Ruta' });

describe('inicio: el lienzo primero (criterio 1)', () => {
  it('abre la última feature de este navegador', async () => {
    installFakeApi({ apps: [app], features: [login, transferir] });
    setLastWorkspace({ appId: 'app-1', featureId: 'feat-2' });

    renderRoute('/');

    expect(await screen.findByRole('button', { name: 'lienzo' })).toBeInTheDocument();
    expect(ruta()).toHaveTextContent('Transferir');
  });

  it('si la última feature ya no existe, abre la primera de esa app', async () => {
    installFakeApi({ apps: [app], features: [login] });
    setLastWorkspace({ appId: 'app-1', featureId: 'borrada' });

    renderRoute('/');

    await screen.findByRole('button', { name: 'lienzo' });
    expect(ruta()).toHaveTextContent('Iniciar sesión');
  });

  it('una app sin features abre su página para crear la primera', async () => {
    installFakeApi({ apps: [app], features: [] });

    renderRoute('/');

    expect(await screen.findByLabelText('Nueva feature')).toBeInTheDocument();
  });
});

describe('primer ingreso (criterio 2)', () => {
  it('crea la app y su primera feature y abre el lienzo', async () => {
    const api = installFakeApi();
    renderRoute('/');

    await screen.findByRole('heading', { name: 'Documenta tu primer flujo' });
    const crear = screen.getByRole('button', { name: 'Crear y abrir el lienzo' });
    expect(crear).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Nombre de la app'), 'Banca móvil');
    await userEvent.type(screen.getByLabelText('Primera feature'), 'Iniciar sesión');
    await userEvent.click(crear);

    await screen.findByRole('button', { name: 'lienzo' });
    expect(ruta()).toHaveTextContent('Banca móvil');
    expect(ruta()).toHaveTextContent('Iniciar sesión');
    expect(api.apps).toHaveLength(1);
  });

  it('"Cargar el ejemplo" crea una app marcada como ejemplo con un flujo y un tour', async () => {
    const api = installFakeApi();
    renderRoute('/');

    await userEvent.click(await screen.findByRole('button', { name: 'Cargar el ejemplo' }));

    await screen.findByRole('button', { name: 'lienzo' });
    expect(api.apps.map((a) => a.name)).toEqual([SAMPLE_APP_NAME]);
    expect(api.features.map((f) => f.name).sort()).toEqual(['Iniciar sesión', 'Transferir']);
    const loginId = api.features.find((f) => f.name === 'Iniciar sesión')!.id;
    const graph = api.canvases[loginId]!;
    expect(Object.values(graph.nodes).map((n) => n.type).sort()).toEqual([
      'actor',
      'api',
      'database',
      'portal',
      'rule',
      'screen',
      'service',
    ]);
    expect(Object.keys(graph.edges)).toHaveLength(5);
    expect(Object.values(graph.tours ?? {})[0]?.steps).toHaveLength(5);
  });
});

describe('cambiar de app y feature desde la barra (criterio 3)', () => {
  it('lista las features y abre otra', async () => {
    installFakeApi({ apps: [app], features: [login, transferir] });
    renderRoute('/apps/app-1/features/feat-1');
    await screen.findByRole('button', { name: 'lienzo' });

    await userEvent.click(within(ruta()).getByRole('button', { name: /Iniciar sesión/ }));
    const menu = screen.getByRole('dialog', { name: 'Cambiar de feature' });
    expect(within(menu).getByRole('link', { name: 'Iniciar sesión' })).toHaveAttribute('aria-current', 'page');
    await userEvent.click(within(menu).getByRole('link', { name: 'Transferir' }));

    expect(await screen.findByText('Transferir', { selector: '.location-feature' })).toBeInTheDocument();
  });

  it('crea una feature sin salir del editor', async () => {
    const api = installFakeApi({ apps: [app], features: [login] });
    renderRoute('/apps/app-1/features/feat-1');
    await screen.findByRole('button', { name: 'lienzo' });

    await userEvent.click(within(ruta()).getByRole('button', { name: /Iniciar sesión/ }));
    const menu = screen.getByRole('dialog', { name: 'Cambiar de feature' });
    await userEvent.type(within(menu).getByLabelText('Nueva feature'), 'Pagos');
    await userEvent.click(within(menu).getByRole('button', { name: '+ Nueva feature' }));

    expect(await screen.findByText('Pagos', { selector: '.location-feature' })).toBeInTheDocument();
    expect(api.features.map((f) => f.name)).toContain('Pagos');
  });

  it('con cambios sin guardar pide confirmar y, si se cancela, se queda', async () => {
    installFakeApi({ apps: [app], features: [login, transferir] });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderRoute('/apps/app-1/features/feat-1');
    await userEvent.click(await screen.findByRole('button', { name: 'lienzo' }));

    await userEvent.click(within(ruta()).getByRole('button', { name: /Iniciar sesión/ }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Cambiar de feature' })).getByRole('link', { name: 'Transferir' }));

    expect(confirm).toHaveBeenCalledWith('Tienes cambios sin guardar. ¿Salir igual?');
    expect(ruta()).toHaveTextContent('Iniciar sesión');
    expect(screen.getByRole('status')).toHaveTextContent('Sin guardar');
  });
});
