import { expect, test, type Locator } from '@playwright/test';
import { login, openNewFeature, seedCanvas } from './helpers';

/**
 * Cajas que no se montan (ajuste pedido tras modulos-compartidos): un grupo vacío creado con G cae en un hueco libre y
 * una caja que crece empuja a la de abajo. Datos ficticios.
 */

async function rect(locator: Locator) {
  return (await locator.boundingBox())!;
}

const touch = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('G sin selección crea un grupo en un hueco libre; una caja que crece empuja a la de abajo', async ({ page }) => {
  await login(page);
  await openNewFeature(page, 'Pagos');
  await seedCanvas(page, {
    schemaVersion: 0,
    groupNesting: 'explicit',
    nodes: {
      cat: { id: 'cat', type: 'api', title: 'crearCatalogo', groupId: 'g1' },
      pago: { id: 'pago', type: 'api', title: 'crearPago', groupId: 'g2' },
      comp: { id: 'comp', type: 'api', title: 'CrearComprobante', groupId: 'g2' },
    },
    edges: {},
    layout: {
      g1: { x: 0, y: 0, w: 360, h: 300 },
      g2: { x: 420, y: 0, w: 340, h: 400 },
      cat: { x: 40, y: 80 },
      pago: { x: 460, y: 80 },
      comp: { x: 460, y: 220 },
    },
    groups: {
      g1: { id: 'g1', title: 'Microservicio catálogo', kind: 'custom' },
      g2: { id: 'g2', title: 'Microservicio pagos', kind: 'custom' },
    },
  });

  await page.locator('.react-flow__pane').click({ position: { x: 600, y: 600 } });
  await page.keyboard.press('g');
  await expect(page.locator('.group-node')).toHaveCount(3);
  await expect(page.getByText('Grupo vacío: arrastra cajas o grupos dentro')).toBeVisible();
  const created = page.locator('.react-flow__node.selected .group-node');
  const fresh = await rect(created);
  for (const title of ['Microservicio catálogo', 'Microservicio pagos']) {
    const other = await rect(page.locator('.group-node').filter({ hasText: title }));
    expect(touch(fresh, other)).toBe(false);
  }

  // Una descripción larga hace crecer crearPago: CrearComprobante baja en vez de quedar debajo.
  const pago = page.locator('.react-flow__node').filter({ has: page.locator('.pixel-node-title', { hasText: /^crearPago$/ }) });
  const comp = page.locator('.react-flow__node').filter({ has: page.locator('.pixel-node-title', { hasText: /^CrearComprobante$/ }) });
  await pago.click();
  await page
    .getByRole('complementary', { name: 'Propiedades' })
    .getByLabel('Descripción')
    .fill('Registra el pago del cliente con su medio, valida el monto contra el saldo y deja el comprobante listo para emitir.');
  await expect.poll(async () => touch(await rect(pago), await rect(comp))).toBe(false);
  // La seleccionada queda encima de sus vecinas.
  expect(Number(await pago.evaluate((el) => getComputedStyle(el).zIndex))).toBeGreaterThan(0);
});
