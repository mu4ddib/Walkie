import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFakeApi } from '../test/fakeApi';
import { renderRoute } from '../test/render';
import type { WalkieCanvasGraphV0 } from '../schema/walkie-graph';

vi.mock('react-oidc-context', () => ({ useAuth: () => ({ user: { access_token: 'token-de-prueba' } }) }));

const app = { id: 'app-1', name: 'Banca móvil', createdAt: '2026-01-01T00:00:00Z', featureCount: 0 };
const otra = { id: 'app-2', name: 'Seguros', createdAt: '2026-01-01T00:00:00Z', featureCount: 0 };
const feature = (id: string, name: string, description = '', updatedAt = '2026-01-01T00:00:00Z') => ({
  id,
  appId: 'app-1',
  name,
  description,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt,
});
const login = feature('feat-1', 'Iniciar sesión', 'Entrar con usuario y clave', '2026-03-01T00:00:00Z');
const transferir = feature('feat-2', 'Transferir', '', '2026-02-01T00:00:00Z');
const ahorro = feature('feat-3', 'Abrir ahorro', 'Cuenta de ahorro nueva', '2026-01-15T00:00:00Z');

/** Dos cajas conectadas y una sin posición (datos ficticios). */
const graph: WalkieCanvasGraphV0 = {
  schemaVersion: 0,
  version: 1,
  nodes: {
    s1: { id: 's1', type: 'screen', title: 'Monto' },
    a1: { id: 'a1', type: 'api', title: 'POST /transferencias' },
    r1: { id: 'r1', type: 'rule', title: 'Límite diario' },
  },
  edges: { e1: { id: 'e1', from: 's1', to: 'a1', kind: 'request' } },
  layout: { s1: { x: 0, y: 0 }, a1: { x: 320, y: 0 } },
};

afterEach(() => vi.unstubAllGlobals());

describe('galería de apps', () => {
  it('muestra cada app con su cantidad de features y filtra por nombre', async () => {
    installFakeApi({ apps: [app, otra], features: [login, transferir] });
    renderRoute('/apps');

    const list = await screen.findByRole('list', { name: 'Apps' });
    expect(within(list).getByRole('link', { name: 'Banca móvil' }).closest('li')).toHaveTextContent('2 features');
    expect(within(list).getByRole('link', { name: 'Seguros' }).closest('li')).toHaveTextContent('0 features');

    await userEvent.type(screen.getByLabelText('Buscar apps'), 'segur');
    expect(within(list).queryByRole('link', { name: 'Banca móvil' })).not.toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Buscar apps'));
    await userEvent.type(screen.getByLabelText('Buscar apps'), 'nada');
    expect(screen.getByText('Ninguna app coincide con “nada”.')).toBeInTheDocument();
  });

  it('sin apps explica qué es una app y ofrece el ejemplo', async () => {
    installFakeApi();
    renderRoute('/apps');

    const empty = (await screen.findByRole('heading', { name: 'Aún no hay apps' })).parentElement!;
    expect(empty).toHaveTextContent('Una app agrupa los flujos de un producto');
    expect(within(empty).getByRole('button', { name: 'Cargar el ejemplo' })).toBeEnabled();
  });
});

describe('galería de features', () => {
  it('muestra miniatura real, descripción y fecha de cada feature', async () => {
    installFakeApi({ apps: [app], features: [login, transferir], canvases: { 'feat-2': graph } });
    renderRoute('/apps/app-1');

    const list = await screen.findByRole('list', { name: 'Features' });
    const card = within(list).getByRole('link', { name: 'Transferir' }).closest('li')!;
    expect(await within(card).findByRole('img', { name: 'Vista previa: 2 cajas y 1 conexión' })).toBeInTheDocument();
    expect(within(card).getByText('Sin descripción')).toBeInTheDocument();
    // La fecha del lienzo guardado (8 nov 2026) gana a la de la feature.
    expect(within(card).getByText('8 nov 2026')).toHaveAttribute('datetime', '2026-11-08T00:00:00.000Z');

    const loginCard = within(list).getByRole('link', { name: 'Iniciar sesión' }).closest('li')!;
    expect(within(loginCard).getByRole('img', { name: 'Lienzo vacío' })).toBeInTheDocument();
    expect(loginCard).toHaveTextContent('Entrar con usuario y clave');
  });

  it('ordena por fecha o por nombre y busca también en la descripción', async () => {
    installFakeApi({ apps: [app], features: [ahorro, transferir, login] });
    renderRoute('/apps/app-1');

    const list = await screen.findByRole('list', { name: 'Features' });
    const names = () => within(list).getAllByRole('link').map((a) => a.textContent);
    expect(names()).toEqual(['Iniciar sesión', 'Transferir', 'Abrir ahorro']);

    await userEvent.selectOptions(screen.getByLabelText('Ordenar'), 'name');
    expect(names()).toEqual(['Abrir ahorro', 'Iniciar sesión', 'Transferir']);

    await userEvent.type(screen.getByLabelText('Buscar features'), 'cuenta');
    expect(names()).toEqual(['Abrir ahorro']);
  });

  it('renombra una feature y edita su descripción desde su tarjeta', async () => {
    const api = installFakeApi({ apps: [app], features: [transferir] });
    renderRoute('/apps/app-1');

    await userEvent.click(await screen.findByRole('button', { name: 'Editar Transferir' }));
    const form = screen.getByRole('form', { name: 'Editar Transferir' });
    await userEvent.clear(within(form).getByLabelText('Nombre'));
    await userEvent.type(within(form).getByLabelText('Nombre'), 'Transferir a terceros');
    await userEvent.type(within(form).getByLabelText('Descripción'), 'A cuentas de otros bancos');
    await userEvent.click(within(form).getByRole('button', { name: 'Guardar' }));

    const list = screen.getByRole('list', { name: 'Features' });
    expect(await within(list).findByRole('link', { name: 'Transferir a terceros' })).toBeInTheDocument();
    expect(list).toHaveTextContent('A cuentas de otros bancos');
    expect(api.features[0]).toMatchObject({ name: 'Transferir a terceros', description: 'A cuentas de otros bancos' });
  });

  it('no guarda un nombre vacío y Escape cancela', async () => {
    const api = installFakeApi({ apps: [app], features: [transferir] });
    renderRoute('/apps/app-1');

    await userEvent.click(await screen.findByRole('button', { name: 'Editar Transferir' }));
    const form = screen.getByRole('form', { name: 'Editar Transferir' });
    await userEvent.clear(within(form).getByLabelText('Nombre'));
    await userEvent.click(within(form).getByRole('button', { name: 'Guardar' }));
    expect(within(form).getByRole('alert')).toHaveTextContent('El nombre es obligatorio.');
    expect(api.fetchMock).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: 'PUT' }));

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('form', { name: 'Editar Transferir' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Transferir' })).toBeInTheDocument();
  });

  it('sin features explica qué es una feature', async () => {
    installFakeApi({ apps: [app] });
    renderRoute('/apps/app-1');

    const empty = (await screen.findByRole('heading', { name: 'Aún no hay features' })).parentElement!;
    expect(empty).toHaveTextContent('documenta un flujo con un solo objetivo');
  });
});
