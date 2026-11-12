import { screen, within } from '@testing-library/react';
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

const app = { id: 'app-1', name: 'Banca de prueba', createdAt: '2026-01-01T00:00:00Z', featureCount: 1 };
const feature = { id: 'feat-1', appId: 'app-1', name: 'Iniciar sesión', createdAt: '2026-01-01T00:00:00Z', description: '', updatedAt: '2026-01-01T00:00:00Z' };

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

/** «Exportar» abre el menú; el .zip es «Markdown e imágenes» (spec exportar-e-importar). */
async function exportMarkdown(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Exportar' }));
  await user.click(screen.getByRole('menuitem', { name: /Markdown e imágenes/ }));
}

describe('Exportar', () => {
  it('descarga el .zip con el nombre que manda la API (criterio 1)', async () => {
    const { api, user } = await openEditor();

    await exportMarkdown(user);

    await vi.waitFor(() => expect(saved).toEqual([{ name: 'Iniciar sesión.zip', href: 'blob:zip' }]));
    const [url, init] = api.fetchMock.mock.calls.at(-1)!;
    expect(String(url)).toMatch(/\/api\/features\/feat-1\/export$/);
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token-de-prueba');
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('con cambios sin guardar avisa que se exportó lo guardado (criterio 1)', async () => {
    const { user } = await openEditor();
    await user.click(screen.getByRole('button', { name: 'agregar pantalla' }));

    await exportMarkdown(user);

    expect(await screen.findByRole('note')).toHaveTextContent(
      'Se exportó lo guardado: los cambios sin guardar no se incluyen.',
    );
    expect(saved).toHaveLength(1);
  });

  it('si la API falla, lo dice y no descarga nada', async () => {
    const { api, user } = await openEditor();
    api.next.exportStatus = 500;

    await exportMarkdown(user);

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo exportar.');
    expect(saved).toEqual([]);
  });
});

describe('Contexto para IA (spec exportar-e-importar)', () => {
  it('el menú ofrece las opciones con su ayuda y se maneja con teclado', async () => {
    const { user } = await openEditor();

    await user.click(screen.getByRole('button', { name: 'Exportar' }));
    const items = screen.getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual([
      expect.stringMatching(/^Contexto para IA…Todo lo documentado/),
      expect.stringMatching(/^Markdown e imágenes \(\.zip\)Documento para el repo/),
    ]);
    expect(items[0]).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(items[1]).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Exportar' })).toHaveFocus();
  });

  it('carga el Markdown, dice su tamaño, lo copia y descarga el .md y el JSON', async () => {
    const { api, user } = await openEditor();

    await user.click(screen.getByRole('button', { name: 'Exportar' }));
    await user.click(screen.getByRole('menuitem', { name: /Contexto para IA/ }));

    const dialog = screen.getByRole('dialog', { name: 'Contexto para IA' });
    const text = '# Contexto para IA: Iniciar sesión\n\nUn texto de prueba.\n';
    expect(await within(dialog).findByLabelText('Vista previa del contexto')).toHaveTextContent('Un texto de prueba.');
    expect(within(dialog).getByRole('status')).toHaveTextContent(`≈ ${Math.ceil(text.length / 4)} tokens · ${text.length} caracteres`);
    expect(String(api.fetchMock.mock.calls.at(-1)![0])).toMatch(/\/export\?format=ai$/);
    expect(within(dialog).queryByRole('note')).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Copiar al portapapeles' }));
    expect(await navigator.clipboard.readText()).toBe(text);
    expect(within(dialog).getByRole('button', { name: 'Copiado ✓' })).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Descargar .md' }));
    await user.click(within(dialog).getByRole('button', { name: 'Descargar JSON' }));
    await vi.waitFor(() =>
      expect(saved.map((f) => f.name)).toEqual(['contexto-ia.md', 'feature.context.json']),
    );
    expect(String(api.fetchMock.mock.calls.at(-1)![0])).toMatch(/\/export\?format=ai-json$/);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('con cambios sin guardar avisa que se exporta lo guardado; si la API falla, lo dice', async () => {
    const { api, user } = await openEditor();
    await user.click(screen.getByRole('button', { name: 'agregar pantalla' }));
    api.next.exportStatus = 500;

    await user.click(screen.getByRole('button', { name: 'Exportar' }));
    await user.click(screen.getByRole('menuitem', { name: /Contexto para IA/ }));

    const dialog = screen.getByRole('dialog', { name: 'Contexto para IA' });
    expect(within(dialog).getByRole('note')).toHaveTextContent('Se exporta lo guardado');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('No se pudo preparar el contexto.');
    expect(within(dialog).getByRole('button', { name: 'Copiar al portapapeles' })).toBeDisabled();
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
