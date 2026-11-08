import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeApi } from '../test/fakeApi';
import { renderRoute } from '../test/render';

vi.mock('react-oidc-context', () => ({ useAuth: () => ({ user: { access_token: 'token-de-prueba' } }) }));
// El lienzo (React Flow) no hace falta para probar la navegación.
vi.mock('../canvas/Canvas', () => ({ Canvas: () => <div>lienzo</div> }));

const app = { id: 'app-1', name: 'Banca móvil', createdAt: '2026-01-01T00:00:00Z' };
const feature = { id: 'feat-1', appId: 'app-1', name: 'Iniciar sesión', createdAt: '2026-01-01T00:00:00Z' };

afterEach(() => vi.unstubAllGlobals());

describe('lista de apps (/apps)', () => {
  beforeEach(() => installFakeApi());

  it('muestra el estado vacío y crea una app que aparece en la lista', async () => {
    renderRoute('/apps');

    expect(await screen.findByText('Aún no hay apps. Crea la primera.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Nueva app'), '  Banca móvil  ');
    await userEvent.click(screen.getByRole('button', { name: 'Crear app' }));

    const list = await screen.findByRole('list', { name: 'Apps' });
    expect(within(list).getByRole('link', { name: 'Banca móvil' })).toHaveAttribute('href', expect.stringMatching(/^\/apps\//));
    expect(screen.getByLabelText('Nueva app')).toHaveValue('');
  });

  it('no envía un nombre vacío', async () => {
    const api = installFakeApi();
    renderRoute('/apps');
    await screen.findByText('Aún no hay apps. Crea la primera.');

    await userEvent.type(screen.getByLabelText('Nueva app'), '   ');
    await userEvent.click(screen.getByRole('button', { name: 'Crear app' }));

    expect(screen.getByRole('alert')).toHaveTextContent('El nombre es obligatorio.');
    expect(api.fetchMock).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: 'POST' }));
  });

  it('envía el token en cada petición', async () => {
    const api = installFakeApi();
    renderRoute('/apps');
    await screen.findByText('Aún no hay apps. Crea la primera.');

    const [, init] = api.fetchMock.mock.calls[0]!;
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer token-de-prueba' });
  });
});

describe('detalle de app', () => {
  it('lista sus features y crea una nueva', async () => {
    installFakeApi({ apps: [app], features: [feature] });
    renderRoute('/apps/app-1');

    expect(await screen.findByRole('heading', { name: 'Banca móvil' })).toBeInTheDocument();
    const list = await screen.findByRole('list', { name: 'Features' });
    expect(within(list).getByRole('link', { name: 'Iniciar sesión' })).toHaveAttribute(
      'href',
      '/apps/app-1/features/feat-1',
    );

    await userEvent.type(screen.getByLabelText('Nueva feature'), 'Transferir');
    await userEvent.click(screen.getByRole('button', { name: 'Crear feature' }));

    expect(await within(list).findByRole('link', { name: 'Transferir' })).toBeInTheDocument();
  });

  it('avisa si la app no existe', async () => {
    installFakeApi();
    renderRoute('/apps/no-existe');

    expect(await screen.findByRole('alert')).toHaveTextContent('Esta app no existe.');
  });
});

describe('lienzo de la feature', () => {
  it('muestra la ruta y el lienzo', async () => {
    installFakeApi({ apps: [app], features: [feature] });
    renderRoute('/apps/app-1/features/feat-1');

    expect(await screen.findByText('lienzo')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Ruta' });
    expect(within(nav).getByRole('button', { name: /Banca móvil/ })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: /Iniciar sesión/ })).toBeInTheDocument();
  });

  it('avisa si la feature no existe', async () => {
    installFakeApi({ apps: [app], features: [feature] });
    renderRoute('/apps/app-1/features/otra');

    expect(await screen.findByRole('alert')).toHaveTextContent('Esta feature no existe.');
  });
});

it('ruta desconocida muestra página no encontrada', () => {
  installFakeApi();
  renderRoute('/cualquier/cosa');

  expect(screen.getByRole('alert')).toHaveTextContent('Página no encontrada.');
});
