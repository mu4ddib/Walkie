import { expect, test, type Page } from '@playwright/test';
import { connect, dropNode, login, openNewFeature, saveStatus, seedCanvas } from './helpers';

/**
 * Feature deshacer-y-cajas (docs/features/deshacer-y-cajas/spec.md) con API, Keycloak y Postgres reales:
 * deshacer y rehacer cambios del lienzo, y grupos que crecen para que lo de dentro no sobresalga. Datos ficticios.
 */

const box = (page: Page, title: string) =>
  page.locator('.react-flow__node').filter({ has: page.locator('.pixel-node-title', { hasText: new RegExp(`^${title}$`) }) });
const group = (page: Page, title: string) =>
  page.locator('.react-flow__node-infraGroup').filter({ has: page.locator('.group-node-title', { hasText: new RegExp(`^${title}$`) }) });
const undoButton = (page: Page) => page.getByRole('button', { name: 'Deshacer', exact: true });
const redoButton = (page: Page) => page.getByRole('button', { name: 'Rehacer', exact: true });

/** Zoom actual del lienzo (para pasar de px de pantalla a unidades del lienzo). */
async function zoomOf(page: Page) {
  const transform = await page.locator('.react-flow__viewport').evaluate((el) => getComputedStyle(el).transform);
  return Number(/matrix\(([^,]+)/.exec(transform)?.[1] ?? 1);
}

/** Clic en un hueco del lienzo: nada seleccionado y el foco fuera de los campos. */
async function clickPane(page: Page) {
  const pane = (await page.locator('.react-flow__pane').boundingBox())!;
  await page.mouse.click(pane.x + pane.width * 0.4, pane.y + 12);
}

test('deshacer y rehacer: crear, conectar, renombrar, mover, borrar y volver a lo guardado', async ({ page }) => {
  await login(page);
  await openNewFeature(page, 'Historial');
  await expect(undoButton(page)).toBeDisabled();
  await expect(redoButton(page)).toBeDisabled();

  await dropNode(page, 'Pantalla', 140, 160);
  await dropNode(page, 'API', 460, 160);
  await connect(page, 0, 1);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await expect(undoButton(page)).toBeEnabled();

  // Renombrar desde el inspector: lo escrito en un campo es un solo paso.
  await box(page, 'API').click();
  const inspector = page.getByRole('complementary', { name: 'Propiedades' });
  await inspector.getByLabel('Título').fill('API usuarios');
  await inspector.getByLabel('Título').pressSequentially(' v2', { delay: 50 });
  await expect(box(page, 'API usuarios v2')).toBeVisible();

  // Mover la pantalla: el arrastre entero es un paso.
  const before = (await box(page, 'Pantalla').boundingBox())!;
  await page.mouse.move(before.x + 60, before.y + 30);
  await page.mouse.down();
  await page.mouse.move(before.x + 160, before.y + 130, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await box(page, 'Pantalla').boundingBox())!.x).toBeGreaterThan(before.x + 50);

  // Ctrl+Z, paso a paso hacia atrás (fuera de los campos de texto).
  await clickPane(page);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.canvas-hint')).toHaveText('Deshecho');
  await expect.poll(async () => Math.round((await box(page, 'Pantalla').boundingBox())!.x)).toBe(Math.round(before.x));
  await page.keyboard.press('Control+z');
  await expect(box(page, 'API')).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  await expect(redoButton(page)).toBeEnabled();

  // Rehacer con Ctrl+Mayús+Z y Ctrl+Y.
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await page.keyboard.press('Control+y');
  await expect(box(page, 'API usuarios v2')).toBeVisible();

  // Borrar una caja con su conexión y recuperarla con el botón.
  await box(page, 'API usuarios v2').click();
  await page.keyboard.press('Delete');
  await expect(box(page, 'API usuarios v2')).toHaveCount(0);
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  await undoButton(page).click();
  await expect(box(page, 'API usuarios v2')).toBeVisible();
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);

  // Deshacer hasta lo guardado deja el lienzo al día.
  await page.keyboard.press('Control+s');
  await expect(saveStatus(page)).toHaveText('Guardado');
  await clickPane(page);
  await dropNode(page, 'Servicio', 300, 380);
  await expect(saveStatus(page)).toContainText('Sin guardar');
  await clickPane(page);
  await page.keyboard.press('Control+z');
  await expect(box(page, 'Servicio')).toHaveCount(0);
  await expect(saveStatus(page)).not.toContainText('Sin guardar');
});

