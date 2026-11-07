import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CatalogItem } from '../api/client';
import { installFakeApi } from '../test/fakeApi';
import { renderRoute } from '../test/render';

vi.mock('react-oidc-context', () => ({ useAuth: () => ({ user: { access_token: 'token-de-prueba' } }) }));

const app = { id: 'app-1', name: 'Banca móvil', createdAt: '2026-01-01T00:00:00Z' };
const transferir = { id: 'feat-1', appId: 'app-1', name: 'Transferir', createdAt: '2026-01-01T00:00:00Z' };
const consultar: CatalogItem = {
  id: 'item-1',
  appId: 'app-1',
  type: 'api',
  title: 'Consultar cliente',
  http: { method: 'GET', path: '/clientes/{id}' },
  version: 1,
};
const clientes: CatalogItem = { id: 'item-2', appId: 'app-1', type: 'database', title: 'Clientes', version: 1 };
const refTo = (catalogId: string) => ({
  schemaVersion: 0 as const,
  version: 1,
  nodes: { r1: { id: 'r1', type: 'ref' as const, title: 'x', catalogId } },
  edges: {},
  layout: {},
});

afterEach(() => vi.unstubAllGlobals());

describe('catálogo de la app', () => {
  it('se enlaza desde la app y agrupa por tipo con MÉTODO /ruta', async () => {
    installFakeApi({ apps: [app], catalog: [clientes, consultar] });
    renderRoute('/apps/app-1');

    await userEvent.click(await screen.findByRole('link', { name: 'Catálogo de la app' }));

    const apis = await screen.findByRole('region', { name: 'API' });
    expect(within(apis).getByRole('listitem')).toHaveTextContent('Consultar cliente GET /clientes/{id}');
    expect(within(screen.getByRole('region', { name: 'Base de datos' })).getByRole('listitem')).toHaveTextContent(
      'Clientes',
    );
    expect(screen.queryByRole('region', { name: 'Servicio' })).not.toBeInTheDocument();
  });

  it('crea un elemento, abre su detalle y no envía un título vacío', async () => {
    const api = installFakeApi({ apps: [app] });
    renderRoute('/apps/app-1/catalog');
    await screen.findByText('El catálogo está vacío. Crea el primer elemento.');
    const form = screen.getByRole('form', { name: 'Nuevo elemento' });

    await userEvent.click(within(form).getByRole('button', { name: 'Crear elemento' }));
    expect(within(form).getByRole('alert')).toHaveTextContent('El título es obligatorio.');

    await userEvent.selectOptions(within(form).getByLabelText('Tipo'), 'service');
    await userEvent.type(within(form).getByLabelText('Título'), 'Notificaciones');
    await userEvent.click(within(form).getByRole('button', { name: 'Crear elemento' }));

    const detail = await screen.findByRole('complementary', { name: 'Detalle del elemento' });
    expect(await within(detail).findByLabelText('Título')).toHaveValue('Notificaciones');
    expect(within(detail).queryByLabelText('Método')).not.toBeInTheDocument();
    expect(api.catalog).toEqual([
      { id: expect.any(String), appId: 'app-1', type: 'service', title: 'Notificaciones', version: 1 },
    ]);
  });

  it('edita y guarda una API; con versión vieja ofrece recargar', async () => {
    const api = installFakeApi({ apps: [app], catalog: [consultar] });
    renderRoute('/apps/app-1/catalog/item-1');
    const detail = await screen.findByRole('complementary', { name: 'Detalle del elemento' });

    const title = await within(detail).findByLabelText('Título');
    await userEvent.clear(title);
    await userEvent.type(title, 'Buscar cliente');
    await userEvent.selectOptions(within(detail).getByLabelText('Método'), 'POST');
    await userEvent.click(within(detail).getByRole('button', { name: 'Guardar' }));

    expect(await within(detail).findByText('Guardado')).toBeInTheDocument();
    expect(api.catalog[0]).toMatchObject({ title: 'Buscar cliente', http: { method: 'POST' }, version: 2 });
    expect(await screen.findByRole('link', { name: 'Buscar cliente' })).toBeInTheDocument();

    // Otra persona guarda la versión 3 mientras tanto.
    api.catalog[0] = { ...api.catalog[0]!, title: 'Cliente por documento', version: 3 };
    await userEvent.type(within(detail).getByLabelText('Descripción'), 'Por documento');
    await userEvent.click(within(detail).getByRole('button', { name: 'Guardar' }));

    const conflict = await within(detail).findByRole('alertdialog');
    await userEvent.click(within(conflict).getByRole('button', { name: 'Recargar versión del servidor' }));
    expect(await within(detail).findByDisplayValue('Cliente por documento')).toBeInTheDocument();
    expect(within(detail).queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('muestra dónde se usa y no borra un elemento en uso', async () => {
    installFakeApi({
      apps: [app],
      features: [transferir],
      catalog: [consultar],
      canvases: { 'feat-1': refTo('item-1') },
    });
    renderRoute('/apps/app-1/catalog/item-1');

    const usages = await screen.findByRole('region', { name: 'Usado en' });
    expect(await within(usages).findByRole('link', { name: 'Transferir' })).toHaveAttribute(
      'href',
      '/apps/app-1/features/feat-1',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Borrar elemento' }));
    const alert = await screen.findByText(/No se puede borrar/);
    expect(within(alert.parentElement!).getByRole('link', { name: 'Transferir' })).toBeInTheDocument();
  });

  it('borra un elemento sin uso y vuelve a la lista', async () => {
    const api = installFakeApi({ apps: [app], catalog: [clientes] });
    renderRoute('/apps/app-1/catalog/item-2');

    expect(await screen.findByText('No se usa en ningún lienzo.')).toBeInTheDocument();
    await act(() => userEvent.click(screen.getByRole('button', { name: 'Borrar elemento' })));

    expect(await screen.findByText('El catálogo está vacío. Crea el primer elemento.')).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Detalle del elemento' })).not.toBeInTheDocument();
    expect(api.catalog).toEqual([]);
  });

  it('un elemento inexistente lo dice', async () => {
    installFakeApi({ apps: [app] });
    renderRoute('/apps/app-1/catalog/nada');

    expect(await screen.findByText('Este elemento no existe.')).toBeInTheDocument();
  });
});
