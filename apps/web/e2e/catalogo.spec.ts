import { expect, test, type Page } from '@playwright/test';
import { connect, dropNode, login, saveStatus } from './helpers';

/**
 * Feature catalogo (docs/features/catalogo/spec.md), criterios 5, 7, 10b y 11, con API, Keycloak y
 * Postgres reales: un elemento del catálogo usado con `ref` en dos features, editado una vez y visto
 * cambiado en ambas; "Mover al catálogo"; guardar y recargar idéntico; borrado bloqueado por uso.
 */
test('catálogo compartido entre dos lienzos con ref, Mover al catálogo y borrado protegido', async ({ page }) => {
  await login(page);
  const app = `E2E catálogo ${Date.now()}`;
  await page.getByLabel('Nueva app').fill(app);
  await page.getByRole('button', { name: 'Crear app' }).click();
  await page.getByRole('link', { name: app }).click();
  for (const feature of ['Transferir', 'Pagar']) {
    await page.getByLabel('Nueva feature').fill(feature);
    await page.getByRole('button', { name: 'Crear feature' }).click();
    await expect(page.getByRole('link', { name: feature })).toBeVisible();
  }

  // Catálogo: una API con método y ruta (criterios 2 y 3).
  await page.getByRole('link', { name: 'Catálogo de la app' }).click();
  const form = page.getByRole('form', { name: 'Nuevo elemento' });
  await form.getByLabel('Título').fill('Consultar cliente');
  await form.getByRole('button', { name: 'Crear elemento' }).click();
  const detail = page.getByRole('complementary', { name: 'Detalle del elemento' });
  await detail.getByLabel('Método').selectOption('GET');
  await detail.getByLabel('Ruta HTTP').fill('/clientes/{id}');
  await detail.getByRole('button', { name: 'Guardar' }).click();
  await expect(detail.getByText('Guardado')).toBeVisible();

  // Las dos features usan el elemento con un ref conectado a una pantalla (criterios 6, 9 y 11).
  for (const feature of ['Transferir', 'Pagar']) {
    await openFeature(page, app, feature);
    await dropNode(page, 'Pantalla', 80, 120);
    // El catálogo está en el panel "Componentes" de la barra de herramientas (spec espacio-de-trabajo).
    await page.getByRole('button', { name: 'Componentes' }).click();
    await dropNode(page, 'Consultar cliente', 400, 120);
    await page.getByRole('button', { name: 'Componentes' }).click();
    await connect(page, 0, 1);
    await page.locator('.react-flow__pane').click({ position: { x: 700, y: 600 } });
    await expect(page.locator('.kind-edge-label')).toHaveText('llama');
    await page.keyboard.press('Control+s');
    await expect(saveStatus(page)).toHaveText('Guardado');
  }

  // "Mover al catálogo" en Pagar: el nodo pasa a ref con su posición y conexión (criterio 10b).
  await dropNode(page, 'Base de datos', 400, 360);
  await field(page, 'Título').fill('Pagos');
  await connect(page, 1, 2);
  await page.locator('.react-flow__node').nth(2).click();
  await page.getByRole('button', { name: 'Mover al catálogo' }).click();
  await expect(page.locator('.react-flow__node').nth(2).locator('.pixel-node')).toHaveAttribute('data-ref', 'ok');
  await expect(page.getByRole('link', { name: 'Editar en el catálogo' })).toBeVisible();
  await expect(saveStatus(page)).toHaveText('Sin guardar');

  // Guardar y recargar idéntico (criterio 11).
  await page.locator('.react-flow__pane').click({ position: { x: 700, y: 600 } });
  const before = await visibleCanvas(page);
  await page.keyboard.press('Control+s');
  await expect(saveStatus(page)).toHaveText('Guardado');
  await page.reload();
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  expect(await visibleCanvas(page)).toEqual(before);

  // Editar en el catálogo se ve en los dos lienzos (criterio 7).
  await page.locator('.pixel-node', { hasText: 'Consultar cliente' }).click();
  await page.getByRole('link', { name: 'Editar en el catálogo' }).click();
  await detail.getByLabel('Título').fill('Buscar cliente');
  await detail.getByRole('button', { name: 'Guardar' }).click();
  await expect(detail.getByText('Guardado')).toBeVisible();
  const usages = page.getByRole('region', { name: 'Usado en' });
  await expect(usages.getByRole('link')).toHaveText(['Pagar', 'Transferir']);
  for (const feature of ['Pagar', 'Transferir']) {
    await page.goto(page.url()); // vuelve a cargar el detalle y sus "Usado en"
    await page.getByRole('region', { name: 'Usado en' }).getByRole('link', { name: feature }).click();
    await expect(page.locator('.pixel-node[data-ref="ok"] .pixel-node-title').first()).toHaveText('Buscar cliente');
    await expect(page.locator('.pixel-node[data-ref="ok"] .pixel-node-http').first()).toHaveText('GET /clientes/{id}');
    await page.goBack();
  }

  // Borrar un elemento en uso: la API lo impide y la UI lista los lienzos (criterio 5).
  await detail.getByRole('button', { name: 'Borrar elemento' }).click();
  const blocked = detail.getByRole('alert');
  await expect(blocked).toContainText('No se puede borrar');
  await expect(blocked.getByRole('link')).toHaveText(['Pagar', 'Transferir']);
  await expect(page.getByRole('region', { name: 'API' }).getByRole('link', { name: 'Buscar cliente' })).toBeVisible();
});

/** Campo del panel por su etiqueta exacta. */
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });

/** Abre una feature: desde una página con miga de pan, por el enlace de la app; desde el editor, con su selector. */
async function openFeature(page: Page, app: string, feature: string) {
  const ruta = page.getByRole('navigation', { name: 'Ruta' });
  const appLink = ruta.getByRole('link', { name: app });
  if ((await appLink.count()) > 0) {
    await appLink.click();
    await page.getByRole('link', { name: feature, exact: true }).click();
  } else {
    await ruta.getByRole('button').last().click();
    await page.getByRole('dialog', { name: 'Cambiar de feature' }).getByRole('link', { name: feature, exact: true }).click();
  }
  await expect(ruta).toContainText(feature);
  await expect(page.locator('.react-flow')).toBeVisible();
}

/** Lo que se ve de cada nodo (texto y posición) y de cada conexión, ordenado. */
function visibleCanvas(page: Page) {
  return page.evaluate(() => ({
    nodes: [...document.querySelectorAll<HTMLElement>('.react-flow__node')]
      .map((n) => `${n.innerText}|${n.style.transform}`)
      .sort(),
    edges: [...document.querySelectorAll('.kind-edge-label')].map((e) => e.textContent).sort(),
  }));
}
