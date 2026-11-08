import { deflateSync } from 'node:zlib';
import { expect, type Page } from '@playwright/test';

/** Usuario de prueba del realm de desarrollo (infra/keycloak/walkie-realm.json). */
const USER = { username: 'dev', password: 'walkie_dev' };

/**
 * Inicia sesión desde la pantalla de login de Walkie. Si Keycloak ya tiene sesión (otra pestaña
 * del mismo contexto), vuelve sin pedir contraseña. Termina en la página que se abrió.
 */
export async function login(page: Page, path = '/') {
  await page.goto(path);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  const form = page.locator('#kc-login');
  const loggedIn = page.getByRole('button', { name: 'Salir' });
  // Lo que llegue primero: el formulario de Keycloak o la app ya con sesión.
  await expect(form.or(loggedIn)).toBeVisible({ timeout: 30_000 });
  if (await form.isVisible()) {
    await page.fill('#username', USER.username);
    await page.fill('#password', USER.password);
    await form.click();
  }
  await expect(loggedIn).toBeVisible({ timeout: 30_000 });
}

/** Crea una app y una feature con nombres únicos y abre su lienzo vacío. */
export async function openNewFeature(page: Page, feature = 'Iniciar sesión') {
  const app = `E2E ${Date.now()}`;
  await page.getByLabel('Nueva app').fill(app);
  await page.getByRole('button', { name: 'Crear app' }).click();
  await page.getByRole('link', { name: app }).click();
  await page.getByLabel('Nueva feature').fill(feature);
  await page.getByRole('button', { name: 'Crear feature' }).click();
  await page.getByRole('link', { name: feature }).click();
  await expect(page.locator('.react-flow')).toBeVisible();
}

/** Arrastra un tipo de la paleta al punto (x, y) del lienzo (HTML5 drag and drop). */
export async function dropNode(page: Page, label: string, x: number, y: number) {
  const pane = (await page.locator('.canvas-flow').boundingBox())!;
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await page.getByRole('button', { name: new RegExp(label) }).dispatchEvent('dragstart', { dataTransfer });
  await page.locator('.canvas-flow').dispatchEvent('drop', { dataTransfer, clientX: pane.x + x, clientY: pane.y + y });
}

/** Conecta el nodo `from` con `to` (índices en orden de creación) arrastrando entre sus puntos. */
export async function connect(page: Page, from: number, to: number) {
  const source = (await page.locator('.react-flow__node').nth(from).locator('.react-flow__handle-right').boundingBox())!;
  const target = (await page.locator('.react-flow__node').nth(to).locator('.react-flow__handle-left').boundingBox())!;
  await page.mouse.move(source.x + 4, source.y + 4);
  await page.mouse.down();
  await page.mouse.move(target.x + 4, target.y + 4, { steps: 10 });
  await page.mouse.up();
}

/** Renombra el nodo `index` con doble clic + Enter. */
export async function rename(page: Page, index: number, title: string) {
  await page.locator('.react-flow__node').nth(index).dblclick();
  await page.getByLabel('Título del nodo').fill(title);
  await page.keyboard.press('Enter');
}

/** Lo que el usuario ve del grafo: nodos (tipo, título, posición) y conexiones (tipo), ordenado. */
export async function visibleGraph(page: Page) {
  return page.evaluate(() => ({
    nodes: [...document.querySelectorAll<HTMLElement>('.react-flow__node')]
      .map((n) => `${n.querySelector('.pixel-node-kind')?.textContent}|${n.querySelector('.pixel-node-title')?.textContent}|${n.style.transform}`)
      .sort(),
    edges: [...document.querySelectorAll('.kind-edge-label')].map((e) => e.textContent).sort(),
  }));
}

export const saveStatus = (page: Page) => page.locator('.save-status');

/** PNG RGB válida de `width`×`height` con un degradado (sin datos de nadie). */
export function png(width: number, height: number): Buffer {
  const rows = Buffer.concat(
    Array.from({ length: height }, (_, y) =>
      Buffer.from([0, ...Array.from({ length: width }, (_, x) => [(x * 4) % 256, (y * 6) % 256, 180]).flat()]),
    ),
  );
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8 bits, RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
