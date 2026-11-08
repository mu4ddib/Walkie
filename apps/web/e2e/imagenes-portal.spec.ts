import { expect, test, type Page } from '@playwright/test';
import { connect, dropNode, login, png, saveStatus } from './helpers';

/**
 * Feature imagenes-portal (docs/features/imagenes-portal/spec.md), criterios 1, 5, 8 y 12, con API,
 * Keycloak, Postgres y RustFS reales: imagen en una pantalla y un portal a otra feature; guardar y
 * recargar idéntico; abrir el portal con y sin cambios pendientes.
 */
test('imagen en una pantalla y portal a otra feature: recargar idéntico y abrir con confirmación', async ({ page }) => {
  await login(page);
  const app = `E2E portal ${Date.now()}`;
  await page.getByLabel('Nueva app').fill(app);
  await page.getByRole('button', { name: 'Crear app' }).click();
  await page.getByRole('link', { name: app }).click();
  for (const feature of ['Iniciar sesión', 'Transferir']) {
    await page.getByLabel('Nueva feature').fill(feature);
    await page.getByRole('button', { name: 'Crear feature' }).click();
    await expect(page.getByRole('link', { name: feature })).toBeVisible();
  }
  await page.getByRole('link', { name: 'Iniciar sesión' }).click();

  // Imagen en una pantalla (criterio 1): sintética, sin datos de nadie.
  await dropNode(page, 'Pantalla', 80, 120);
  await expect(page.getByRole('note')).toHaveText('No subas capturas con datos reales de clientes.');
  await page
    .getByLabel('Subir imagen')
    .setInputFiles({ name: 'login.png', mimeType: 'image/png', buffer: png(64, 40) });
  await expect(nodeImage(page)).toBeVisible();
  await expect(saveStatus(page)).toHaveText('Sin guardar');

  // Portal a Transferir, conectado desde la pantalla (criterios 7 y 10).
  await dropNode(page, 'Portal', 400, 120);
  await page.getByLabel('Feature destino').selectOption({ label: 'Transferir' });
  await connect(page, 0, 1);
  await page.locator('.react-flow__pane').click({ position: { x: 700, y: 600 } });
  await expect(portalTitle(page)).toHaveText('→ Transferir');
  await expect(page.locator('.kind-edge-label')).toHaveText('navega');

  // Guardar y recargar idéntico (criterios 5 y 12).
  const before = await visibleCanvas(page);
  await page.keyboard.press('Control+s');
  await expect(saveStatus(page)).toHaveText('Guardado');
  await page.reload();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await expect(nodeImage(page)).toBeVisible();
  expect(await nodeImage(page).evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(64);
  expect(await visibleCanvas(page)).toEqual(before);

  // Con cambios sin guardar, abrir el portal pide confirmación; cancelar deja el lienzo (criterio 8).
  await page.locator('.react-flow__node').first().click();
  await page.getByLabel('Descripción').fill('Cambio sin guardar');
  await expect(saveStatus(page)).toHaveText('Sin guardar');
  const dialogs: string[] = [];
  page.once('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  await page.locator('.react-flow__node').nth(1).dblclick();
  expect(dialogs).toEqual(['Tienes cambios sin guardar. ¿Salir igual?']);
  await expect(page.getByRole('navigation', { name: 'Ruta' })).toContainText('Iniciar sesión');

  // Aceptar lleva al lienzo destino sin guardar el cambio.
  page.once('dialog', (dialog) => void dialog.accept());
  await page.locator('.react-flow__node').nth(1).dblclick();
  await expect(page.getByRole('navigation', { name: 'Ruta' })).toContainText('Transferir');
  await expect(page.locator('.react-flow__node')).toHaveCount(0);

  // De vuelta, el lienzo es el guardado: el cambio descartado no está.
  await page.goBack();
  await expect(portalTitle(page)).toHaveText('→ Transferir');
  expect(await visibleCanvas(page)).toEqual(before);
});

const nodeImage = (page: Page) => page.locator('.pixel-node img.pixel-node-image');
const portalTitle = (page: Page) => page.locator('.pixel-node[data-type="portal"] .pixel-node-title');

/** Lo que se ve de cada nodo (texto y posición) y de cada conexión, ordenado. */
function visibleCanvas(page: Page) {
  return page.evaluate(() => ({
    nodes: [...document.querySelectorAll<HTMLElement>('.react-flow__node')]
      .map((n) => `${n.innerText}|${n.style.transform}|${n.querySelector('img') ? 'imagen' : ''}`)
      .sort(),
    edges: [...document.querySelectorAll('.kind-edge-label')].map((e) => e.textContent).sort(),
  }));
}
