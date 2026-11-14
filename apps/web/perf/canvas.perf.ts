import { mkdirSync, writeFileSync } from 'node:fs';
import { test, type Page } from '@playwright/test';
import { login } from '../e2e/helpers';
import { SCALES, type Scale } from './fixtures';
import { emptyPoint, instrument, measure, seed, table, visibleBoxes, type Result } from './harness';

/**
 * Escenarios de rendimiento del lienzo en las tres escalas. Uso (con la API, Keycloak, Postgres y RustFS levantados):
 *   pnpm perf                      → escribe perf/results/<WALKIE_PERF_LABEL>-<escala>.json y una tabla en la salida
 * `WALKIE_CPU` (por defecto 4) frena la CPU para acercarse a un equipo más modesto; `WALKIE_SCALES` elige escalas.
 */

const label = process.env.WALKIE_PERF_LABEL ?? 'medicion';
const scales = (process.env.WALKIE_SCALES?.split(',') as Scale[] | undefined) ?? (Object.keys(SCALES) as Scale[]);

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const inspector = (page: Page) => page.getByRole('complementary', { name: 'Propiedades' });

async function centerOf(page: Page, selector: string) {
  const box = (await page.locator(selector).first().boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number, steps = 24) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + (dx * i) / steps, from.y + (dy * i) / steps);
    // Un movimiento por cuadro, como una mano.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
  }
  await page.mouse.up();
}

