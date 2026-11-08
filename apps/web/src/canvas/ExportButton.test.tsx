import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';
import { fileNameOf } from '../api/client';
import type { GraphStore } from '../store/graphStore';
import { installFakeApi } from '../test/fakeApi';
import { renderRoute } from '../test/render';

vi.mock('react-oidc-context', () => ({ useAuth: () => ({ user: { access_token: 'token-de-prueba' } }) }));
// Un lienzo mínimo que deja cambiar el store (React Flow no corre bien en jsdom).
vi.mock('./Canvas', () => ({
  Canvas: ({ store }: { store: StoreApi<GraphStore> }) => (
    <button type="button" onClick={() => store.getState().addNode('screen', { x: 0, y: 0 })}>
      agregar pantalla
    </button>
  ),
}));

const app = { id: 'app-1', name: 'Banca de prueba', createdAt: '2026-01-01T00:00:00Z' };
const feature = { id: 'feat-1', appId: 'app-1', name: 'Iniciar sesión', createdAt: '2026-01-01T00:00:00Z' };

let saved: { name: string; href: string }[];

beforeEach(() => {
  saved = [];
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:zip', revokeObjectURL: vi.fn() }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    saved.push({ name: this.download, href: this.getAttribute('href') ?? '' });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function openEditor() {
  const api = installFakeApi({ apps: [app], features: [feature] });
  renderRoute('/apps/app-1/features/feat-1');
  await screen.findByRole('button', { name: 'agregar pantalla' });
  return { api, user: userEvent.setup() };
}

describe('Exportar', () => {
  it('descarga el .zip con el nombre que manda la API (criterio 1)', async () => {
    const { api, user } = await openEditor();

    await user.click(screen.getByRole('button', { name: 'Exportar' }));

    await vi.waitFor(() => expect(saved).toEqual([{ name: 'Iniciar sesión.zip', href: 'blob:zip' }]));
    const [url, init] = api.fetchMock.mock.calls.at(-1)!;
    expect(String(url)).toMatch(/\/api\/features\/feat-1\/export$/);
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token-de-prueba');
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('con cambios sin guardar avisa que se exportó lo guardado (criterio 1)', async () => {
    const { user } = await openEditor();
    await user.click(screen.getByRole('button', { name: 'agregar pantalla' }));

    await user.click(screen.getByRole('button', { name: 'Exportar' }));

    expect(await screen.findByRole('note')).toHaveTextContent(
      'Se exportó lo guardado: los cambios sin guardar no se incluyen.',
    );
    expect(saved).toHaveLength(1);
  });

  it('si la API falla, lo dice y no descarga nada', async () => {
    const { api, user } = await openEditor();
    api.next.exportStatus = 500;

    await user.click(screen.getByRole('button', { name: 'Exportar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo exportar.');
    expect(saved).toEqual([]);
  });
});

describe('fileNameOf', () => {
  it('prefiere filename* (UTF-8) y si no usa filename', () => {
    expect(fileNameOf(`attachment; filename=a.zip; filename*=UTF-8''iniciar-sesi%C3%B3n.zip`)).toBe('iniciar-sesión.zip');
    expect(fileNameOf('attachment; filename="iniciar-sesion.zip"')).toBe('iniciar-sesion.zip');
    expect(fileNameOf('attachment; filename=iniciar-sesion.zip')).toBe('iniciar-sesion.zip');
    expect(fileNameOf(null)).toBeUndefined();
  });
});
