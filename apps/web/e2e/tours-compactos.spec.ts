import { expect, test, type Page } from '@playwright/test';
import { login, openNewFeature, saveStatus, seedCanvas } from './helpers';

/**
 * Feature tours-compactos (docs/features/tours-compactos/spec.md) con API, Keycloak y Postgres reales: lista compacta
 * con búsqueda, detalle con pasos en acordeón, reordenar, insertar, duplicar, quitar, localizar, reproducir y volver
 * al estado de edición. Tours sembrados como un lienzo anterior (sin ids de paso ni tipo). Datos ficticios.
 */

const LONG = 'Pantalla de confirmación de la apertura de cuenta con verificación biométrica y firma electrónica';
const NOTE = 'El usuario revisa sus datos, acepta los términos y confirma. '.repeat(6).trim();

function graph() {
  const nodes: Record<string, unknown> = {};
  const layout: Record<string, unknown> = {};
  for (let i = 1; i <= 10; i++) {
    const id = `n${i}`;
    nodes[id] = { id, type: i % 3 === 0 ? 'api' : 'screen', title: i === 5 ? LONG : `Pantalla ${i}` };
    layout[id] = { x: (i % 5) * 240, y: Math.floor(i / 5) * 160 };
  }
  nodes.a = { id: 'a', type: 'api', title: 'API de autenticación' };
  layout.a = { x: 0, y: 480 };
  const tours: Record<string, unknown> = {
    // 30 pasos sobre los 10 nodos, cada uno con su nota.
    big: {
      id: 'big',
      name: 'Onboarding completo de la banca móvil con todos los pasos',
      steps: Array.from({ length: 30 }, (_, i) => ({
        nodeId: `n${(i % 10) + 1}`,
        note: i === 4 ? NOTE : `Paso ${i + 1}: lo que el guía cuenta aquí.`,
      })),
    },
    // Recorrido anterior con una conexión que ya no existe.
    flow: {
      id: 'flow',
      name: 'Login con API',
      steps: [{ edgeId: 'e1' }, { removedEdge: { from: 'a', to: 'n1', kind: 'response' }, note: 'Devuelve el token' }],
    },
  };
  for (let i = 1; i <= 12; i++) tours[`t${i}`] = { id: `t${i}`, name: `Tour ${String(i).padStart(2, '0')}`, steps: [{ nodeId: 'n1' }] };
  return {
    schemaVersion: 0,
    nodes,
    edges: { e1: { id: 'e1', from: 'n1', to: 'a', kind: 'request' } },
    layout,
    tours,
  };
}

/** Con `WALKIE_CAPTURES=<carpeta>`, guarda capturas para revisar el resultado visual. */
async function capture(page: Page, name: string) {
  const dir = process.env.WALKIE_CAPTURES;
  if (dir) await page.screenshot({ path: `${dir}/tours-compactos-${name}.png` });
}

const inspector = (page: Page) => page.getByRole('complementary', { name: 'Propiedades' });
const steps = (page: Page) => inspector(page).getByRole('list', { name: 'Pasos' });
const step = (page: Page, n: number) => steps(page).getByRole('listitem', { name: `Paso ${n}`, exact: true });
const toggle = (page: Page, n: number) => step(page, n).locator('.tour-step-toggle');
/**
 * Arrastra el paso `from` por su asa hasta la mitad inferior del encabezado del paso `to` (queda después de él). Los
 * dos tienen que verse a la vez: el asa no se toma por debajo de la cabecera fija.
 */
async function dragStep(page: Page, from: number, to: number) {
  await step(page, from).evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const grip = (await step(page, from).locator('.tour-step-grip').boundingBox())!;
  const target = (await step(page, to).locator('.tour-step-head').boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 + 12, { steps: 4 });
  await page.mouse.move(target.x + 60, target.y + target.height * 0.75, { steps: 12 });
  await page.mouse.up();
}

const panelScroll = (page: Page) => page.locator('.inspector .properties-panel');