for (const scale of scales) {
  test(`lienzo ${scale}`, async ({ page }) => {
    test.setTimeout(600_000);
    const cdp = await instrument(page);
    await login(page);
    const { path, fixture, other } = await seed(page, scale, label);
    const results: Result[] = [];
    const run = async (name: string, action: () => Promise<void>, opts?: { camera?: boolean; quiet?: number; navigation?: boolean }) => {
      try {
        results.push(await measure(page, cdp, name, action, opts));
      } catch (error) {
        // Un escenario que no se pudo reproducir no frena los demás: queda anotado.
        console.log(`! ${name}: ${(error as Error).message.split('\n')[0]}`);
        await page.keyboard.press('Escape').catch(() => {});
      }
    };

    await run('abrir el lienzo', async () => {
      await page.goto(path);
      await page.locator('.react-flow__node').first().waitFor();
    }, { quiet: 800, navigation: true });

    // Cámara: acercar y «Ver todo» con el botón y con la tecla 0.
    const fitButton = page.getByRole('button', { name: 'Ajustar a la vista' });
    await fitButton.click();
    await page.waitForTimeout(600);
    for (const how of ['botón', 'tecla 0'] as const) {
      await page.locator('.react-flow__pane').click({ position: { x: 10, y: 10 } });
      for (let i = 0; i < 3; i++) await page.keyboard.press('+');
      await page.waitForTimeout(800);
      await run(`ver todo (${how})`, async () => {
        if (how === 'botón') await fitButton.click();
        else await page.keyboard.press('0');
      }, { camera: true });
    }

    await run('desplazar el lienzo', async () => {
      const p = await emptyPoint(page);
      await drag(page, p, -300, -120);
    });
    await run('zoom con la rueda', async () => {
      const p = await emptyPoint(page);
      await page.mouse.move(p.x, p.y);
      for (let i = 0; i < 8; i++) {
        await page.mouse.wheel(0, i < 4 ? -120 : 120);
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
      }
    });
    await page.keyboard.press('0');
    await page.waitForTimeout(600);

    await run('arrastrar una caja', async () => {
      const [id] = await visibleBoxes(page, 1);
      await drag(page, await centerOf(page, `.react-flow__node[data-id="${id}"]`), 120, 80);
    });
    await run('arrastrar un grupo con descendientes', async () => {
      await drag(page, await centerOf(page, `.react-flow__node[data-id="${fixture.ids.outerGroup}"] .group-node-header`), 80, 60);
    });
    await run('deshacer y rehacer', async () => {
      for (const key of ['Control+z', 'Control+z', 'Control+Shift+z', 'Control+Shift+z']) {
        await page.keyboard.press(key);
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
      }
    });

    await run('seleccionar cajas (10)', async () => {
      for (const id of await visibleBoxes(page, 10, ['screen', 'api', 'service', 'database'])) {
        await node(page, id).click({ position: { x: 12, y: 12 } });
        await page.locator(`.react-flow__node.selected[data-id="${id}"]`).waitFor();
      }
    });
    await run('escribir en el inspector (30 letras)', async () => {
      const [id] = await visibleBoxes(page, 1, ['screen', 'api']);
      await node(page, id!).click({ position: { x: 12, y: 12 } });
      const field = inspector(page).getByLabel('Descripción');
      await field.click();
      await page.keyboard.type('Datos del cliente para el alta', { delay: 30 });
    });

    await run('seleccionar una conexión y escribir su etiqueta', async () => {
      const edgeId = await page.evaluate(() => {
        const pane = document.querySelector('.react-flow__pane')!.getBoundingClientRect();
        const label = [...document.querySelectorAll<HTMLElement>('.kind-edge-label')].find((l) => {
          const r = l.getBoundingClientRect();
          const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return r.left > pane.left + 80 && r.right < pane.right - 380 && r.top > pane.top + 20 && l.contains(el);
        });
        return label?.dataset.edgeId;
      });
      await page.locator(`.kind-edge-label[data-edge-id="${edgeId}"]`).click();
      const field = inspector(page).getByLabel('Etiqueta');
      await field.click();
      await page.keyboard.type('Consulta por id', { delay: 30 });
    });

    await run('plegar y desplegar un dominio', async () => {
      await page.locator('.react-flow__pane').click({ position: { x: 10, y: 10 } });
      await page.keyboard.press('0');
      await page.waitForTimeout(500);
      await page.getByRole('button', { name: 'Plegar grupo Dominio 1', exact: true }).click({ force: true });
      await page.getByRole('button', { name: 'Desplegar grupo Dominio 1', exact: true }).click({ force: true });
    });

    await run('abrir el recorrido y sus pasos', async () => {
      await page.locator('.react-flow__pane').click({ position: { x: 10, y: 10 } });
      await inspector(page).getByRole('tab', { name: /Recorridos/ }).click();
      await inspector(page).getByRole('button', { name: 'Recorrido largo' }).click();
      const steps = inspector(page).getByRole('list', { name: 'Pasos' });
      for (let i = 1; i <= 8; i++) await steps.getByRole('listitem', { name: `Paso ${i}`, exact: true }).locator('.tour-step-toggle').click();
    });

    await run('guardar (manual)', async () => {
      await page.keyboard.press('Control+s');
      await page.locator('.save-status').filter({ hasText: /Guardado|Al día/ }).waitFor();
    });

    // Navegar entre features y volver: memoria y oyentes tras varios ciclos.
    const heap = async () => {
      if (!cdp) return { mb: 0, nodes: await page.evaluate(() => document.querySelectorAll('*').length) };
      await cdp.send('HeapProfiler.collectGarbage');
      const { usedSize } = await cdp.send('Runtime.getHeapUsage');
      const listeners = await page.evaluate(() => document.querySelectorAll('*').length);
      return { mb: Math.round(usedSize / 1e5) / 10, nodes: listeners };
    };
    const start = await heap();
    await run('cambiar de feature e ir y volver (5 ciclos)', async () => {
      for (let i = 0; i < 5; i++) {
        await page.goto(other);
        await page.locator('.react-flow').waitFor();
        await page.goto(path);
        await page.locator('.react-flow__node').first().waitFor();
      }
    }, { quiet: 800, navigation: true });
    const end = await heap();

    const out = { label, scale, counts: fixture.counts, cpuThrottle: Number(process.env.WALKIE_CPU ?? '4'), heap: { start, end }, results };
    mkdirSync('perf/results', { recursive: true });
    writeFileSync(`perf/results/${label}-${scale}.json`, JSON.stringify(out, null, 2));
    console.log(`\n== ${label} · ${scale} · ${JSON.stringify(fixture.counts)} · heap ${start.mb}→${end.mb} MB, DOM ${start.nodes}→${end.nodes}\n${table(results)}\n`);
  });
}
