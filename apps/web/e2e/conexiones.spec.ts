import { expect, test } from '@playwright/test';
import { connect, dropNode, login, saveStatus } from './helpers';

/**
 * Feature espacio-de-trabajo (docs/features/espacio-de-trabajo/spec.md), criterios 21 a 23, con API, Keycloak y
 * Postgres reales: el sentido animado se apaga con su interruptor (y se recuerda), cada tipo tiene su trazo y
 * en un tour se resaltan las conexiones del paso y se anima la que lleva al siguiente.
 */
test('conexiones con movimiento: interruptor, trazo por tipo y tour', async ({ page }) => {
  await login(page);
  const app = `E2E conexiones ${Date.now()}`;
  await page.getByLabel('Nueva app').fill(app);
  await page.getByRole('button', { name: 'Crear app' }).click();
  await page.getByRole('link', { name: app }).click();
  await page.getByLabel('Nueva feature').fill('Transferir');
  await page.getByRole('button', { name: 'Crear feature' }).click();
  await page.getByRole('link', { name: 'Transferir' }).click();

  await dropNode(page, 'Pantalla', 100, 140);
  await dropNode(page, 'API', 380, 140);
  await dropNode(page, 'Servicio', 380, 420);
  await connect(page, 0, 1);
  await connect(page, 1, 2);
  const edges = page.locator('.react-flow__edge');
  await expect(edges).toHaveCount(2);

  // Un evento entre API y servicio: su propio trazo (criterio 22).
  await page.locator('.kind-edge-label').nth(1).click();
  const props = page.getByRole('complementary', { name: 'Propiedades' });
  await props.getByLabel('Operación', { exact: true }).selectOption('service.invoke');
  await props.getByLabel('Patrón').selectOption('one-way');
  await expect(edges.nth(1).locator('.kind-edge')).toHaveClass(/kind-event/);
  await expect(edges.nth(0).locator('.kind-edge')).toHaveAttribute('marker-end', 'url(#walkie-arrow-closed)');

  // Seleccionada, el sentido se anima; el interruptor lo apaga y se recuerda (criterio 21).
  const canvas = page.locator('.canvas');
  await expect(canvas).toHaveClass(/edge-motion/);
  const flow = edges.nth(1).locator('.kind-edge-flow');
  await expect(flow).toHaveCSS('opacity', '1');
  await page.getByRole('button', { name: 'Animar el sentido de las conexiones' }).click();
  await expect(canvas).not.toHaveClass(/edge-motion/);
  await expect(flow).toHaveCSS('opacity', '0');

  // Tour Pantalla → API → Servicio.
  await page.locator('.react-flow__pane').click({ position: { x: 700, y: 650 } });
  await page.getByLabel('Nombre del tour nuevo').fill('Recorrido');
  await page.getByRole('button', { name: 'Nuevo tour' }).click();
  for (const label of ['Pantalla: Pantalla', 'API: API', 'Servicio: Servicio']) {
    await page.getByLabel('Nodo del paso nuevo').selectOption({ label });
    await page.getByRole('button', { name: 'Agregar paso' }).click();
  }
  await page.keyboard.press('Control+s');
  await expect(saveStatus(page)).toHaveText('Guardado');
  await page.reload();
  await expect(canvas).not.toHaveClass(/edge-motion/);
  await page.getByRole('button', { name: 'Animar el sentido de las conexiones' }).click();

  // En el tour: paso 1 resalta su conexión y la que lleva al paso 2; la otra se atenúa (criterio 23).
  await page.getByRole('button', { name: 'Recorrido' }).click();
  await page.getByRole('button', { name: 'Ver tour' }).click();
  await expect(edges.nth(0)).toHaveClass(/tour-edge-next/);
  await expect(edges.nth(1)).toHaveClass(/tour-edge-dim/);
  await page.keyboard.press('ArrowRight');
  await expect(edges.nth(0)).toHaveClass(/tour-edge(?!-)/);
  await expect(edges.nth(0)).not.toHaveClass(/tour-edge-next/);
  await expect(edges.nth(1)).toHaveClass(/tour-edge-next/);
});
