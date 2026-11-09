import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Share } from '../api/client';
import { installFakeApi } from '../test/fakeApi';
import { renderRoute } from '../test/render';
import { formatDay, formatDayAndTime } from './shareFormat';

vi.mock('react-oidc-context', () => ({ useAuth: () => ({ user: { access_token: 'token-de-prueba' } }) }));
// El diálogo no depende del lienzo: uno vacío alcanza (React Flow no corre bien en jsdom).
vi.mock('../canvas/Canvas', () => ({ Canvas: () => <div aria-label="lienzo" /> }));

const app = { id: 'app-1', name: 'Banca de prueba', createdAt: '2026-01-01T00:00:00Z', featureCount: 1 };
const feature = { id: 'feat-1', appId: 'app-1', name: 'Iniciar sesión', createdAt: '2026-01-01T00:00:00Z', description: '', updatedAt: '2026-01-01T00:00:00Z' };

afterEach(() => vi.unstubAllGlobals());

async function openDialog(shares: Share[] = []) {
  const user = userEvent.setup();
  const api = installFakeApi({ apps: [app], features: [feature], shares });
  renderRoute('/apps/app-1/features/feat-1');
  await user.click(await screen.findByRole('button', { name: 'Compartir' }));
  const dialog = await screen.findByRole('dialog', { name: 'Compartir' });
  return { user, api, dialog };
}

describe('Compartir', () => {
  it('avisa qué ve quien tenga el enlace y propone 30 días (criterio 1)', async () => {
    const { dialog } = await openDialog();

    expect(within(dialog).getByRole('note')).toHaveTextContent(
      'Quien tenga el enlace verá este lienzo, sus imágenes y sus tours sin iniciar sesión.',
    );
    expect(within(dialog).getByLabelText('Duración')).toHaveValue('30');
    expect(within(dialog).getAllByRole('option').map((o) => o.textContent)).toEqual(['7 días', '30 días', '90 días']);
    expect(await within(dialog).findByText('No hay enlaces activos.')).toBeInTheDocument();
  });

  it('crea un enlace, muestra la URL una sola vez y lo agrega a la lista (criterios 2 y 3)', async () => {
    const { user, api, dialog } = await openDialog();

    await user.selectOptions(within(dialog).getByLabelText('Duración'), '7');
    await user.click(within(dialog).getByRole('button', { name: 'Crear enlace' }));

    const url = await within(dialog).findByLabelText<HTMLInputElement>('Enlace nuevo');
    expect(url.value).toMatch(new RegExp(`^${window.location.origin}/s/[A-Za-z0-9_-]{43}$`));
    const [share] = api.shares;
    expect(new Date(share!.expiresAt).getTime() - new Date(share!.createdAt).getTime()).toBe(7 * 86_400_000);
    const item = await within(dialog).findByRole('listitem');
    expect(item).toHaveTextContent(
      `Creado el ${formatDay(share!.createdAt)} por Ana Prueba · disponible hasta el ${formatDay(share!.expiresAt)} · Nunca abierto`,
    );

    // Al cerrar y volver a abrir, la URL ya no está: solo se ve al crearla.
    await user.click(within(dialog).getByRole('button', { name: 'Cerrar' }));
    await user.click(screen.getByRole('button', { name: 'Compartir' }));
    const again = await screen.findByRole('dialog', { name: 'Compartir' });
    expect(await within(again).findByRole('listitem')).toBeInTheDocument();
    expect(within(again).queryByLabelText('Enlace nuevo')).not.toBeInTheDocument();
  });

  it('copia la URL al portapapeles (criterio 2)', async () => {
    const { user, dialog } = await openDialog();
    await user.click(within(dialog).getByRole('button', { name: 'Crear enlace' }));
    const url = (await within(dialog).findByLabelText<HTMLInputElement>('Enlace nuevo')).value;

    await user.click(within(dialog).getByRole('button', { name: 'Copiar' }));

    expect(await navigator.clipboard.readText()).toBe(url);
    expect(within(dialog).getByRole('button', { name: 'Copiado' })).toBeInTheDocument();
  });

  it('muestra el último acceso y revocar saca el enlace de la lista (criterios 3 y 4)', async () => {
    const opened: Share = {
      id: 'share-1',
      featureId: 'feat-1',
      createdByName: 'Beto Prueba',
      createdAt: '2026-11-01T12:00:00Z',
      expiresAt: '2026-12-01T12:00:00Z',
      lastAccessedAt: '2026-11-05T15:30:00Z',
    };
    const { user, api, dialog } = await openDialog([opened]);

    const item = await within(dialog).findByRole('listitem');
    expect(item).toHaveTextContent(`por Beto Prueba`);
    expect(item).toHaveTextContent(`último acceso: ${formatDayAndTime(opened.lastAccessedAt!)}`);

    await user.click(within(item).getByRole('button', { name: /^Revocar el enlace creado el/ }));

    expect(await within(dialog).findByText('No hay enlaces activos.')).toBeInTheDocument();
    expect(api.shares).toEqual([]);
  });

  it('Esc cierra el diálogo', async () => {
    const { user } = await openDialog();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Compartir' })).not.toBeInTheDocument();
  });
});
