import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { login } from './helpers';
import { BIG_API, openReview, scanBigReview } from './revision-inspector.fixture';

/**
 * Inspector de «Revisión del análisis» con un hallazgo de evidencia extensa (una API que llaman 36 pantallas, rutas
 * largas): cabe en el área visible, se desplaza por dentro sin arrastrar la página (ni al final ni al principio), la
 * página se desplaza fuera de él, se llega a la última acción, cambiar de hallazgo no salta, y en pantallas angostas
 * todo va apilado sin scroll anidado. Se mide geometría y posiciones de scroll (no capturas). Corre en Chromium y,
 * con `WALKIE_BROWSER=webkit`, en el motor de Safari.
 */
let reviewUrl = '';

async function capture(page: Page, name: string) {
  const dir = process.env.WALKIE_CAPTURES;
  if (dir) await page.screenshot({ path: join(dir, `inspector-${name}-${test.info().project.name}.png`) });
}

/** Dos cuadros: lo que movió la rueda ya está aplicado (sin esperas por tiempo). */
async function settle(page: Page) {
  for (let i = 0; i < 3; i++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

const geometry = (page: Page) =>
  page.evaluate(() => {
    const main = document.querySelector<HTMLElement>('.app-main')!;
    const panel = document.querySelector<HTMLElement>('.discovery-inspector')!;
    const m = main.getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    return {
      main: { top: m.top, bottom: m.bottom, scrollTop: main.scrollTop, scrollWidth: main.scrollWidth, clientWidth: main.clientWidth },
      panel: { top: p.top, bottom: p.bottom, left: p.left, right: p.right, scrollTop: panel.scrollTop, scrollHeight: panel.scrollHeight, clientHeight: panel.clientHeight, scrollWidth: panel.scrollWidth, clientWidth: panel.clientWidth, overflowY: getComputedStyle(panel).overflowY },
      page: { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth },
      overscroll: getComputedStyle(panel).overscrollBehaviorY,
    };
  });

/** Sin desbordamiento horizontal en la página, el área principal ni el inspector. */
async function expectNoHorizontalOverflow(page: Page) {
  const g = await geometry(page);
  expect(g.page.scrollWidth, 'página').toBeLessThanOrEqual(g.page.width);
  expect(g.main.scrollWidth, '.app-main').toBeLessThanOrEqual(g.main.clientWidth);
  expect(g.panel.scrollWidth, 'inspector').toBeLessThanOrEqual(g.panel.clientWidth);
  expect(g.panel.right).toBeLessThanOrEqual(g.page.width);
}

async function openBigFinding(page: Page): Promise<{ list: Locator; inspector: Locator; row: Locator }> {
  await login(page, reviewUrl);
  const list = page.getByRole('list', { name: 'Hallazgos' });
  const row = list.getByRole('button', { name: BIG_API });
  await row.click();
  const inspector = page.getByRole('complementary', { name: 'Detalle del hallazgo' });
  // La evidencia y las relaciones (las 36 llamadas) ya están dibujadas: es su alto final.
  await expect(inspector.getByRole('region', { name: 'Evidencia' })).toContainText('Relaciones');
  await expect(row).toHaveAttribute('aria-current', 'true');
  return { list, inspector, row };
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  const page = await browser.newPage();
  reviewUrl = await openReview(page, scanBigReview());
  await page.close();
});

for (const [width, height] of [
  [1440, 900],
  [1280, 800],
  [1024, 768],
] as const) {
  test(`escritorio ${width}×${height}: el inspector cabe, se desplaza solo y no arrastra la página`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height });
    const { list, inspector } = await openBigFinding(page);
    await page.getByRole('main').evaluate((m) => (m.scrollTop = 0));
    await settle(page);

    // 1. Cabe entero en el área visible (bajo la barra superior) y 2. su contenido se desplaza por dentro.
    let g = await geometry(page);
    expect(g.panel.top).toBeGreaterThanOrEqual(g.main.top);
    expect(g.panel.bottom).toBeLessThanOrEqual(g.main.bottom + 0.5);
    expect(g.panel.scrollHeight).toBeGreaterThan(g.panel.clientHeight);
    expect(g.overscroll).toBe('contain');
    // «Volver a la lista» es solo del diseño apilado.
    await expect(inspector.getByRole('button', { name: '← Volver a la lista' })).toBeHidden();
    await expectNoHorizontalOverflow(page);
    // La lista conserva un ancho legible junto al inspector.
    const listWidth = (await list.boundingBox())!.width;
    expect(listWidth).toBeGreaterThanOrEqual(width >= 1280 ? 560 : 440);
    await capture(page, `${width}`);

    // 6. Fuera del inspector, la rueda desplaza la página.
    const listBox = (await list.boundingBox())!;
    await page.mouse.move(listBox.x + 40, Math.min(listBox.y + 200, height - 40));
    await page.mouse.wheel(0, 300);
    await expect.poll(async () => (await geometry(page)).main.scrollTop).toBeGreaterThan(0);
    await settle(page);
    const mainAt = (await geometry(page)).main.scrollTop;
    g = await geometry(page);
    // Sticky: sigue entero a la vista con la página desplazada.
    expect(g.panel.top).toBeGreaterThanOrEqual(g.main.top);
    expect(g.panel.bottom).toBeLessThanOrEqual(g.main.bottom + 0.5);

    // 3 y 4. Sobre el inspector la rueda lo lleva hasta el final; seguir no mueve la página.
    const box = (await inspector.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect
      .poll(async () => {
        await page.mouse.wheel(0, 1200);
        const p = (await geometry(page)).panel;
        return p.scrollTop + p.clientHeight >= p.scrollHeight - 1;
      })
      .toBe(true);
    for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 1200);
    await settle(page);
    expect((await geometry(page)).main.scrollTop).toBe(mainAt);
    const buttons = inspector.getByRole('button');
    const last = buttons.nth((await buttons.count()) - 1);
    await expect(last).toBeInViewport();
    const lastBox = (await last.boundingBox())!;
    expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(box.y + box.height);

    // 5. Hasta el principio y más allá: la página tampoco se mueve.
    await expect
      .poll(async () => {
        await page.mouse.wheel(0, -1200);
        return (await geometry(page)).panel.scrollTop;
      })
      .toBe(0);
    for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -1200);
    await settle(page);
    expect((await geometry(page)).main.scrollTop).toBe(mainAt);
  });
}

