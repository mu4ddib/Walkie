import { expect, test, type Page } from '@playwright/test';
import { SECOND_USER, dropNode, login, openNewFeature } from './helpers';

// Autorización por app (spec autorizacion-por-app, ADR-0015) con dos personas reales de Keycloak: `dev` crea una app,
// `dev2` no la ve; como viewer la ve en solo lectura; como editor la cambia; al quitarlo deja de verla.

const NO_ACCESS = 'No tienes acceso a esta app';

async function members(page: Page) {
  await page.getByRole('button', { name: 'Miembros' }).click();
  const dialog = page.getByRole('dialog', { name: 'Miembros' });
  await expect(dialog.getByRole('list', { name: 'Miembros de la app' })).toBeVisible();
  return dialog;
}

test('una app solo la ve quien es miembro, con lo que su rol permite', async ({ page, browser }) => {
  test.setTimeout(120_000);

  // `dev2` entra una vez: así Walkie lo conoce y se lo puede sumar por correo.
  const other = await (await browser.newContext()).newPage();
  await login(other, '/apps', SECOND_USER);

  await login(page);
  await openNewFeature(page, 'Transferir');
  const featureUrl = page.url();
  const appUrl = featureUrl.replace(/\/features\/.*$/, '');
  await page.goto(appUrl);
  const appName = (await page.locator('.gallery-head h2').innerText()).trim();

  // 1. No es miembro: ni en la galería ni por URL.
  await other.goto('/apps');
  await expect(other.getByRole('list', { name: 'Apps' }).or(other.getByRole('heading', { name: 'Aún no hay apps' }))).toBeVisible();
  await expect(other.getByRole('link', { name: appName })).toHaveCount(0);
  await other.goto(featureUrl);
  await expect(other.getByRole('alert')).toContainText(NO_ACCESS);

  // 2. Viewer: ve el lienzo en solo lectura.
  let dialog = await members(page);
  await dialog.getByLabel('Correo').fill(SECOND_USER.email);
  await dialog.getByLabel('Rol', { exact: true }).selectOption('viewer');
  await dialog.getByRole('button', { name: 'Agregar' }).click();
  const role = dialog.getByLabel(/^Rol de /).last();
  await expect(role).toHaveValue('viewer');

  await other.goto(featureUrl);
  await expect(other.locator('.save-status')).toHaveText('Solo lectura');
  await expect(other.locator('.react-flow')).toBeVisible();
  await expect(other.getByRole('button', { name: /^Guardar(?! como)/ })).toHaveCount(0);
  await expect(other.getByRole('button', { name: 'Compartir' })).toHaveCount(0);
  await other.goto(appUrl);
  await expect(other.getByRole('note')).toContainText('«viewer»');
  await expect(other.getByLabel('Nueva feature')).toHaveCount(0);

  // 3. Editor: cambia el lienzo y guarda.
  await role.selectOption('editor');
  await expect(role).toHaveValue('editor');
  await other.goto(featureUrl);
  await expect(other.locator('.save-status')).toHaveText('Al día');
  await dropNode(other, 'Pantalla', 200, 160);
  await expect(other.locator('.save-status')).toHaveText('Sin guardar');
  await other.getByRole('button', { name: /^Guardar(?! como)/ }).click();
  await expect(other.locator('.save-status')).toHaveText('Guardado');
  await expect(other.getByRole('button', { name: 'Compartir' })).toHaveCount(0);

  // 4. Quitado: deja de verla.
  page.once('dialog', (d) => void d.accept());
  await dialog.getByRole('button', { name: /^Quitar a / }).click();
  await expect(dialog.getByLabel(/^Rol de /)).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Cerrar' }).click();

  await other.goto(featureUrl);
  await expect(other.getByRole('alert')).toContainText(NO_ACCESS);
  await other.goto('/apps');
  await expect(other.getByRole('link', { name: appName })).toHaveCount(0);

  // El owner sigue con su app y ve el cambio de `dev2`.
  await page.goto(featureUrl);
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await page.goto(appUrl);
  dialog = await members(page);
  await expect(dialog.getByLabel(/^Rol de /)).toHaveValue('owner');
});