test('lista compacta, búsqueda, volver al mismo lugar y un tour de 30 pasos legible cerrado', async ({ page }) => {
  await login(page);
  await openNewFeature(page, 'Onboarding');
  await seedCanvas(page, graph());

  // Lista: filas compactas; con muchos, búsqueda.
  const rows = inspector(page).getByRole('list', { name: 'Tours' });
  await expect(rows.getByRole('listitem')).toHaveCount(13);
  await capture(page, '1-lista');
  const scroller = panelScroll(page);
  await scroller.evaluate((el) => (el.scrollTop = el.scrollHeight));
  const scrolled = await scroller.evaluate((el) => el.scrollTop);
  expect(scrolled).toBeGreaterThan(0);
  await rows.getByRole('button', { name: 'Tour 12' }).click();
  await expect(inspector(page).getByLabel('Nombre del tour')).toHaveValue('Tour 12');
  await inspector(page).getByRole('button', { name: '← Volver a tours' }).click();
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(scrolled);

  await inspector(page).getByLabel('Buscar tours').fill('onboarding');
  await expect(rows.getByRole('listitem')).toHaveCount(1);
  await rows.getByRole('button', { name: /Onboarding completo/ }).click();

  // Detalle: cabecera con nombre, pasos y reproducir; los 30 pasos cerrados se leen por su encabezado.
  await expect(inspector(page).getByText('30 pasos')).toBeVisible();
  await expect(steps(page).getByRole('listitem')).toHaveCount(30);
  await expect(inspector(page).locator('.tour-step-body')).toHaveCount(0);
  await expect(step(page, 17)).toContainText('Pantalla 7');
  await expect(step(page, 17)).toContainText('Paso 17: lo que el guía cuenta aquí.');
  await expect(step(page, 5)).toContainText(LONG.slice(0, 20));
  await expect(toggle(page, 5)).toHaveAttribute('title', new RegExp(`^${LONG}`));
  await capture(page, '2-treinta-pasos');

  // La cabecera queda a la vista al bajar por la lista (un solo desplazamiento: el del inspector).
  await scroller.evaluate((el) => (el.scrollTop = el.scrollHeight));
  const head = await inspector(page).locator('.tour-detail-head').boundingBox();
  const panel = await scroller.boundingBox();
  expect(head!.y).toBeLessThanOrEqual(panel!.y + 2);
  await expect(inspector(page).getByRole('button', { name: 'Agregar paso' })).toBeInViewport();

  // Expandir y contraer todos.
  await inspector(page).getByRole('button', { name: 'Expandir todos' }).click();
  await expect(inspector(page).locator('.tour-step-body')).toHaveCount(30);
  await inspector(page).getByRole('button', { name: 'Contraer todos' }).click();
  await expect(inspector(page).locator('.tour-step-body')).toHaveCount(0);

  // Volver: la búsqueda sigue ahí.
  await inspector(page).getByRole('button', { name: '← Volver a tours' }).click();
  await expect(inspector(page).getByLabel('Buscar tours')).toHaveValue('onboarding');
});

test('editar, reordenar, insertar, duplicar, quitar, localizar, reproducir, guardar y recargar', async ({ page }) => {
  // Alto suficiente para ver a la vez un paso abierto y el siguiente entre las zonas fijas del panel.
  await page.setViewportSize({ width: 1280, height: 1000 });
  await login(page);
  await openNewFeature(page, 'Edición de pasos');
  await seedCanvas(page, graph());
  await inspector(page).getByRole('button', { name: /Onboarding completo/ }).click();

  // Abrir no marca cambios: el estado de guardado sigue igual.
  await expect(saveStatus(page)).toHaveText('Al día');
  await toggle(page, 3).click();
  await expect(toggle(page, 3)).toHaveAttribute('aria-expanded', 'true');
  await expect(saveStatus(page)).toHaveText('Al día');

  // Editar y abrir otro: un solo paso abierto, lo escrito se conserva.
  const note3 = inspector(page).getByLabel('Paso 3: nota', { exact: true });
  await note3.fill('Nota editada del paso 3');
  await toggle(page, 4).click();
  await expect(toggle(page, 3)).toHaveAttribute('aria-expanded', 'false');
  await expect(step(page, 3)).toContainText('Nota editada del paso 3');
  await expect(saveStatus(page)).toContainText('Sin guardar');

  // Una nota extensa: el campo crece para mostrarla.
  await toggle(page, 5).click();
  const long = inspector(page).getByLabel('Paso 5: nota', { exact: true });
  const height = (await long.boundingBox())!.height;
  expect(height).toBeGreaterThan(80);
  await capture(page, '3-nota-extensa');
  await toggle(page, 5).click();

  // Reordenar arrastrando un paso abierto: conserva su contenido y sigue abierto.
  await toggle(page, 3).click();
  await dragStep(page, 3, 4);
  await expect(step(page, 4)).toContainText('Nota editada del paso 3');
  await expect(toggle(page, 4)).toHaveAttribute('aria-expanded', 'true');
  await expect(inspector(page).getByLabel('Paso 4: nota', { exact: true })).toHaveValue('Nota editada del paso 3');
  await expect(step(page, 3)).toContainText('Paso 4: lo que el guía');

  // Teclado: con el foco en el asa, ↓ baja el paso y el foco lo acompaña.
  await step(page, 4).locator('.tour-step-grip').focus();
  await page.keyboard.press('ArrowDown');
  await expect(step(page, 5)).toContainText('Nota editada del paso 3');
  await expect(step(page, 5).locator('.tour-step-grip')).toBeFocused();

  // Insertar después, duplicar y quitar desde «⋯».
  await step(page, 1).getByRole('button', { name: 'Acciones del paso 1' }).click();
  await inspector(page).getByRole('menuitem', { name: 'Insertar paso después del 1' }).click();
  await expect(steps(page).getByRole('listitem')).toHaveCount(31);
  await expect(inspector(page).getByLabel('Paso 2: nodo', { exact: true })).toBeFocused();
  await step(page, 2).getByRole('button', { name: 'Acciones del paso 2' }).click();
  await inspector(page).getByRole('menuitem', { name: 'Duplicar paso 2' }).click();
  await expect(steps(page).getByRole('listitem')).toHaveCount(32);
  await step(page, 3).getByRole('button', { name: 'Acciones del paso 3' }).click();
  await inspector(page).getByRole('menuitem', { name: 'Quitar paso 3' }).click();
  await step(page, 2).getByRole('button', { name: 'Acciones del paso 2' }).click();
  await inspector(page).getByRole('menuitem', { name: 'Quitar paso 2' }).click();
  await expect(steps(page).getByRole('listitem')).toHaveCount(30);

  // Localizar en el lienzo: centra y resalta el nodo sin cambiar el inspector.
  await toggle(page, 7).click();
  await inspector(page).getByRole('button', { name: '⌖ Localizar en lienzo' }).click();
  await expect(page.locator('.react-flow__node.locate-flash')).toContainText('Pantalla 7');
  await expect(inspector(page).getByLabel('Nombre del tour')).toBeVisible();

  // Reproducir: el panel sigue a la vista con el paso activo resaltado; nada se despliega; al salir vuelve la edición.
  await inspector(page).getByRole('button', { name: 'Ver tour' }).click();
  const bar = page.getByRole('toolbar', { name: 'Tour' });
  await expect(bar.getByRole('status')).toHaveText('Paso 1 de 30');
  await expect(step(page, 1).locator('[aria-current="step"]')).toBeVisible();
  await expect(inspector(page).locator('.tour-step-body')).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await expect(step(page, 2).locator('[aria-current="step"]')).toBeVisible();
  // Saltar a un paso lejano desde la lista: se ve sin desplegar nada.
  await step(page, 20).locator('.tour-step-toggle').click();
  await expect(bar.getByRole('status')).toHaveText('Paso 20 de 30');
  await expect(step(page, 20)).toBeInViewport();
  await capture(page, '4-reproduciendo');
  await page.keyboard.press('Escape');
  await expect(bar).toBeHidden();
  await expect(toggle(page, 7)).toHaveAttribute('aria-expanded', 'true');

  // Guardar y recargar: el tour (con sus pasos y notas) vuelve igual.
  const headings = await steps(page).locator('.tour-step-text').allTextContents();
  await page.keyboard.press('Control+s');
  await expect(saveStatus(page)).toHaveText('Guardado');
  await page.reload();
  await inspector(page).getByRole('button', { name: /Onboarding completo/ }).click();
  expect(await steps(page).locator('.tour-step-text').allTextContents()).toEqual(headings);
});

