import { expect, test, type Page } from '@playwright/test';
import { connect, dropNode, login, saveStatus } from './helpers';

/**
 * Feature espacio-de-trabajo (docs/features/espacio-de-trabajo/spec.md), criterios 18 a 20, con API, Keycloak y
 * Postgres reales: agrupar cajas, mover el grupo con ellas, incluir una al soltarla dentro, plegar y recargar.
 */
test('grupos de infraestructura: incluir, mover, plegar y recargar', async ({ page }) => {
  await login(page);
  const app = `E2E grupos ${Date.now()}`;
  await page.getByLabel('Nueva app').fill(app);
  await page.getByRole('button', { name: 'Crear app' }).click();
  await page.getByRole('link', { name: app }).click();
  await page.getByLabel('Nueva feature').fill('Transferir');
  await page.getByRole('button', { name: 'Crear feature' }).click();
  await page.getByRole('link', { name: 'Transferir' }).click();

  await dropNode(page, 'Pantalla', 120, 140);
  await dropNode(page, 'API', 420, 140);
  await dropNode(page, 'Base de datos', 420, 420);
  await connect(page, 0, 1);
  await connect(page, 1, 2);

  // Seleccionar API y BD y agrupar con G: el grupo las rodea (criterio 18).
  await box(page, 'API').click();
  await box(page, 'Base de datos').click({ modifiers: ['Shift'] });
  await page.keyboard.press('g');
  const group = page.locator('.group-node');
  await expect(group).toHaveCount(1);
  await expect(group).toContainText('2 nodos');
  const inspector = page.getByRole('complementary', { name: 'Propiedades' });
  await inspector.getByLabel('Nombre del grupo').fill('Core bancario');
  await inspector.getByLabel('Tipo de grupo').selectOption('backend');
  await expect(group).toContainText('Backend');

  // Mover el grupo por su nombre mueve sus cajas, no las de fuera.
  const apiBefore = await box(page, 'API').boundingBox();
  const screenBefore = await box(page, 'Pantalla').boundingBox();
  const header = page.locator('.group-node-header');
  const h = (await header.boundingBox())!;
  await page.mouse.move(h.x + 40, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + 120, h.y + h.height / 2 + 40, { steps: 8 });
  await page.mouse.up();
  const apiAfter = await box(page, 'API').boundingBox();
  expect(Math.round(apiAfter!.x - apiBefore!.x)).toBeGreaterThan(40);
  expect((await box(page, 'Pantalla').boundingBox())!.x).toBeCloseTo(screenBefore!.x, 0);

  // Plegar: una caja compacta con su nombre y número de nodos; las conexiones llegan a ella (criterio 19).
  await page.getByRole('button', { name: 'Plegar grupo Core bancario' }).click();
  await expect(box(page, 'API')).toBeHidden();
  await expect(group).toHaveAttribute('data-collapsed', 'true');
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);

  // Guardar y recargar: el grupo vuelve igual (criterio 20).
  await page.keyboard.press('Control+s');
  await expect(saveStatus(page)).toHaveText('Guardado');
  await page.reload();
  await expect(group).toHaveAttribute('data-collapsed', 'true');
  await expect(group).toContainText('Core bancario');
  await expect(group).toContainText('2 nodos');
  await page.getByRole('button', { name: 'Desplegar grupo Core bancario' }).click();
  await expect(box(page, 'API')).toBeVisible();
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);

  // Soltar una caja nueva dentro del grupo la incluye (criterio 18).
  const pane = (await page.locator('.canvas-flow').boundingBox())!;
  const area = (await group.boundingBox())!;
  await dropNode(page, 'Servicio', area.x - pane.x + 24, area.y - pane.y + area.height - 100);
  await expect(group).toContainText('3 nodos');
});

const box = (page: Page, title: string) =>
  page.locator('.react-flow__node').filter({ has: page.locator('.pixel-node-title', { hasText: new RegExp(`^${title}$`) }) });
