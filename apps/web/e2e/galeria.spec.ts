import { expect, test } from '@playwright/test';
import { login, saveStatus } from './helpers';

/**
 * Feature espacio-de-trabajo (docs/features/espacio-de-trabajo/spec.md), criterios 7 y 8, con API, Keycloak y
 * Postgres reales: la tarjeta muestra la miniatura del lienzo guardado y la feature se renombra desde la galería.
 */
test('la galería muestra la miniatura real y renombra la feature', async ({ page }) => {
  await login(page);
  const app = `E2E galería ${Date.now()}`;
  await page.getByLabel('Nueva app').fill(app);
  await page.getByRole('button', { name: 'Crear app' }).click();
  await page.getByRole('link', { name: app }).click();
  const appUrl = page.url();
  await page.getByLabel('Nueva feature').fill('Pagar servicios');
  await page.getByRole('button', { name: 'Crear feature' }).click();

  const features = page.getByRole('list', { name: 'Features' });
  await expect(features.getByRole('img', { name: 'Lienzo vacío' })).toBeVisible();

  // Dos cajas guardadas en el lienzo aparecen en la miniatura.
  await features.getByRole('link', { name: 'Pagar servicios' }).click();
  await page.locator('.react-flow__pane').click({ position: { x: 600, y: 500 } });
  await page.keyboard.press('2');
  await page.keyboard.press('4');
  await page.keyboard.press('Control+s');
  await expect(saveStatus(page)).toHaveText('Guardado');
  await page.goto(appUrl);
  await expect(features.getByRole('img', { name: 'Vista previa: 2 cajas y 0 conexiones' })).toBeVisible();

  // Renombrar con descripción; vuelve igual al recargar.
  await page.getByRole('button', { name: 'Editar Pagar servicios' }).click();
  const form = page.getByRole('form', { name: 'Editar Pagar servicios' });
  await form.getByLabel('Nombre').fill('Pagar servicios básicos');
  await form.getByLabel('Descripción').fill('Agua, luz y gas desde la cuenta');
  await form.getByRole('button', { name: 'Guardar' }).click();
  await expect(features.getByRole('link', { name: 'Pagar servicios básicos' })).toBeVisible();
  await page.reload();
  await expect(features.getByRole('link', { name: 'Pagar servicios básicos' })).toBeVisible();
  await expect(features).toContainText('Agua, luz y gas desde la cuenta');
});