test('referencia eliminada, tour vacío y pantalla baja manejada con teclado', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await login(page);
  await openNewFeature(page, 'Referencias');
  await seedCanvas(page, graph());

  // Recorrido con una conexión eliminada: el encabezado lo dice; la nota se conserva; se quita.
  await inspector(page).getByRole('tab', { name: /Recorridos/ }).click();
  await inspector(page).getByRole('button', { name: 'Login con API' }).click();
  await expect(step(page, 2)).toContainText('Conexión eliminada');
  await toggle(page, 2).click();
  await expect(inspector(page).getByLabel('Paso 2: descripción', { exact: true })).toHaveValue('Devuelve el token');
  await expect(inspector(page).getByLabel('Paso 2: reemplazar por', { exact: true })).toBeVisible();
  await capture(page, '5-referencia-eliminada');
  await inspector(page).getByRole('button', { name: 'Quitar paso' }).click();
  await expect(steps(page).getByRole('listitem')).toHaveCount(1);

  // Tour vacío: lo dice y ofrece agregar el primer paso.
  await inspector(page).getByRole('button', { name: '← Volver a recorridos' }).click();
  await inspector(page).getByRole('tab', { name: /Tours/ }).click();
  await inspector(page).getByLabel('Nombre del tour nuevo').fill('Vacío');
  await inspector(page).getByRole('button', { name: 'Nuevo tour' }).click();
  await expect(inspector(page).getByText(/Este tour aún no tiene pasos/)).toBeVisible();

  // Teclado: agregar un paso (se abre con el foco en su nodo), cerrar con Enter en su encabezado, abrir el menú.
  await inspector(page).getByLabel('Nodo del paso nuevo').focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(inspector(page).getByLabel('Paso 1: nodo', { exact: true })).toBeFocused();
  await toggle(page, 1).focus();
  await page.keyboard.press('Enter');
  await expect(toggle(page, 1)).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(inspector(page).getByRole('menuitem', { name: 'Localizar paso 1 en el lienzo' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(step(page, 1).getByRole('button', { name: 'Acciones del paso 1' })).toBeFocused();
  await capture(page, '6-pantalla-baja');
});
