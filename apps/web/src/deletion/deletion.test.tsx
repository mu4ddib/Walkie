import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App, Feature } from '../api/client';
import type { WalkieCanvasGraphV0 } from '../schema/walkie-graph';
import { installFakeApi } from '../test/fakeApi';
import { renderRoute } from '../test/render';

vi.mock('react-oidc-context', () => ({ useAuth: () => ({ user: { access_token: 'token-de-prueba' } }) }));
vi.mock('../canvas/Canvas', () => ({ Canvas: () => <div>lienzo</div> }));

/** Eliminar features y apps desde la interfaz (spec eliminar-apps-y-features, ADR-0017). */
const app: App = { id: 'app-1', name: 'Banca móvil', createdAt: '2026-01-01T00:00:00Z', featureCount: 2 };
const feature = (id: string, name: string): Feature => ({
  id,
  appId: 'app-1',
  name,
  description: '',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});
const canvas: WalkieCanvasGraphV0 = {
  schemaVersion: 0,
  version: 3,
  nodes: {
    a: { id: 'a', type: 'screen', title: 'Lista' },
    b: { id: 'b', type: 'screen', title: 'Detalle' },
  },
  edges: { e: { id: 'e', from: 'a', to: 'b', kind: 'navigation' } },
  layout: { a: { x: 0, y: 0 }, b: { x: 300, y: 0 } },
  tours: { t: { id: 't', name: 'Guía', kind: 'guide', steps: [{ id: 's', nodeId: 'a' }] } },
};

afterEach(() => vi.unstubAllGlobals());

async function openGallery(seed: Parameters<typeof installFakeApi>[0]) {
  const api = installFakeApi(seed);
  renderRoute('/apps/app-1');
  await screen.findByRole('list', { name: 'Features' });
  return api;
}

