import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App, AppMember, CatalogItem, Feature } from '../api/client';
import { APP_ID, ITEMS, SNAPSHOT_ID, SOURCE, evidenceOf, sourcesEntry } from '../test/discoveryFixtures';
import { installFakeApi } from '../test/fakeApi';
import { renderRoute } from '../test/render';

// Autorización por app (spec autorizacion-por-app, ADR-0015): lo que ve cada rol y «Miembros».

vi.mock('react-oidc-context', () => ({
  useAuth: () => ({ user: { access_token: 'token-de-prueba', profile: { sub: 'me' } } }),
}));
// El lienzo real (React Flow) no corre en jsdom: este dice si lo recibió en solo lectura.
vi.mock('../canvas/Canvas', () => ({
  Canvas: ({ catalog }: { catalog?: { readOnly?: boolean } }) => (
    <div>{catalog?.readOnly ? 'lienzo de solo lectura' : 'lienzo editable'}</div>
  ),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const app = (role: App['role']): App => ({ id: 'app-1', name: 'Banca móvil', createdAt: '2026-01-01T00:00:00Z', featureCount: 1, role });
const feature: Feature = {
  id: 'feat-1',
  appId: 'app-1',
  name: 'Iniciar sesión',
  description: '',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};
const item: CatalogItem = { id: 'cat-1', appId: 'app-1', type: 'api', title: 'Consultar saldo', version: 1 };
const module: Feature = { ...feature, id: 'mod-1', name: 'Usuarios' };
const since = '2026-01-01T00:00:00Z';
const team = (): AppMember[] => [
  { userId: 'me', name: 'Yo', email: 'yo@walkie.test', role: 'owner', grantedAt: since },
  { userId: 'ana', name: 'Ana', email: 'ana@walkie.test', role: 'viewer', grantedAt: since },
];

describe('un viewer', () => {
  it('ve la galería sin crear, editar ni importar, y exportar sigue', async () => {
    installFakeApi({ apps: [app('viewer')], features: [feature] });
    renderRoute('/apps/app-1');

    expect(await screen.findByRole('note')).toHaveTextContent('Tu rol en esta app es «viewer»');
    expect(screen.getByRole('link', { name: 'Iniciar sesión' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Nueva feature')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Importar feature' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar Iniciar sesión' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Exportar app (.walkie)' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Contexto para IA' })).toBeInTheDocument();
  });

  it('abre el lienzo en solo lectura: sin guardar ni compartir, con exportar', async () => {
    installFakeApi({ apps: [app('viewer')], features: [feature] });
    renderRoute('/apps/app-1/features/feat-1');

    expect(await screen.findByText('lienzo de solo lectura')).toBeInTheDocument();
    expect(document.querySelector('.save-status')).toHaveTextContent('Solo lectura');
    expect(screen.queryByRole('button', { name: /^Guardar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Compartir' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Exportar/ })).toBeInTheDocument();
  });

  it('ve el catálogo con los campos deshabilitados, sin crear ni borrar', async () => {
    installFakeApi({ apps: [app('viewer')], catalog: [item], modules: [module] });
    renderRoute('/apps/app-1/catalog/cat-1');

    const detail = await screen.findByRole('complementary', { name: 'Detalle del elemento' });
    expect(await within(detail).findByLabelText('Título')).toBeDisabled();
    expect(within(detail).queryByRole('button', { name: 'Guardar' })).not.toBeInTheDocument();
    expect(within(detail).queryByRole('button', { name: 'Borrar elemento' })).not.toBeInTheDocument();
    const modules = screen.getByRole('region', { name: 'Módulos' });
    expect(await within(modules).findByRole('link', { name: 'Usuarios' })).toBeInTheDocument();
    expect(within(modules).queryByRole('button', { name: 'Eliminar' })).not.toBeInTheDocument();
    expect(within(modules).queryByRole('button', { name: /Crear módulo|Nuevo módulo/ })).not.toBeInTheDocument();
  });

  it('revisa un análisis sin poder decidir', async () => {
    installFakeApi({
      apps: [{ ...app('viewer'), id: APP_ID }],
      discovery: {
        sources: { [APP_ID]: [sourcesEntry()] },
        reviews: { [SNAPSHOT_ID]: { sourceId: SOURCE.id, items: ITEMS } },
        evidence: Object.fromEntries(ITEMS.map((i) => [`${SNAPSHOT_ID}|${i.key}`, evidenceOf(i.key)])),
      },
    });
    renderRoute(`/apps/${APP_ID}/sources/${SNAPSHOT_ID}`);
    await userEvent.click(
      within(await screen.findByRole('list', { name: 'Hallazgos' })).getByRole('button', { name: /onerror/ }),
    );

    const inspector = screen.getByRole('complementary', { name: 'Detalle del hallazgo' });
    expect(inspector).toHaveTextContent('puedes revisar, no decidir');
    expect(within(inspector).queryByRole('button', { name: 'Descartar…' })).not.toBeInTheDocument();
  });
});

describe('un editor', () => {
  it('crea y edita, pero no borra ni comparte', async () => {
    installFakeApi({ apps: [app('editor')], features: [feature], catalog: [item] });
    renderRoute('/apps/app-1/features/feat-1');

    expect(await screen.findByText('lienzo editable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Guardar/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Compartir' })).not.toBeInTheDocument();
  });

  it('en el catálogo guarda pero no borra', async () => {
    installFakeApi({ apps: [app('editor')], catalog: [item] });
    renderRoute('/apps/app-1/catalog/cat-1');

    const detail = await screen.findByRole('complementary', { name: 'Detalle del elemento' });
    expect(await within(detail).findByLabelText('Título')).toBeEnabled();
    expect(within(detail).getByRole('button', { name: 'Guardar' })).toBeInTheDocument();
    expect(within(detail).queryByRole('button', { name: 'Borrar elemento' })).not.toBeInTheDocument();
  });
});

describe('«Miembros»', () => {
  async function open(role: App['role'], members = team()) {
    const api = installFakeApi({
      apps: [app(role)],
      members: { 'app-1': members },
      known: [{ userId: 'beto', name: 'Beto', email: 'beto@walkie.test' }],
    });
    renderRoute('/apps/app-1');
    await userEvent.click(await screen.findByRole('button', { name: 'Miembros' }));
    const dialog = screen.getByRole('dialog', { name: 'Miembros' });
    await within(dialog).findByRole('list', { name: 'Miembros de la app' });
    return { api, dialog };
  }

  it('el owner agrega por correo a alguien que ya entró y avisa si nunca entró', async () => {
    const { api, dialog } = await open('owner');

    await userEvent.type(within(dialog).getByLabelText('Correo'), 'nadie@walkie.test');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Agregar' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('todavía no entró a Walkie');

    await userEvent.clear(within(dialog).getByLabelText('Correo'));
    await userEvent.type(within(dialog).getByLabelText('Correo'), 'Beto@walkie.test');
    await userEvent.selectOptions(within(dialog).getByLabelText('Rol'), 'editor');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Agregar' }));

    expect(await within(dialog).findByText('Beto')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Rol de Beto')).toHaveValue('editor');
    expect(api.members['app-1']!.map((m) => m.userId)).toEqual(['me', 'ana', 'beto']);
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('el owner cambia un rol y quita a alguien', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { api, dialog } = await open('owner');

    await userEvent.selectOptions(within(dialog).getByLabelText('Rol de Ana'), 'editor');
    await waitFor(() => expect(api.members['app-1']![1]!.role).toBe('editor'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Quitar a Ana' }));

    await waitFor(() => expect(within(dialog).queryByText('Ana')).not.toBeInTheDocument());
    expect(api.members['app-1']!.map((m) => m.userId)).toEqual(['me']);
  });

  it('no deja a la app sin owner: el aviso dice por qué', async () => {
    const { dialog } = await open('owner');

    await userEvent.selectOptions(within(dialog).getByLabelText('Rol de Yo'), 'viewer');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('al menos un owner');
  });

  it('un viewer ve la lista sin administrar y puede salir de la app', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const members = team().map((m) => (m.userId === 'me' ? { ...m, role: 'viewer' as const } : { ...m, role: 'owner' as const }));
    const { api, dialog } = await open('viewer', members);

    expect(within(dialog).queryByLabelText('Correo')).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Rol de Ana')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Quitar a Ana' })).not.toBeInTheDocument();
    expect(within(dialog).getByText('(tú)', { exact: false })).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Salir de la app' }));
    expect(await screen.findByRole('heading', { name: 'Aún no hay apps' })).toBeInTheDocument();
    expect(api.apps).toHaveLength(0);
  });
});

describe('sin acceso', () => {
  it('una app ajena (404) dice que no hay acceso, sin pantallas rotas', async () => {
    installFakeApi();
    renderRoute('/apps/de-otro/catalog');

    expect(await screen.findByRole('alert')).toHaveTextContent('No tienes acceso a esta app');
  });

  it('un 403 muestra el motivo de la API', async () => {
    const api = installFakeApi({ apps: [app('owner')] });
    const original = api.fetchMock.getMockImplementation()!;
    api.fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith('/api/apps/app-1/modules')
        ? new Response(JSON.stringify({ title: 'Tu rol en esta app no permite esta acción.', status: 403 }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          })
        : original(input, init),
    );
    renderRoute('/apps/app-1/catalog');

    const modules = await screen.findByRole('region', { name: 'Módulos' });
    expect(await within(modules).findByRole('alert')).toHaveTextContent('Tu rol en esta app no permite esta acción.');
  });
});
