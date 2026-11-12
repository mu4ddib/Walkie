import { expect, test, type Page } from '@playwright/test';
import { login, openNewFeature, seedCanvas } from './helpers';

/**
 * Feature tours-a-escala (docs/features/tours-a-escala/spec.md) con API, Keycloak y Postgres reales: un tour de 300
 * pasos (ventana de la lista), mover pasos a otro tour, reproducir con el paso activo a la vista y la cabecera y el pie
 * compactos en una pantalla baja. El enlace de solo lectura lo prueba `enlace-solo-lectura.spec.ts`. Datos ficticios.
 */

const LONG_TOUR = 300;

function graph() {
  const nodes: Record<string, unknown> = {};
  const layout: Record<string, unknown> = {};
  for (let i = 1; i <= 6; i++) {
    nodes[`n${i}`] = { id: `n${i}`, type: i % 2 ? 'screen' : 'api', title: `Pantalla ${i}` };
    layout[`n${i}`] = { x: (i % 3) * 240, y: Math.floor(i / 3) * 160 };
  }
  return {
    schemaVersion: 0,
    nodes,
    edges: {
      e1: { id: 'e1', from: 'n1', to: 'n2', kind: 'request' },
      e2: { id: 'e2', from: 'n2', to: 'n3', kind: 'request' },
    },
    layout,
    tours: {
      long: {
        id: 'long',
        name: 'Largo',
        kind: 'guide',
        steps: Array.from({ length: LONG_TOUR }, (_, i) => ({
          id: `0190a000-0000-7000-8000-${String(i).padStart(12, '0')}`,
          nodeId: `n${(i % 6) + 1}`,
          note: `Nota del paso ${i + 1}.`,
        })),
      },
      short: { id: 'short', name: 'Corto', kind: 'guide', steps: [{ nodeId: 'n1', note: 'Único paso.' }] },
      flow: { id: 'flow', name: 'Alta', kind: 'flow', steps: [{ edgeId: 'e1' }, { edgeId: 'e2' }] },
    },
  };
}

/** Con `WALKIE_CAPTURES=<carpeta>`, guarda capturas para revisar el resultado visual. */
async function capture(page: Page, name: string) {
  const dir = process.env.WALKIE_CAPTURES;
  if (dir) await page.screenshot({ path: `${dir}/tours-a-escala-${name}.png` });
}

const inspector = (page: Page) => page.getByRole('complementary', { name: 'Propiedades' });
const steps = (page: Page) => inspector(page).getByRole('list', { name: 'Pasos' });
const step = (page: Page, n: number) => steps(page).getByRole('listitem', { name: `Paso ${n}`, exact: true });
const panelScroll = (page: Page) => page.locator('.inspector .properties-panel');

async function openTour(page: Page, name: string, tab: 'Tours' | 'Recorridos' = 'Tours') {
  await inspector(page).getByRole('tab', { name: new RegExp(tab) }).click();
  await inspector(page).getByRole('list', { name: tab }).getByRole('button', { name, exact: true }).click();
}