test('teclado: el inspector se alcanza con Tab y se recorre con Av Pág, Fin e Inicio', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const { inspector } = await openBigFinding(page);
  await inspector.focus();
  await expect(inspector).toBeFocused();
  await page.keyboard.press('PageDown');
  await expect.poll(async () => (await geometry(page)).panel.scrollTop).toBeGreaterThan(0);
  await page.keyboard.press('End');
  await expect
    .poll(async () => {
      const p = (await geometry(page)).panel;
      return p.scrollTop + p.clientHeight >= p.scrollHeight - 1;
    })
    .toBe(true);
  await page.keyboard.press('Home');
  await expect.poll(async () => (await geometry(page)).panel.scrollTop).toBe(0);
  // El último control se alcanza con Tab y queda a la vista dentro del panel.
  const buttons = inspector.getByRole('button');
  const last = buttons.nth((await buttons.count()) - 1);
  await last.focus();
  await expect(last).toBeInViewport();
});

test('cambiar de hallazgo: el nuevo empieza arriba, la lista y la página no saltan; abrir una vista previa no mueve el panel', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const { list, inspector } = await openBigFinding(page);

  // Una vista previa dentro del mismo hallazgo (contrato y botones): el panel no vuelve arriba solo.
  await inspector.getByRole('button', { name: 'Crear en el catálogo…' }).click();
  const preview = inspector.getByRole('region', { name: 'Lo que se creará' });
  await expect(preview).toContainText('/api/clientes-corporativos/');
  await inspector.evaluate((p) => (p.scrollTop = p.scrollHeight / 2));
  const middle = (await geometry(page)).panel.scrollTop;
  await settle(page);
  expect((await geometry(page)).panel.scrollTop).toBe(middle);
  const confirm = inspector.getByRole('button', { name: 'Confirmar y crear' });
  await confirm.scrollIntoViewIfNeeded();
  await expect(confirm).toBeInViewport();
  await expectNoHorizontalOverflow(page);

  // Otro hallazgo, visible en la lista: el panel empieza arriba con su título, sin mover la página ni la fila.
  await inspector.evaluate((p) => (p.scrollTop = p.scrollHeight / 2));
  const other = list.getByRole('button', { name: /api:POST \/api\/clientes-corporativos/ });
  await other.scrollIntoViewIfNeeded();
  await settle(page);
  const before = { main: (await geometry(page)).main.scrollTop, row: (await other.boundingBox())!.y };
  await other.click();
  await expect(other).toHaveAttribute('aria-current', 'true');
  await expect(inspector.getByRole('heading', { level: 3 })).toContainText('POST');
  await settle(page);
  const after = await geometry(page);
  expect(after.panel.scrollTop).toBe(0);
  expect(after.main.scrollTop).toBe(before.main);
  expect((await other.boundingBox())!.y).toBe(before.row);
  await expect(inspector.getByRole('heading', { level: 3 })).toBeInViewport();
  await expect(list.locator('[aria-current="true"]')).toHaveCount(1);
});

for (const [width, height, label] of [
  [768, 1024, '768×1024'],
  [390, 844, '390×844'],
  [640, 400, '1280×800 al 200 %'],
] as const) {
  test(`pantalla angosta ${label}: apilado, sin scroll anidado, se llega a decidir y se vuelve a la lista`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height });
    const { inspector, row } = await openBigFinding(page);

    // Elegir lleva al detalle (enfocado y a la vista).
    await expect(inspector).toBeFocused();
    await expect(inspector.getByRole('heading', { level: 3 })).toBeInViewport();
    const g = await geometry(page);
    // Sin scroll propio: la página se desplaza una sola vez.
    expect(g.panel.overflowY).toBe('visible');
    expect(g.panel.scrollHeight).toBeLessThanOrEqual(g.panel.clientHeight + 1);
    await expectNoHorizontalOverflow(page);

    // Cada botón cabe en el ancho; el último se alcanza desplazando la página.
    const buttons = inspector.getByRole('button');
    for (let i = 0; i < (await buttons.count()); i++) {
      const b = (await buttons.nth(i).boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(width);
    }
    const last = buttons.nth((await buttons.count()) - 1);
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    if (width === 390) await capture(page, '390');

    // Volver a la lista: su fila, enfocada y a la vista.
    await inspector.getByRole('button', { name: '← Volver a la lista' }).click();
    await expect(row).toBeFocused();
    await expect(row).toBeInViewport();
  });
}
