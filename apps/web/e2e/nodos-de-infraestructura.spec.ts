import { expect, test, type Page } from '@playwright/test';
import { connect, dropNode, login, openNewFeature, saveStatus } from './helpers';

/**
 * Feature nodos-de-infraestructura (docs/features/nodos-de-infraestructura/spec.md) con API, Keycloak y Postgres
 * reales: crear recursos desde la barra (clic, teclado y arrastre), verlos con su subtipo, conectarlos con el tipo que
 * sugieren y guardarlos. Datos ficticios.
 */

/** Con `WALKIE_CAPTURES=<carpeta>`, guarda capturas para revisar el resultado visual. */
async function capture(page: Page, name: string) {
  const dir = process.env.WALKIE_CAPTURES;
  if (dir) await page.screenshot({ path: `${dir}/nodos-de-infraestructura-${name}.png` });
}

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

test('inspector del recurso, guardarlo como componente y reutilizarlo; runtime del servicio y modelo de la base', async ({
  page,
}) => {
  await login(page);
  await openNewFeature(page, 'Infraestructura editada');
  const inspector = page.getByRole('complementary', { name: 'Propiedades' });

  // Un bucket recién creado queda seleccionado: el inspector edita su recurso.
  await page.keyboard.press('8');
  await page.keyboard.press('Enter');
  await expect(inspector.getByRole('heading', { name: /Bucket/ })).toBeVisible();
  await inspector.getByLabel('Proveedor').selectOption({ label: 'AWS' });
  await inspector.getByLabel('Nombre del recurso').fill('comprobantes-prod');
  await inspector.getByRole('button', { name: '+ Detalle' }).click();
  await inspector.getByLabel('Clave').fill('clase');
  await inspector.getByLabel('Valor').fill('estándar');
  // A personalizado: se queda con «Bucket» como nombre, que se cambia.
  await inspector.getByLabel('Subtipo').selectOption({ label: 'Personalizado' });
  await expect(inspector.getByLabel('Nombre del subtipo')).toHaveValue('Bucket');
  await inspector.getByLabel('Nombre del subtipo').fill('Data Lake');
  const box = page.locator('.react-flow__node').first();
  await expect(box.locator('.pixel-node-kind')).toHaveText(/Data Lake/);
  await expect(box).toContainText('AWS · comprobantes-prod');
  await expect(box).toContainText('clase: estándar');
  await capture(page, '1-inspector');

  // Guardar como componente: pasa al catálogo y el nodo lo usa.
  await inspector.getByRole('button', { name: 'Guardar como componente' }).click();
  await expect(inspector.getByRole('heading', { name: /Data Lake · componente/ })).toBeVisible();
  await expect(inspector.getByLabel('Nombre del recurso')).toHaveValue('comprobantes-prod');

  // Desde «Componentes», filtrado por recursos, se usa de nuevo.
  await page.getByRole('button', { name: 'Componentes', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Catálogo' });
  await panel.getByRole('button', { name: 'Recurso', exact: true }).click();
  await panel.getByRole('button', { name: /Data Lake|Bucket/ }).click();
  await panel.getByRole('button', { name: 'Cerrar panel' }).click();
  await expect(page.locator('.pixel-node-kind', { hasText: 'Data Lake' })).toHaveCount(2);
  await capture(page, '2-componente');

  // Un servicio que corre en contenedor y una base documental.
  await dropNode(page, 'Servicio', 160, 360);
  await page.locator('.react-flow__node').last().click();
  await inspector.getByLabel('Dónde corre').selectOption({ label: 'Contenedor' });
  await dropNode(page, 'Base de datos', 480, 360);
  await page.locator('.react-flow__node').last().click();
  await inspector.getByLabel('Modelo').selectOption({ label: 'Documental (colecciones)' });

  // Guardar y recargar: todo vuelve.
  await page.keyboard.press('Control+s');
  await expect(saveStatus(page)).toHaveText('Guardado');
  await page.reload();
  await expect(page.locator('.pixel-node-kind', { hasText: 'Data Lake' })).toHaveCount(2);
  await page.locator('.react-flow__node', { hasText: 'Servicio' }).click();
  await expect(inspector.getByLabel('Dónde corre')).toHaveValue('container');
  await page.locator('.react-flow__node', { hasText: 'Base de datos' }).click();
  await expect(inspector.getByLabel('Modelo')).toHaveValue('document');
});
