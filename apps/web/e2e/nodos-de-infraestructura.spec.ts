import { expect, test, type Page } from '@playwright/test';
import { connect, dropNode, login, openNewFeature, saveStatus } from './helpers';

/**
 * Feature nodos-de-infraestructura (docs/features/nodos-de-infraestructura/spec.md) con API, Keycloak y Postgres
 * reales: crear recursos desde la barra (clic, teclado y arrastre), verlos con su subtipo, conectarlos con el tipo que
 * sugieren y guardarlos. Datos ficticios.
 */

const kindOf = (page: Page, index: number) => page.locator('.react-flow__node').nth(index).locator('.pixel-node-kind');

test('crear recursos desde «Recurso» (8): teclado, clic y arrastre; la conexión sigue su naturaleza', async ({ page }) => {
  await login(page);
  await openNewFeature(page, 'Infraestructura');

  // Un servicio que publica en una cola.
  await dropNode(page, 'Servicio', 160, 200);

  // Arrastrar un subtipo (Cola) desde la lista hasta el lienzo.
  await page.getByRole('button', { name: 'Recurso', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'Recursos' });
  const pane = (await page.locator('.canvas-flow').boundingBox())!;
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await menu.getByRole('menuitem', { name: /^Cola/ }).dispatchEvent('dragstart', { dataTransfer });
  await page.locator('.canvas-flow').dispatchEvent('drop', { dataTransfer, clientX: pane.x + 480, clientY: pane.y + 200 });
  await expect(menu).toBeHidden();
  await expect(kindOf(page, 1)).toHaveText(/Cola/);

  // Servicio → cola: la conexión nace como evento.
  await connect(page, 0, 1);
  await expect(page.locator('.kind-edge-label').first()).toHaveText('emite');

  // Tecla 8: la lista de subtipos; flechas y Enter eligen (Bucket, Función…).
  await page.keyboard.press('Escape');
  await page.keyboard.press('8');
  await expect(menu.getByRole('menuitem', { name: /^Bucket/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(menu).toBeHidden();
  await expect(kindOf(page, 2)).toHaveText(/Función/);

  // Clic en el botón y luego en un subtipo; Esc cierra la lista y vuelve al botón.
  await page.getByRole('button', { name: 'Recurso', exact: true }).click();
  await menu.getByRole('menuitem', { name: /^Caché/ }).click();
  await expect(kindOf(page, 3)).toHaveText(/Caché/);
  await page.getByRole('button', { name: 'Recurso', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(page.getByRole('button', { name: 'Recurso', exact: true })).toBeFocused();

  // Guardar y recargar: los recursos vuelven iguales.
  await page.keyboard.press('Control+s');
  await expect(saveStatus(page)).toHaveText('Guardado');
  await page.reload();
  await expect(page.locator('.pixel-node-kind', { hasText: 'Cola' })).toBeVisible();
  await expect(page.locator('.pixel-node-kind', { hasText: 'Caché' })).toBeVisible();
  await expect(page.locator('.pixel-node-kind', { hasText: 'Función' })).toBeVisible();
});
