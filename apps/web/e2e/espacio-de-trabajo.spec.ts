import { expect, test } from '@playwright/test';
import { login, saveStatus } from './helpers';

/**
 * Feature espacio-de-trabajo (docs/features/espacio-de-trabajo/spec.md), criterios 1, 3, 4 y 5, con API,
 * Keycloak y Postgres reales: agregar cajas con el teclado, volver a `/` y encontrar la misma feature con el
 * mismo zoom, cambiar de feature desde la barra y plegar el inspector.
 */
test('el lienzo es la pantalla de inicio y recuerda dónde quedé', async ({ page }) => {
  await login(page);
  const app = `E2E espacio ${Date.now()}`;
  await page.getByLabel('Nueva app').fill(app);
  await page.getByRole('button', { name: 'Crear app' }).click();
  await page.getByRole('link', { name: app }).click();
  for (const feature of ['Iniciar sesión', 'Transferir']) {
    await page.getByLabel('Nueva feature').fill(feature);
    await page.getByRole('button', { name: 'Crear feature' }).click();
    await expect(page.getByRole('link', { name: feature })).toBeVisible();
  }
  await page.getByRole('link', { name: 'Iniciar sesión' }).click();

  // Lienzo vacío con guía; las teclas 2 y 4 agregan una pantalla y una API (criterios 4 y 5).
  await expect(page.getByRole('note', { name: 'Cómo empezar' })).toBeVisible();
  await page.locator('.react-flow__pane').click({ position: { x: 600, y: 500 } });
  await page.keyboard.press('2');
  await page.keyboard.press('4');
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await expect(page.getByRole('note', { name: 'Cómo empezar' })).toBeHidden();
  await expect(page.locator('.pixel-node-kind')).toHaveText([/Pantalla/, /API/]);
  await page.keyboard.press('Control+s');
  await expect(saveStatus(page)).toHaveText('Guardado');

  // "?" abre los atajos.
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: 'Atajos del lienzo' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Acercar y volver a "/": la misma app, feature y zoom (criterio 1).
  await page.getByRole('button', { name: 'Acercar' }).click();
  const zoom = page.getByRole('group', { name: 'Zoom' }).getByRole('button', { name: /^Zoom/ });
  await expect(zoom).not.toHaveText('100 %');
  const zoomText = await zoom.textContent();
  // Espera a que la vista quede guardada (al terminar la animación del zoom) antes de salir.
  const featureId = new URL(page.url()).pathname.split('/').pop()!;
  await expect
    .poll(() => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null')?.zoom ?? 1, `walkie.viewport.${featureId}`))
    .not.toBe(1);
  await page.goto('/');
  const ruta = page.getByRole('navigation', { name: 'Ruta' });
  await expect(ruta).toContainText(app);
  await expect(ruta).toContainText('Iniciar sesión');
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await expect(zoom).toHaveText(zoomText!);

  // Cambiar de feature desde la barra (criterio 3).
  await ruta.getByRole('button', { name: /Iniciar sesión/ }).click();
  await page.getByRole('dialog', { name: 'Cambiar de feature' }).getByRole('link', { name: 'Transferir' }).click();
  await expect(ruta).toContainText('Transferir');
  await expect(page.locator('.react-flow__node')).toHaveCount(0);

  // El inspector se pliega con I y lo recuerda al recargar (criterio 4).
  await page.locator('.react-flow__pane').click({ position: { x: 600, y: 500 } });
  await expect(page.getByRole('complementary', { name: 'Propiedades' })).toBeVisible();
  await page.keyboard.press('i');
  await expect(page.getByRole('complementary', { name: 'Propiedades' })).toBeHidden();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Mostrar inspector' })).toBeVisible();
  await page.getByRole('button', { name: 'Mostrar inspector' }).click();
  await expect(page.getByRole('complementary', { name: 'Propiedades' })).toBeVisible();
});
