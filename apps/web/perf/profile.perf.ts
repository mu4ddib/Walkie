import { test, type Page } from '@playwright/test';
import { login } from '../e2e/helpers';
import type { Scale } from './fixtures';
import { instrument, seed, visibleBoxes } from './harness';

/**
 * Perfil de CPU de un escenario (para encontrar qué se ejecuta): `WALKIE_PROFILE=<desplazar|arrastrar|deshacer|ver-todo|escribir>`
 * con `WALKIE_PERF_READABLE=1` (sin minificar). Imprime las funciones con más tiempo propio.
 */
const list = (process.env.WALKIE_PROFILE ?? '').split(',').filter(Boolean);
const scale = (process.env.WALKIE_SCALES ?? 'habitual') as Scale;

test.skip(list.length === 0, 'Solo con WALKIE_PROFILE');

async function drag(page: Page, x: number, y: number, dx: number, dy: number) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 24; i++) {
    await page.mouse.move(x + (dx * i) / 24, y + (dy * i) / 24);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
  }
  await page.mouse.up();
}

test(`perfil ${list.join(',')}`, async ({ page }) => {
  test.setTimeout(300_000);
  // El perfil de CPU necesita CDP (solo Chromium).
  const cdp = (await instrument(page))!;
  await login(page);
  const { path } = await seed(page, scale, 'perfil');
  await page.goto(path);
  await page.locator('.react-flow__node').first().waitFor();
  await page.waitForTimeout(1500);
  await page.keyboard.press('0');
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'perf/results/perfil-antes.png' });
  for (const which of list) {
  const pane = (await page.locator('.react-flow__pane').boundingBox())!;
    await page.evaluate(() => ((window as unknown as { __changes: object }).__changes = {}));
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
    await cdp.send('Profiler.start');
    if (which === 'desplazar') await drag(page, pane.x + pane.width - 420, pane.y + pane.height - 60, -300, -120);
    if (which === 'arrastrar') {
      const [id] = await visibleBoxes(page, 1);
      const b = (await page.locator(`.react-flow__node[data-id="${id}"]`).boundingBox())!;
      await drag(page, b.x + b.width / 2, b.y + b.height / 2, 120, 80);
    }
    if (which === 'deshacer') {
      const [id] = await visibleBoxes(page, 1);
      const b = (await page.locator(`.react-flow__node[data-id="${id}"]`).boundingBox())!;
      await drag(page, b.x + b.width / 2, b.y + b.height / 2, 120, 80);
      for (const k of ['Control+z', 'Control+Shift+z', 'Control+z']) await page.keyboard.press(k);
    }
    if (which === 'ver-todo') {
      for (let i = 0; i < 3; i++) await page.keyboard.press('+');
      await page.waitForTimeout(600);
      await page.keyboard.press('0');
    }
    if (which === 'seleccionar') {
      for (const id of await visibleBoxes(page, 4)) {
        await page.locator(`.react-flow__node[data-id="${id}"]`).click({ position: { x: 12, y: 12 } });
        await page.waitForTimeout(200);
      }
    }
    if (which === 'pasos') {
      await page.locator('.react-flow__pane').click({ position: { x: 10, y: 10 } });
      const inspector = page.getByRole('complementary', { name: 'Propiedades' });
      await inspector.getByRole('tab', { name: /Recorridos/ }).click();
      await inspector.getByRole('button', { name: 'Recorrido largo' }).click();
      const steps = inspector.getByRole('list', { name: 'Pasos' });
      for (let i = 1; i <= 4; i++) await steps.getByRole('listitem', { name: `Paso ${i}`, exact: true }).locator('.tour-step-toggle').click();
    }
    if (which === 'tecla') {
      const [id] = await visibleBoxes(page, 1);
      await page.locator(`.react-flow__node[data-id="${id}"]`).click({ position: { x: 12, y: 12 } });
      await page.getByRole('complementary', { name: 'Propiedades' }).getByLabel('Descripción').click();
      for (const k of ['a', 'b']) {
        await page.keyboard.type(k);
        await page.waitForTimeout(300);
        console.log('renovados tras una tecla:', JSON.stringify(await page.evaluate(() => {
          const c = (window as unknown as { __caches: { nodeCache: { changed: string[] }; edgeCache: { changed: string[] } } }).__caches;
          return { nodos: c.nodeCache.changed, conexiones: c.edgeCache.changed.length, ejemplo: c.edgeCache.changed.slice(0, 5) };
        })));
      }
    }
    if (which === 'escribir') {
      const [id] = await visibleBoxes(page, 1);
      await page.locator(`.react-flow__node[data-id="${id}"]`).click({ position: { x: 12, y: 12 } });
      await page.getByRole('complementary', { name: 'Propiedades' }).getByLabel('Descripción').click();
      await page.keyboard.type('Datos del cliente', { delay: 30 });
    }
    await page.waitForTimeout(800);
    await page.screenshot({ path: 'perf/results/perfil-despues.png' });
    const { profile } = await cdp.send('Profiler.stop');
    console.log('cambios de dependencias:', JSON.stringify(await page.evaluate(() => (window as unknown as { __changes: object }).__changes)));
    // Tiempo propio por función (muestras × intervalo).
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    const self = new Map<string, number>();
    const dt = profile.timeDeltas ?? [];
    profile.samples?.forEach((id, i) => {
      const n = byId.get(id)!;
      const f = n.callFrame;
      const key = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`;
      self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0) / 1000);
    });
    const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
    console.log(`\n== perfil ${which} (${scale})\n` + top.map(([k, ms]) => `${ms.toFixed(1).padStart(8)} ms  ${k}`).join('\n'));
  }
});
