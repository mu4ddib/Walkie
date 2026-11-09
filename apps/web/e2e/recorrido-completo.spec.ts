import { expect, test, type Page } from '@playwright/test';
import { connect, dropNode, login, saveStatus, visibleGraph } from './helpers';

/**
 * Feature espacio-de-trabajo (docs/features/espacio-de-trabajo/spec.md), criterio 24, con API, Keycloak y Postgres
 * reales: primer ingreso → app y feature → nodos → conexión → documentación técnica → componente compartido →
 * grupo → recargar idéntico; capturas en 1440, 1024 y 768 px de ancho (adjuntas al reporte y, con
 * `WALKIE_CAPTURES=<carpeta>`, guardadas ahí).
 */
test('recorrido completo del espacio de trabajo y capturas en tres anchos', async ({ page }, testInfo) => {
  // Primer ingreso: la base de pruebas ya tiene apps de otras pruebas, así que la lista llega vacía hasta crear
  // la primera, como la vería alguien nuevo. Crear la app y la feature va a la API real.
  await page.route('**/api/apps', async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ json: [] });
    else await route.continue();
  });
  await login(page, '/');
  const app = `E2E recorrido ${Date.now()}`;
  await page.getByLabel('Nombre de la app').fill(app);
  await page.getByLabel('Primera feature').fill('Transferir');
  await page.getByRole('button', { name: 'Crear y abrir el lienzo' }).click();
  await page.unroute('**/api/apps');
  const ruta = page.getByRole('navigation', { name: 'Ruta' });
  await expect(ruta).toContainText(app);
  await expect(ruta).toContainText('Transferir');
  await expect(page.getByRole('note', { name: 'Cómo empezar' })).toBeVisible();

  // Nodos y conexiones.
  await dropNode(page, 'Pantalla', 100, 140);
  await dropNode(page, 'API', 420, 140);
  await dropNode(page, 'Base de datos', 420, 440);
  await connect(page, 0, 1);
  await connect(page, 1, 2);
  await expect(page.locator('.kind-edge-label')).toHaveText(['llama', 'lee']);

  // Documentación técnica de la API y de la base.
  const inspector = page.getByRole('complementary', { name: 'Propiedades' });
  await node(page, 'API').click();
  await inspector.getByLabel('Título', { exact: true }).fill('Crear transferencia');
  await inspector.getByLabel('Método', { exact: true }).selectOption('POST');
  await inspector.getByLabel('Ruta HTTP').fill('/transferencias');
  const contract = inspector.getByRole('group', { name: 'Contrato de la API' });
  await contract.locator('summary', { hasText: 'Autenticación' }).click();
  await contract.getByLabel('Tipo de autenticación').selectOption('bearer');
  await contract.locator('summary', { hasText: 'Respuestas' }).click();
  await contract.getByRole('button', { name: '+ Respuesta' }).click();
  await contract.getByLabel('Significado').fill('Transferencia creada');
  await node(page, 'Base de datos').click();
  await inspector.getByLabel('Motor').fill('PostgreSQL');

  // Componente compartido: la API pasa al catálogo con su contrato.
  await node(page, 'Crear transferencia').click();
  await inspector.getByRole('button', { name: 'Guardar como componente' }).click();
  await expect(node(page, 'Crear transferencia').locator('.pixel-node')).toHaveAttribute('data-ref', 'ok');
  await expect(inspector.getByRole('region', { name: 'Definición compartida' })).toBeVisible();

  // Grupo de backend con la API y la base.
  await node(page, 'Base de datos').click({ modifiers: ['Shift'] });
  await page.keyboard.press('g');
  await inspector.getByLabel('Nombre del grupo').fill('Core bancario');
  await inspector.getByLabel('Tipo de grupo').selectOption('backend');
  await expect(page.locator('.group-node')).toContainText('2 nodos');

  // Guardar y recargar: idéntico.
  await page.locator('.react-flow__pane').click({ position: { x: 20, y: 600 } });
  await page.keyboard.press('Control+s');
  await expect(saveStatus(page)).toHaveText('Guardado');
  const before = { graph: await visibleGraph(page), group: await page.locator('.group-node').textContent() };
  await page.reload();
  await expect(saveStatus(page)).toHaveText('Al día');
  await expect(page.locator('.pixel-node')).toHaveCount(3);
  expect({ graph: await visibleGraph(page), group: await page.locator('.group-node').textContent() }).toEqual(before);

  // Capturas en tres anchos: sin desborde horizontal y con barra, zoom e inspector a la vista.
  for (const width of [1440, 1024, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await node(page, 'Crear transferencia').click();
    await page.keyboard.press('0');
    await page.waitForTimeout(400);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `desborde horizontal a ${width} px`).toBeLessThanOrEqual(0);
    await expect(page.getByRole('navigation', { name: 'Herramientas' })).toBeInViewport();
    await expect(page.getByRole('group', { name: 'Zoom' })).toBeInViewport();
    await expect(inspector).toBeInViewport({ ratio: 0.3 });
    await expectNoOverlap(page, width);
    const path = process.env.WALKIE_CAPTURES
      ? `${process.env.WALKIE_CAPTURES}/espacio-de-trabajo-${width}.png`
      : testInfo.outputPath(`espacio-de-trabajo-${width}.png`);
    await page.screenshot({ path });
    await testInfo.attach(`${width} px`, { path, contentType: 'image/png' });
  }
});

const node = (page: Page, title: string) =>
  page.locator('.react-flow__node').filter({ has: page.locator('.pixel-node-title', { hasText: new RegExp(`^${title}$`) }) });

/** Barra de herramientas, zoom, pista e inspector flotan sobre el lienzo: ninguno tapa a otro. */
async function expectNoOverlap(page: Page, width: number) {
  const boxes = await page.evaluate(() =>
    ['.palette', '.zoom-controls', '.canvas-hint', '.inspector']
      .map((selector) => {
        const el = document.querySelector(selector);
        if (!el || getComputedStyle(el).display === 'none') return null;
        const r = el.getBoundingClientRect();
        return { selector, left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      })
      .filter((b) => b !== null),
  );
  for (const [i, a] of boxes.entries()) {
    for (const b of boxes.slice(i + 1)) {
      const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      expect(overlap, `${a.selector} y ${b.selector} se tapan a ${width} px`).toBe(false);
    }
  }
}
