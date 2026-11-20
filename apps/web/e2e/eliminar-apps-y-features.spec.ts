import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

/**
 * Eliminar features y apps (spec eliminar-apps-y-features, ADR-0017) con Keycloak, la API, PostgreSQL y la web reales.
 * Todo lo crea la prueba (apps con nombre único); nunca toca otras apps.
 */
const API = process.env.VITE_API_URL ?? 'http://localhost:5080';

async function capture(page: Page, name: string) {
  const dir = process.env.WALKIE_CAPTURES;
  if (dir) await page.screenshot({ path: join(dir, `eliminar-${name}.png`), fullPage: true });
}

async function api<T>(page: Page, path: string, init?: { method: string; body?: unknown }): Promise<{ status: number; body: T }> {
  return page.evaluate(
    async ({ base, path, init }) => {
      const key = Object.keys(sessionStorage).find((k) => k.startsWith('oidc.user:'))!;
      const token = (JSON.parse(sessionStorage.getItem(key)!) as { access_token: string }).access_token;
      const res = await fetch(`${base}${path}`, {
        method: init?.method ?? 'GET',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    },
    { base: API, path, init },
  ) as Promise<{ status: number; body: T }>;
}

/** Un lienzo con 3 pantallas y 2 conexiones de navegación. */
function graph() {
  const id = () => crypto.randomUUID();
  const [a, b, c, e1, e2] = [id(), id(), id(), id(), id()];
  return {
    schemaVersion: 0,
    version: 0,
    nodes: {
      [a]: { id: a, type: 'screen', title: 'Lista' },
      [b]: { id: b, type: 'screen', title: 'Detalle' },
      [c]: { id: c, type: 'screen', title: 'Editar' },
    },
    edges: {
      [e1]: { id: e1, from: a, to: b, kind: 'navigation' },
      [e2]: { id: e2, from: b, to: c, kind: 'navigation' },
    },
    layout: { [a]: { x: 0, y: 0 }, [b]: { x: 300, y: 0 }, [c]: { x: 600, y: 0 } },
  };
}

test('eliminar una feature y después la app, sin tocar otra app', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  const stamp = Date.now();
  const name = `E2E Eliminar ${stamp}`;

  // Una app de prueba con tres features (una con lienzo) y otra app que tiene que quedar intacta.
  const app = (await api<{ id: string }>(page, '/api/apps', { method: 'POST', body: { name } })).body.id;
  const other = (await api<{ id: string }>(page, '/api/apps', { method: 'POST', body: { name: `E2E Se queda ${stamp}` } })).body.id;
  const ids: Record<string, string> = {};
  for (const feature of ['Pagar servicios', 'Transferir', 'Iniciar sesión']) {
    ids[feature] = (await api<{ id: string }>(page, `/api/apps/${app}/features`, { method: 'POST', body: { name: feature } })).body.id;
  }
  expect((await api(page, `/api/features/${ids['Pagar servicios']}/canvas`, { method: 'PUT', body: graph() })).status).toBe(200);
  const kept = (await api<{ id: string }>(page, `/api/apps/${other}/features`, { method: 'POST', body: { name: 'Intacta' } })).body.id;
  expect((await api(page, `/api/features/${kept}/canvas`, { method: 'PUT', body: graph() })).status).toBe(200);
  const keptCanvas = (await api<unknown>(page, `/api/features/${kept}/canvas`)).body;

  // Eliminar una feature desde su tarjeta: el diálogo dice qué se pierde.
  await page.goto(`/apps/${app}`);
  const cards = page.getByRole('list', { name: 'Features' });
  await expect(cards.getByRole('link')).toHaveCount(3);
  await page.getByRole('button', { name: 'Eliminar Pagar servicios' }).click();
  const dialog = page.getByRole('dialog', { name: 'Eliminar «Pagar servicios»' });
  await expect(dialog.getByRole('list', { name: 'Qué se pierde' })).toContainText('Su lienzo: 3 cajas y 2 conexiones.');
  await expect(dialog).toContainText('Es definitivo: no se puede deshacer.');
  await expect(dialog.getByRole('button', { name: 'Cancelar' })).toBeFocused();
  await capture(page, 'feature-dialogo');
  await dialog.getByRole('button', { name: 'Eliminar definitivamente' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Se eliminó «Pagar servicios».' })).toBeVisible();
  await expect(cards.getByRole('link')).toHaveCount(2);
  await expect(cards.getByRole('link', { name: 'Transferir' })).toBeVisible();
  await capture(page, 'feature-eliminada');
  expect((await api(page, `/api/features/${ids['Pagar servicios']}/canvas`)).status).toBe(404);
  expect((await api(page, `/api/features/${ids['Transferir']}/canvas`)).status).toBe(200);

  // Eliminar la app: sección de administración, nombre escrito, vuelta a la galería con un aviso.
  await page.getByRole('region', { name: 'Administración' }).getByRole('button', { name: 'Eliminar app…' }).click();
  const appDialog = page.getByRole('dialog', { name: `Eliminar la app «${name}»` });
  await expect(appDialog.getByRole('list', { name: 'Qué se elimina' })).toContainText('2 features y 0 módulos');
  const confirm = appDialog.getByRole('button', { name: 'Eliminar la app' });
  await expect(confirm).toBeDisabled();
  await appDialog.getByLabel('Escribe el nombre de la app para confirmar').fill(name);
  await capture(page, 'app-dialogo');
  await confirm.click();
  await expect(page).toHaveURL(/\/apps$/);
  await expect(page.getByRole('status')).toContainText(`Se eliminó la app «${name}»`);
  await expect(page.getByRole('list', { name: 'Apps' }).getByRole('link', { name })).toHaveCount(0);
  await capture(page, 'app-eliminada');

  // Sus rutas ya no la dan; la otra app sigue igual.
  expect((await api(page, `/api/apps/${app}`)).status).toBe(404);
  expect((await api(page, `/api/features/${ids['Transferir']}/canvas`)).status).toBe(404);
  await page.goto(`/apps/${app}`);
  await expect(page.getByRole('alert')).toContainText('No tienes acceso a esta app');
  expect((await api(page, `/api/apps/${other}`)).status).toBe(200);
  expect((await api<unknown>(page, `/api/features/${kept}/canvas`)).body).toEqual(keptCanvas);
});
