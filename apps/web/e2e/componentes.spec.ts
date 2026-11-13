import { expect, test, type Page } from '@playwright/test';
import { login, saveStatus } from './helpers';

/**
 * Feature espacio-de-trabajo (docs/features/espacio-de-trabajo/spec.md), criterios 10 a 12, con API, Keycloak
 * y Postgres reales: crear un componente sin salir del lienzo, usarlo en dos lienzos, cambiar su definición
 * desde el inspector (sabiendo dónde se usa) y sacar una copia independiente.
 */
test('componentes: crear en el lienzo, definición compartida y copia independiente', async ({ page }) => {
  await login(page);
  const app = `E2E componentes ${Date.now()}`;
  await page.getByLabel('Nueva app').fill(app);
  await page.getByRole('button', { name: 'Crear app' }).click();
  await page.getByRole('link', { name: app }).click();
  const appUrl = page.url();
  for (const feature of ['Pagar', 'Transferir']) {
    await page.getByLabel('Nueva feature').fill(feature);
    await page.getByRole('button', { name: 'Crear feature' }).click();
    await expect(page.getByRole('link', { name: feature })).toBeVisible();
  }

  // Pagar: "Nuevo componente" lo crea en el catálogo y lo pone en el lienzo (criterio 10).
  await page.getByRole('link', { name: 'Pagar' }).click();
  await page.getByRole('button', { name: 'Catálogo', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Catálogo' });
  const create = panel.getByRole('form', { name: 'Nuevo componente' });
  await create.getByLabel('Tipo de componente').selectOption('service');
  await create.getByLabel('Título del componente').fill('Motor de pagos');
  await create.getByRole('button', { name: 'Crear y agregar' }).click();
  await expect(page.locator('.pixel-node[data-type="ref"][data-ref="ok"]')).toHaveCount(1);
  await expect(panel.getByRole('button', { name: /Motor de pagos/ })).toBeVisible();
  await panel.getByRole('group', { name: 'Filtrar por tipo' }).getByRole('button', { name: 'API' }).click();
  await expect(panel.getByRole('button', { name: /Motor de pagos/ })).toBeHidden();
  await panel.getByRole('button', { name: 'Cerrar panel' }).click();
  await save(page);

  // Transferir usa el mismo componente.
  await page.goto(appUrl);
  await page.getByRole('link', { name: 'Transferir' }).click();
  await page.getByRole('button', { name: 'Catálogo', exact: true }).click();
  await panel.getByRole('button', { name: /Motor de pagos/ }).click();
  await panel.getByRole('button', { name: 'Cerrar panel' }).click();
  await save(page);

  // El inspector separa la definición compartida (con dónde se usa) de este lienzo (criterio 12).
  await page.locator('.pixel-node', { hasText: 'Motor de pagos' }).click();
  const shared = page.getByRole('region', { name: 'Definición compartida' });
  await expect(shared).toContainText('Se usa en 2 lienzos');
  await expect(shared.getByRole('list', { name: 'Lienzos que lo usan' })).toContainText('Transferir (este lienzo)');
  await shared.getByLabel('Título').fill('Motor de pagos v2');
  await shared.getByRole('button', { name: 'Guardar definición' }).click();
  await expect(page.locator('.pixel-node-title', { hasText: 'Motor de pagos v2' })).toBeVisible();
  await expect(saveStatus(page)).toHaveText('Guardado');

  // Copia independiente: vuelve a ser un nodo propio con los datos actuales (criterio 11).
  await page.getByRole('region', { name: 'En este lienzo' }).getByRole('button', { name: 'Crear copia independiente' }).click();
  const node = page.locator('.pixel-node', { hasText: 'Motor de pagos v2' });
  await expect(node).toHaveAttribute('data-type', 'service');
  await save(page);
  await page.reload();
  await expect(node).toHaveAttribute('data-type', 'service');

  // En Pagar sigue siendo el componente, con el nombre nuevo.
  await page.goto(appUrl);
  await page.getByRole('link', { name: 'Pagar' }).click();
  await expect(page.locator('.pixel-node[data-type="ref"] .pixel-node-title')).toHaveText('Motor de pagos v2');
});

async function save(page: Page) {
  await page.keyboard.press('Control+s');
  await expect(saveStatus(page)).toHaveText('Guardado');
}
