import { expect, test, type Page } from '@playwright/test';
import { login, openNewFeature, png, saveStatus, seedCanvas } from './helpers';

const API = process.env.VITE_API_URL ?? 'http://localhost:5080';

/**
 * Fluidez (spec fluidez). Cámara del lienzo: «Ver todo» es una sola transición desde la vista actual —sin salto al empezar ni
 * vuelta atrás— y la persona la puede interrumpir arrastrando: la vista queda donde la dejó. No mide tiempos exactos:
 * mira la forma del recorrido cuadro a cuadro. Datos ficticios.
 */

/** Lienzo con cajas repartidas (para que «Ver todo» tenga que alejarse y desplazarse). */
function spreadGraph() {
  const nodes: Record<string, unknown> = {};
  const layout: Record<string, unknown> = {};
  for (let i = 0; i < 12; i++) {
    const id = `n${i}`;
    nodes[id] = { id, type: i % 2 ? 'api' : 'screen', title: `Caja ${i + 1}` };
    layout[id] = { x: (i % 4) * 520, y: Math.floor(i / 4) * 360 };
  }
  return { schemaVersion: 0, nodes, edges: {}, layout };
}

/** Transformación del viewport en cada cuadro mientras corre `action`, hasta que se queda quieta. */
async function framesDuring(page: Page, action: () => Promise<void>) {
  await page.evaluate(() => {
    const w = window as unknown as { __cam: string[]; __camOn: boolean };
    w.__cam = [];
    w.__camOn = true;
    const tick = () => {
      if (!w.__camOn) return;
      w.__cam.push((document.querySelector('.react-flow__viewport') as HTMLElement).style.transform);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await action();
  await page.waitForTimeout(900);
  return page.evaluate(() => {
    const w = window as unknown as { __cam: string[]; __camOn: boolean };
    w.__camOn = false;
    return w.__cam;
  });
}

const parse = (t: string) => {
  const m = /translate\(([-\d.e]+)px,\s*([-\d.e]+)px\)\s*scale\(([-\d.e]+)\)/.exec(t)!;
  return { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) };
};

test('«Ver todo» es una sola transición sin salto ni vuelta atrás, y arrastrar la interrumpe', async ({ page }) => {
  await login(page);
  await openNewFeature(page, 'Cámara');
  await seedCanvas(page, spreadGraph());
  // Acercarse primero: «Ver todo» tiene que alejarse y desplazarse.
  for (let i = 0; i < 3; i++) await page.keyboard.press('+');
  await page.waitForTimeout(700);

  const frames = (await framesDuring(page, () => page.getByRole('button', { name: 'Ajustar a la vista' }).click())).map(parse);
  const zooms = frames.map((f) => f.z);
  const start = zooms[0]!;
  const end = zooms.at(-1)!;
  expect(end).toBeLessThan(start);
  const moving = zooms.filter((z, i) => i > 0 && Math.abs(z - zooms[i - 1]!) > 1e-6);
  // Varios cuadros intermedios (no un corte) y el zoom solo baja: sin rebote ni corrección al final.
  expect(moving.length).toBeGreaterThan(5);
  for (let i = 1; i < zooms.length; i++) expect(zooms[i]!).toBeLessThanOrEqual(zooms[i - 1]! + 1e-6);
  // El primer cuadro que se mueve hace una parte chica del recorrido (en escala logarítmica): no arranca a mitad.
  const firstMove = zooms.find((z, i) => i > 0 && Math.abs(z - zooms[i - 1]!) > 1e-6)!;
  expect(Math.log(start / firstMove) / Math.log(start / end)).toBeLessThan(0.2);

  // Si ya está encuadrada, otra vez «Ver todo» no la mueve.
  const again = await framesDuring(page, () => page.keyboard.press('0'));
  expect(new Set(again).size).toBe(1);

  // Acercarse, pedir «Ver todo» y arrastrar el lienzo enseguida: la transición se corta y la vista queda donde la
  // dejó la persona (no termina de encuadrar después).
  for (let i = 0; i < 3; i++) await page.keyboard.press('+');
  await page.waitForTimeout(700);
  // Un punto del lienzo sin cajas encima (si cae sobre una caja, se arrastraría la caja).
  const p = await page.evaluate(() => {
    const pane = document.querySelector('.react-flow__pane')!.getBoundingClientRect();
    for (let y = pane.top + 60; y < pane.bottom - 100; y += 20) {
      for (let x = pane.left + 100; x < pane.right - 420; x += 20) {
        if (document.elementFromPoint(x, y)?.classList.contains('react-flow__pane')) return { x, y };
      }
    }
    return null;
  });
  expect(p).not.toBeNull();
  await page.keyboard.press('0');
  await page.mouse.move(p!.x, p!.y);
  await page.mouse.down();
  await page.mouse.move(p!.x + 60, p!.y - 40, { steps: 4 });
  await page.mouse.up();
  const afterDrag = await page.locator('.react-flow__viewport').evaluate((el) => (el as HTMLElement).style.transform);
  await page.waitForTimeout(700);
  expect(await page.locator('.react-flow__viewport').evaluate((el) => (el as HTMLElement).style.transform)).toBe(afterDrag);
});

test('abrir un lienzo con imágenes no lo deja «Sin guardar» ni corre las cajas al llegar las imágenes', async ({ page }) => {
  await login(page);
  await openNewFeature(page, 'Pantallas');
  const appId = /apps\/([^/]+)/.exec(page.url())![1]!;
  // Una imagen subida por la API y tres pantallas apiladas: la de arriba con imagen.
  const assetId = await page.evaluate(
    async ({ api, appId, bytes }) => {
      const key = Object.keys(sessionStorage).find((k) => k.startsWith('oidc.user:'))!;
      const token = (JSON.parse(sessionStorage.getItem(key)!) as { access_token: string }).access_token;
      const form = new FormData();
      form.append('file', new File([new Uint8Array(bytes)], 'pantalla.png', { type: 'image/png' }));
      const r = await fetch(`${api}/api/apps/${appId}/assets`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
      return ((await r.json()) as { id: string }).id;
    },
    { api: API, appId, bytes: [...png(320, 200)] },
  );
  await seedCanvas(page, {
    schemaVersion: 0,
    nodes: {
      a: { id: 'a', type: 'screen', title: 'Con imagen', assetId },
      b: { id: 'b', type: 'screen', title: 'Debajo' },
      c: { id: 'c', type: 'screen', title: 'Más abajo' },
    },
    edges: {},
    // «Debajo» queda justo bajo la caja sin imagen: si al llegar la imagen la caja creciera, la empujaría.
    layout: { a: { x: 0, y: 0 }, b: { x: 0, y: 136 }, c: { x: 0, y: 232 } },
  });
  await expect(page.locator('.react-flow__node[data-id="a"] img.pixel-node-image')).toBeVisible();
  await page.waitForTimeout(500);
  await expect(saveStatus(page)).toHaveText('Al día');
  const below = await page.locator('.react-flow__node[data-id="b"]').evaluate((el) => (el as HTMLElement).style.transform);
  await page.reload();
  await expect(page.locator('.react-flow__node[data-id="a"] img.pixel-node-image')).toBeVisible();
  await page.waitForTimeout(500);
  await expect(saveStatus(page)).toHaveText('Al día');
  expect(await page.locator('.react-flow__node[data-id="b"]').evaluate((el) => (el as HTMLElement).style.transform)).toBe(below);
});
