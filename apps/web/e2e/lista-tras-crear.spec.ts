import { expect, test } from '@playwright/test';
import { login } from './helpers';

/**
 * Regresión de los E2E que agotaban los 60 s esperando el enlace de la app recién creada (catalogo.spec.ts en CI,
 * export-markdown.spec.ts en local): la primera carga de `GET /api/apps` leyó la base antes del POST y respondió
 * después. Aquí ese orden se fuerza con `page.route`: el POST espera a que el GET haya leído y el GET responde
 * después del POST. Sin `refreshAfterWrite` (api/hooks.ts) la lista queda sin la app y la prueba falla.
 */
test('la lista de apps muestra la app creada mientras la carga inicial sigue en curso', async ({ page }) => {
  let read!: () => void;
  const getRead = new Promise<void>((r) => (read = r));
  let created!: () => void;
  const postDone = new Promise<void>((r) => (created = r));
  let first = true;
  await page.route('**/api/apps', async (route) => {
    if (route.request().method() === 'POST') {
      await getRead;
      const response = await route.fetch();
      await route.fulfill({ response });
      setTimeout(created, 300);
      return;
    }
    if (!first) return route.continue();
    const response = await route.fetch().catch(() => null); // lee la lista antes del POST
    if (!response) return route.abort().catch(() => {});
    first = false;
    read();
    await postDone; // responde después del POST
    await route.fulfill({ response }).catch(() => {});
  });
  await login(page);
  const app = `E2E repro ${Date.now()}`;
  await page.getByLabel('Nueva app').fill(app);
  await page.getByRole('button', { name: 'Crear app' }).click();
  await expect(page.getByRole('link', { name: app })).toBeVisible({ timeout: 15_000 });
});
