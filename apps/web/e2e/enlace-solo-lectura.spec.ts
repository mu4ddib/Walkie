import { expect, test, type Page } from '@playwright/test';
import { dropNode, login, png, saveStatus } from './helpers';

/**
 * Feature enlace-solo-lectura (docs/features/enlace-solo-lectura/spec.md), criterios 1 a 10, con API,
 * Keycloak, Postgres y RustFS reales: crear un enlace, abrirlo en un navegador sin sesión, ver el lienzo
 * con imagen sin poder editarlo, recorrer su tour, ver un cambio guardado al recargar, revocar y ver el aviso.
 */
test('compartir una feature con un enlace de solo lectura y revocarlo', async ({ page, browser }) => {
  await login(page);
  const app = `E2E enlace ${Date.now()}`;
  await page.getByLabel('Nueva app').fill(app);
  await page.getByRole('button', { name: 'Crear app' }).click();
  await page.getByRole('link', { name: app }).click();
  for (const feature of ['Iniciar sesión', 'Transferir']) {
    await page.getByLabel('Nueva feature').fill(feature);
    await page.getByRole('button', { name: 'Crear feature' }).click();
    await expect(page.getByRole('link', { name: feature })).toBeVisible();
  }
  await page.getByRole('link', { name: 'Iniciar sesión' }).click();

  // Lienzo: pantalla con imagen (sintética), portal a Transferir y un tour de dos pasos.
  await dropNode(page, 'Pantalla', 80, 120);
  await page.getByLabel('Título', { exact: true }).fill('Login');
  await page.getByLabel('Subir imagen').setInputFiles({ name: 'login.png', mimeType: 'image/png', buffer: png(64, 40) });
  await expect(page.locator('.pixel-node img')).toBeVisible();
  await dropNode(page, 'Portal', 400, 120);
  await page.getByLabel('Feature destino').selectOption({ label: 'Transferir' });
  await page.locator('.react-flow__pane').click({ position: { x: 700, y: 600 } });
  await page.getByLabel('Nombre del tour nuevo').fill('Primer ingreso');
  await page.getByRole('button', { name: 'Nuevo tour' }).click();
  await page.getByLabel('Nodo del paso nuevo').selectOption({ label: 'Pantalla: Login' });
  await page.getByRole('button', { name: 'Agregar paso' }).click();
  await page.getByLabel('Paso 1: nota', { exact: true }).fill('Aquí empieza todo: el usuario escribe su documento.');
  await page.getByLabel('Nodo del paso nuevo').selectOption({ label: 'Portal: Transferir' });
  await page.getByRole('button', { name: 'Agregar paso' }).click();
  await page.keyboard.press('Control+s');
  await expect(saveStatus(page)).toHaveText('Guardado');

  // Crear el enlace: aviso, 30 días por defecto, la URL una vez y la lista (criterios 1 a 3).
  await page.getByRole('button', { name: 'Compartir' }).click();
  const dialog = page.getByRole('dialog', { name: 'Compartir' });
  await expect(dialog.getByRole('note')).toHaveText(
    'Quien tenga el enlace verá este lienzo, sus imágenes y sus tours sin iniciar sesión.',
  );
  await expect(dialog.getByLabel('Duración')).toHaveValue('30');
  await dialog.getByRole('button', { name: 'Crear enlace' }).click();
  const url = await dialog.getByLabel('Enlace nuevo').inputValue();
  expect(url).toMatch(/\/s\/[A-Za-z0-9_-]{43}$/);
  await expect(dialog.getByRole('listitem')).toContainText('Nunca abierto');
  await dialog.getByRole('button', { name: 'Cerrar' }).click();

  // Abrirlo sin sesión, en otro navegador (criterios 5 y 6).
  const reader = await (await browser.newContext()).newPage();
  await reader.goto(url);
  await expect(reader.getByRole('heading', { name: `${app} / Iniciar sesión` })).toBeVisible();
  await expect(reader.getByRole('status')).toContainText('Solo lectura · disponible hasta el');
  await expect(reader.getByRole('button', { name: 'Iniciar sesión' })).toHaveCount(0);
  await expect(reader.locator('.pixel-node img')).toBeVisible();
  expect(await reader.locator('.pixel-node img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(64);
  await expect(reader.locator('.palette')).toHaveCount(0);
  await expect(reader.getByRole('complementary', { name: 'Propiedades' })).toHaveCount(0);
  await expect(reader.getByRole('button', { name: 'Guardar' })).toHaveCount(0);
  const loginNode = reader.locator('.react-flow__node').first();
  const before = await loginNode.getAttribute('style');
  await dragBy(reader, loginNode, 100, 60);
  expect(await loginNode.getAttribute('style')).toBe(before);

  // El portal muestra su título y no se abre (criterio 8).
  const portal = reader.locator('.react-flow__node').nth(1);
  await expect(portal.locator('.pixel-node-title')).toHaveText('→ Transferir');
  await portal.dblclick({ force: true }); // sin eventos de puntero en solo lectura: `force` para probarlo
  await expect(reader).toHaveURL(url);

  // El tour funciona como en el editor, sin "Ir a" en el portal (criterios 7 y 8).
  await reader.getByRole('button', { name: 'Ver tour Primer ingreso' }).click();
  const bar = reader.getByRole('toolbar', { name: 'Tour' });
  await expect(bar.getByRole('status')).toHaveText('Paso 1 de 2');
  await expect(reader.getByRole('region', { name: 'Paso del tour' })).toContainText('Aquí empieza todo');
  await reader.keyboard.press('ArrowRight');
  await expect(bar.getByRole('status')).toHaveText('Paso 2 de 2');
  await expect(reader.getByRole('button', { name: /^Ir a/ })).toHaveCount(0);
  await reader.keyboard.press('Escape');
  await expect(bar).toBeHidden();

  // El autor ve el último acceso (criterio 3) y guarda un cambio; el lector lo ve al recargar (criterio 9).
  await page.getByRole('button', { name: 'Compartir' }).click();
  await expect(dialog.getByRole('listitem')).toContainText('último acceso:');
  await dialog.getByRole('button', { name: 'Cerrar' }).click();
  await page.locator('.react-flow__node').first().click();
  await page.getByLabel('Título', { exact: true }).fill('Login con documento');
  await page.keyboard.press('Control+s');
  await expect(saveStatus(page)).toHaveText('Guardado');
  await reader.reload();
  await expect(reader.locator('.react-flow__node').first().locator('.pixel-node-title')).toHaveText(
    'Login con documento',
  );

  // Revocar: sale de la lista y el enlace deja de funcionar en el acto (criterios 4 y 10).
  await page.getByRole('button', { name: 'Compartir' }).click();
  await dialog.getByRole('button', { name: /^Revocar/ }).click();
  await expect(dialog.getByText('No hay enlaces activos.')).toBeVisible();
  await reader.reload();
  await expect(reader.getByRole('alert')).toContainText('Este enlace ya no está disponible');
  await expect(reader.locator('.react-flow__node')).toHaveCount(0);
});

/** Arrastra el elemento con el mouse; en un lienzo de solo lectura no debe moverse. */
async function dragBy(page: Page, locator: ReturnType<Page['locator']>, dx: number, dy: number) {
  const box = (await locator.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 20 + dx, box.y + 20 + dy, { steps: 5 });
  await page.mouse.up();
}