describe('eliminar una feature', () => {
  it('el owner ve el impacto, confirma y la feature desaparece de la galería sin recargar', async () => {
    const api = await openGallery({
      apps: [app],
      features: [feature('f-1', 'Iniciar sesión'), feature('f-2', 'Transferir')],
      canvases: { 'f-1': canvas },
      shares: [{ id: 'sh-1', featureId: 'f-1', createdAt: '2026-01-01T00:00:00Z', expiresAt: '2027-01-01T00:00:00Z', createdBy: 'Yo' } as never],
    });
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar Iniciar sesión' }));

    const dialog = await screen.findByRole('dialog', { name: 'Eliminar «Iniciar sesión»' });
    const facts = await within(dialog).findByRole('list', { name: 'Qué se pierde' });
    expect(facts).toHaveTextContent('Su lienzo: 2 cajas y 1 conexión.');
    expect(facts).toHaveTextContent('1 tour y 0 recorridos.');
    expect(facts).toHaveTextContent('1 enlace público dejará de funcionar.');
    expect(dialog).toHaveTextContent('Es definitivo: no se puede deshacer.');
    // El foco empieza en «Cancelar»: confirmar exige un gesto explícito.
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toHaveFocus();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Eliminar definitivamente' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Se eliminó «Iniciar sesión».');
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Iniciar sesión' })).not.toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Transferir' })).toBeInTheDocument();
    expect(api.features.map((f) => f.id)).toEqual(['f-2']);
    // Mandó la versión del lienzo que vio y un id de eliminación.
    const call = api.fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE')!;
    const url = new URL(String(call[0]));
    expect(url.searchParams.get('canvasVersion')).toBe('3');
    expect(url.searchParams.get('deletionId')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('con portales hacia ella no deja eliminar y dice cuáles', async () => {
    await openGallery({
      apps: [app],
      features: [feature('f-1', 'Destino'), feature('f-2', 'Origen')],
      canvases: {
        'f-2': {
          schemaVersion: 0,
          version: 1,
          nodes: { p: { id: 'p', type: 'portal', title: 'Ir', targetFeatureId: 'f-1' } },
          edges: {},
          layout: { p: { x: 0, y: 0 } },
        },
      },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar Destino' }));
    const dialog = await screen.findByRole('dialog', { name: 'Eliminar «Destino»' });
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('portales hacia esta');
    expect(within(alert).getByRole('link', { name: 'Origen' })).toHaveAttribute('href', '/apps/app-1/features/f-2');
    expect(within(dialog).getByRole('button', { name: 'Eliminar definitivamente' })).toBeDisabled();
  });

  it('Escape cancela sin eliminar nada', async () => {
    const api = await openGallery({ apps: [app], features: [feature('f-1', 'Iniciar sesión')] });
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar Iniciar sesión' }));
    await screen.findByRole('dialog', { name: 'Eliminar «Iniciar sesión»' });
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.features).toHaveLength(1);
    expect(api.fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
  });

  it('si alguien guardó en medio, avisa y no elimina', async () => {
    const api = await openGallery({ apps: [app], features: [feature('f-1', 'Iniciar sesión')], canvases: { 'f-1': canvas } });
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar Iniciar sesión' }));
    const dialog = await screen.findByRole('dialog', { name: 'Eliminar «Iniciar sesión»' });
    await within(dialog).findByRole('list', { name: 'Qué se pierde' });
    api.canvases['f-1'] = { ...canvas, version: 4 }; // otra persona guardó después del resumen
    await userEvent.click(within(dialog).getByRole('button', { name: 'Eliminar definitivamente' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('cambió desde que viste el resumen');
    expect(api.features).toHaveLength(1);
  });

  it('un editor o un viewer no ven «Eliminar»', async () => {
    for (const role of ['editor', 'viewer'] as const) {
      const { unmount } = await (async () => {
        installFakeApi({ apps: [{ ...app, role }], features: [feature('f-1', 'Iniciar sesión')] });
        const view = renderRoute('/apps/app-1');
        await screen.findByRole('list', { name: 'Features' });
        return view;
      })();
      expect(screen.queryByRole('button', { name: 'Eliminar Iniciar sesión' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Eliminar app…' })).not.toBeInTheDocument();
      unmount();
    }
  });
});

describe('eliminar una app', () => {
  it('pide escribir su nombre, elimina y vuelve a la galería con un aviso', async () => {
    const api = await openGallery({ apps: [app], features: [feature('f-1', 'Iniciar sesión')] });
    const admin = screen.getByRole('region', { name: 'Administración' });
    await userEvent.click(within(admin).getByRole('button', { name: 'Eliminar app…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Eliminar la app «Banca móvil»' });
    expect(await within(dialog).findByRole('list', { name: 'Qué se elimina' })).toHaveTextContent('1 feature y 0 módulos');
    expect(dialog).toHaveTextContent('Exportar app (.walkie)');

    const confirm = within(dialog).getByRole('button', { name: 'Eliminar la app' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Escribe el nombre de la app para confirmar'), 'Banca');
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Escribe el nombre de la app para confirmar'), ' móvil');
    await userEvent.click(confirm);

    expect(await screen.findByRole('heading', { name: 'Apps' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Se eliminó la app «Banca móvil» con toda su documentación.');
    expect(api.apps).toHaveLength(0);
  });

  it('si la limpieza quedó a medias lo dice: ya no está disponible y Walkie termina solo', async () => {
    const api = await openGallery({ apps: [app], features: [feature('f-1', 'Iniciar sesión')] });
    api.next.deletionPending = true;
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar app…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Eliminar la app «Banca móvil»' });
    await within(dialog).findByRole('list', { name: 'Qué se elimina' });
    await userEvent.type(within(dialog).getByLabelText('Escribe el nombre de la app para confirmar'), 'Banca móvil');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Eliminar la app' }));
    expect(await screen.findByRole('status')).toHaveTextContent('ya no está disponible para nadie; Walkie termina de borrar sus datos');
  });
});