test('300 pasos: solo se dibuja lo visible; abrir, mover a otro tour y reproducir con el paso activo a la vista', async ({
  page,
}) => {
  await login(page);
  await openNewFeature(page, 'Tour largo');
  await seedCanvas(page, graph());
  await openTour(page, 'Largo');

  await expect(inspector(page).getByText(`${LONG_TOUR} pasos`)).toBeVisible();
  await expect(step(page, 1)).toHaveAttribute('aria-setsize', String(LONG_TOUR));
  const drawn = await steps(page).getByRole('listitem').count();
  expect(drawn).toBeLessThan(60);
  await capture(page, '1-trescientos');

  // Hasta el final: se dibujan los últimos y el alto total se conserva.
  const scroller = panelScroll(page);
  await scroller.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect(step(page, LONG_TOUR)).toBeVisible();
  await expect(step(page, 1)).toHaveCount(0);
  expect(await steps(page).getByRole('listitem').count()).toBeLessThan(60);

  // Abrir el último y escribir: va al store como siempre.
  await step(page, LONG_TOUR).locator('.tour-step-toggle').click();
  const note = inspector(page).getByLabel(`Paso ${LONG_TOUR}: nota`, { exact: true });
  await note.fill('Último paso, editado.');

  // Moverlo a «Corto»: elige el destino y pasa al final.
  await step(page, LONG_TOUR).getByRole('button', { name: `Acciones del paso ${LONG_TOUR}` }).click();
  await inspector(page).getByRole('menuitem', { name: `Mover paso ${LONG_TOUR} a otro tour` }).click();
  const move = inspector(page).getByRole('form', { name: `Mover paso ${LONG_TOUR}` });
  await expect(move.getByRole('combobox')).toHaveValue('short');
  await move.getByRole('button', { name: 'Mover' }).click();
  await expect(inspector(page).getByText(`${LONG_TOUR - 1} pasos`)).toBeVisible();
  await inspector(page).getByRole('button', { name: '← Volver a tours' }).click();
  await expect(inspector(page).getByRole('list', { name: 'Tours' }).getByRole('listitem').filter({ hasText: 'Corto' })).toContainText(
    '2 pasos',
  );
  await openTour(page, 'Corto');
  await expect(step(page, 2)).toContainText('Último paso, editado.');
  await inspector(page).getByRole('button', { name: '← Volver a tours' }).click();

  // Reproducir el largo: el paso activo siempre a la vista en el inspector, también lejos del principio.
  await openTour(page, 'Largo');
  await inspector(page).getByRole('button', { name: 'Ver tour' }).click();
  const bar = page.getByRole('toolbar', { name: 'Tour' });
  await expect(bar.getByRole('status')).toHaveText(`Paso 1 de ${LONG_TOUR - 1}`);
  await scroller.evaluate((el) => (el.scrollTop = el.scrollHeight / 2));
  // La ventana se mueve con el desplazamiento (en el siguiente cuadro).
  const first = steps(page).locator('[data-index]').first();
  await expect.poll(async () => Number(await first.getAttribute('data-index'))).toBeGreaterThan(100);
  const index = Number(await first.getAttribute('data-index')) + 10;
  const middle = steps(page).locator(`[data-index="${index}"]`);
  await middle.locator('.tour-step-toggle').click();
  await expect(bar.getByRole('status')).toHaveText(`Paso ${index + 1} de ${LONG_TOUR - 1}`);
  await page.keyboard.press('ArrowRight');
  const active = steps(page).locator('[aria-current="step"]');
  await expect(active).toContainText(`Nota del paso ${index + 2}.`);
  await expect(active).toBeInViewport();
  // Con la lista lejos del paso activo (fuera de la ventana), avanzar la trae de vuelta hasta él.
  await scroller.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect(active).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await expect(active).toContainText(`Nota del paso ${index + 3}.`);
  await expect(active).toBeInViewport();
  await capture(page, '2-reproduciendo');
});

test('pantalla baja (1024×600): cabecera de una fila y pie compacto, con los mismos nombres', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await login(page);
  await openNewFeature(page, 'Pantalla baja');
  await seedCanvas(page, graph());
  await openTour(page, 'Corto');

  const head = inspector(page).locator('.tour-detail-head');
  const foot = inspector(page).locator('.tour-add');
  await expect(head.getByRole('button', { name: '← Volver a tours' })).toBeVisible();
  await expect(head.getByRole('button', { name: 'Ver tour' })).toBeVisible();
  await expect(foot.getByRole('button', { name: 'Agregar paso' })).toBeVisible();
  const panel = (await panelScroll(page).boundingBox())!;
  const headBox = (await head.boundingBox())!;
  const footBox = (await foot.boundingBox())!;
  expect(headBox.height).toBeLessThanOrEqual(52);
  expect(footBox.height).toBeLessThanOrEqual(56);
  // Lo que queda para los pasos: al menos la mitad del panel.
  expect(panel.height - headBox.height - footBox.height).toBeGreaterThanOrEqual(panel.height / 2);
  await capture(page, '3-pantalla-baja-tour');

  // Un recorrido: el botón de elegir en el lienzo comparte la fila del pie.
  await inspector(page).getByRole('button', { name: '← Volver a tours' }).click();
  await openTour(page, 'Alta', 'Recorridos');
  await expect(head.getByRole('button', { name: '▶ Reproducir recorrido' })).toBeVisible();
  await expect(foot.getByRole('button', { name: '＋ Elegir pasos en el lienzo' })).toBeVisible();
  expect((await foot.boundingBox())!.height).toBeLessThanOrEqual(56);
  expect((await head.boundingBox())!.height).toBeLessThanOrEqual(80); // una fila más: el estado del orden.
  await capture(page, '4-pantalla-baja-recorrido');
});