/** AWS (600 × 400) ⊃ microservicio usuarios (pegado al borde derecho de AWS), y un grupo suelto lejos. */
const nested = {
  schemaVersion: 0,
  nodes: { api: { id: 'api', type: 'api', title: 'API crear usuario', groupId: 'users' } },
  edges: {},
  layout: {
    aws: { x: 0, y: 0, w: 600, h: 400 },
    users: { x: 40, y: 80, w: 520, h: 280 },
    far: { x: 900, y: 600, w: 320, h: 200 },
    api: { x: 80, y: 160 },
  },
  groups: {
    aws: { id: 'aws', title: 'AWS', kind: 'cloud' },
    users: { id: 'users', title: 'microservicio usuarios', kind: 'backend', parentId: 'aws' },
    far: { id: 'far', title: 'Colas', kind: 'data' },
  },
  groupNesting: 'explicit',
};

test('cajas de grupo: crecen al meter o mover algo que sobresale, también los grupos de afuera, y se deshace', async ({
  page,
}) => {
  await login(page);
  await openNewFeature(page, 'Cajas');
  await seedCanvas(page, nested);
  const width = async (title: string) => (await group(page, title).boundingBox())!.width;
  const height = async (title: string) => (await group(page, title).boundingBox())!.height;
  const awsBefore = { w: await width('AWS'), h: await height('AWS') };
  const usersBefore = { w: await width('microservicio usuarios'), h: await height('microservicio usuarios') };

  // Una caja soltada junto al borde derecho de «microservicio usuarios»: su centro cae dentro, pero sobresale de
  // ese grupo y de AWS. Los dos crecen.
  const zoom = await zoomOf(page);
  const pane = (await page.locator('.canvas-flow').boundingBox())!;
  const users = (await group(page, 'microservicio usuarios').boundingBox())!;
  await dropNode(page, 'Servicio', users.x + users.width - 100 * zoom - pane.x, users.y + 120 * zoom - pane.y);
  await expect(group(page, 'microservicio usuarios')).toContainText('2 nodos');
  await expect.poll(() => width('microservicio usuarios')).toBeGreaterThan(usersBefore.w + 40 * zoom);
  await expect.poll(() => width('AWS')).toBeGreaterThan(awsBefore.w + 40 * zoom);
  const service = (await box(page, 'Servicio').boundingBox())!;
  const grown = (await group(page, 'microservicio usuarios').boundingBox())!;
  expect(grown.x + grown.width).toBeGreaterThanOrEqual(service.x + service.width);

  // Deshacer: la caja nueva y el crecimiento de ambos grupos se van en un solo paso.
  await clickPane(page);
  await page.keyboard.press('Control+z');
  await expect(box(page, 'Servicio')).toHaveCount(0);
  await expect.poll(() => width('microservicio usuarios')).toBeCloseTo(usersBefore.w, 0);
  await expect.poll(() => width('AWS')).toBeCloseTo(awsBefore.w, 0);

  // Mover una caja dentro de su grupo hasta que asome por abajo: el grupo (y AWS) crecen al soltarla.
  const api = (await box(page, 'API crear usuario').boundingBox())!;
  await page.mouse.move(api.x + 40, api.y + 20);
  await page.mouse.down();
  await page.mouse.move(api.x + 40, api.y + 20 + 150 * zoom, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => height('microservicio usuarios')).toBeGreaterThan(usersBefore.h + 20 * zoom);
  await expect.poll(() => height('AWS')).toBeGreaterThan(awsBefore.h);
  const outer = (await group(page, 'AWS').boundingBox())!;
  const inner = (await group(page, 'microservicio usuarios').boundingBox())!;
  expect(outer.y + outer.height).toBeGreaterThan(inner.y + inner.height);
  await expect(group(page, 'microservicio usuarios')).toContainText('1 nodo');

  // Desde el inspector: meter «Colas» (lejos) en AWS agranda AWS hasta abarcarla, sin moverla.
  const farBefore = (await group(page, 'Colas').boundingBox())!;
  await group(page, 'Colas').locator('.group-node-title').click();
  const inspector = page.getByRole('complementary', { name: 'Propiedades' });
  await inspector.getByLabel('Dentro del grupo').selectOption({ label: 'AWS' });
  const aws = (await group(page, 'AWS').boundingBox())!;
  const far = (await group(page, 'Colas').boundingBox())!;
  expect(far.x).toBeCloseTo(farBefore.x, 0);
  expect(aws.x + aws.width).toBeGreaterThanOrEqual(far.x + far.width);
  expect(aws.y + aws.height).toBeGreaterThanOrEqual(far.y + far.height);

  // Se guarda como cualquier cambio del lienzo.
  await page.keyboard.press('Control+s');
  await expect(saveStatus(page)).toHaveText('Guardado');
  await page.reload();
  await expect(group(page, 'AWS')).toContainText('1 nodo · 2 grupos');
  const reloaded = (await group(page, 'AWS').boundingBox())!;
  const farReloaded = (await group(page, 'Colas').boundingBox())!;
  expect(reloaded.x + reloaded.width).toBeGreaterThanOrEqual(farReloaded.x + farReloaded.width);
});
