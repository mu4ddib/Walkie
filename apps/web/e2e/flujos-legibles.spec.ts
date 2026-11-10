import { expect, test, type Page } from '@playwright/test';
import { dropNode, login, openNewFeature, png, rename, saveStatus } from './helpers';

/**
 * Feature flujos-legibles (docs/features/flujos-legibles/spec.md), con API, Keycloak y Postgres reales:
 * decisiones con salidas, intercambio solicitud/respuesta legible, notas adhesivas, duplicar y autoguardado.
 */
const node = (page: Page, title: string) =>
  page.locator('.react-flow__node').filter({ has: page.locator('.pixel-node-title', { hasText: new RegExp(`^${title}$`) }) });
const inspector = (page: Page) => page.getByRole('complementary', { name: 'Propiedades' });
const labels = (page: Page) => page.locator('.kind-edge-label');
const clearSelection = (page: Page) => page.locator('.react-flow__pane').click({ position: { x: 300, y: 730 } });

/** Arrastra entre dos puntos de conexión. */
async function drag(page: Page, from: ReturnType<Page['locator']>, to: ReturnType<Page['locator']>) {
  const source = (await from.boundingBox())!;
  const target = (await to.boundingBox())!;
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 });
  await page.mouse.up();
}

const connect = (page: Page, from: string, to: string) =>
  drag(page, node(page, from).locator('.react-flow__handle-right').first(), node(page, to).locator('.react-flow__handle-left'));

test('¿Tiene cuenta?: una regla se convierte en decisión y sus salidas llevan etiqueta', async ({ page }) => {
  await login(page);
  await openNewFeature(page, 'Acceso');

  await dropNode(page, 'Regla', 120, 260);
  await rename(page, 0, '¿Tiene cuenta?');
  await dropNode(page, 'Pantalla', 520, 120);
  await rename(page, 1, 'Login');
  await dropNode(page, 'Pantalla', 520, 420);
  await rename(page, 2, 'Creación de cuenta');
  await connect(page, '¿Tiene cuenta\\?', 'Login');
  await expect(labels(page)).toHaveText(['usa']);

  // Convertir desde el inspector conserva título, posición y conexión.
  const decision = node(page, '¿Tiene cuenta\\?');
  await decision.click();
  const position = await decision.evaluate((n) => (n as HTMLElement).style.transform);
  await inspector(page).getByRole('button', { name: /Decisión/ }).click();
  await expect(decision.locator('.pixel-node-kind')).toContainText('Decisión');
  expect(await decision.evaluate((n) => (n as HTMLElement).style.transform)).toBe(position);
  await expect(decision.locator('.pixel-node-branches li')).toHaveText(['Sí', 'No']);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);

  // La conexión que ya existía se asigna a mano; la nueva nace del punto de su salida.
  await inspector(page).getByLabel('→ Login').selectOption({ label: 'Sí' });
  await drag(
    page,
    decision.locator('.pixel-node-branches li').nth(1).locator('.react-flow__handle'),
    node(page, 'Creación de cuenta').locator('.react-flow__handle-left'),
  );
  await expect(labels(page)).toHaveText(['Sí', 'No']);

  // Renombrar una salida cambia la caja y su rama; una rama tiene su condición.
  await decision.click();
  await inspector(page).getByLabel('Salida 2').fill('No, es nuevo');
  await expect(labels(page)).toHaveText(['Sí', 'No, es nuevo']);
  await labels(page).first().click();
  await inspector(page).getByRole('region', { name: 'Rama de decisión' }).getByLabel('Condición').fill('correo registrado');
  await expect(inspector(page).getByRole('region', { name: 'Resumen de la conexión' })).toContainText('¿Tiene cuenta?→Login');

  await page.keyboard.press('Control+s');
  await expect(saveStatus(page)).toHaveText('Guardado');
  await page.reload();
  await expect(labels(page)).toHaveText(['Sí [correo registrado]', 'No, es nuevo']);
  await expect(node(page, '¿Tiene cuenta\\?').locator('.pixel-node-kind')).toContainText('Decisión');
});

test('solicitud y respuestas: tipo, etiqueta y sentido concuerdan; éxito y error se leen por separado', async ({ page }) => {
  await login(page);
  await openNewFeature(page, 'Registro');

  await dropNode(page, 'Pantalla', 140, 240);
  await rename(page, 0, 'Creación de cuenta');
  await dropNode(page, 'API', 620, 240);
  await rename(page, 1, 'API Usuarios');
  await connect(page, 'Creación de cuenta', 'API Usuarios');
  const edge = page.locator('.react-flow__edge').first();
  const [screenId, apiId] = await page.locator('.react-flow__node').evaluateAll((ns) => ns.map((n) => n.getAttribute('data-id')));

  // Una conexión pantalla → API marcada como "responde" no se queda apuntando a la API.
  await labels(page).click();
  await inspector(page).getByLabel('Tipo', { exact: true }).selectOption('response');
  await expect(edge).toHaveAttribute('aria-label', `Edge from ${apiId} to ${screenId}`);
  await expect(edge.locator('.kind-edge')).toHaveClass(/kind-response/);
  await expect(inspector(page).getByRole('status')).toContainText('Se invirtió el sentido');
  await clearSelection(page);
  await expect(labels(page)).toHaveText('responde');

  // La etiqueta personalizada sobrevive a invertir el sentido y a cambiar el tipo.
  await labels(page).click();
  await inspector(page).getByLabel('Etiqueta').fill('Alta');
  await inspector(page).getByLabel('Tipo', { exact: true }).selectOption('request');
  await expect(edge).toHaveAttribute('aria-label', `Edge from ${screenId} to ${apiId}`);
  await clearSelection(page);
  await expect(labels(page)).toHaveText('llama · Alta');
  await labels(page).click();
  await inspector(page).getByLabel('Etiqueta').fill('');

  // Con el contrato en la API, la solicitud dice su endpoint.
  await node(page, 'API Usuarios').click();
  await inspector(page).getByLabel('Método').selectOption('POST');
  await inspector(page).getByLabel('Ruta HTTP').fill('/creacionUsuario');
  await expect(labels(page)).toHaveText('llama · POST /creacionUsuario');

  // Respuestas de éxito y de error desde la solicitud: retornos en sentido inverso, vinculados.
  await labels(page).click();
  await inspector(page).getByRole('button', { name: '+ Añadir respuesta' }).click();
  await inspector(page).getByLabel('Código HTTP').fill('201');
  await inspector(page).getByLabel('Qué ocurre después').fill('Se muestra la confirmación');
  await inspector(page).getByRole('button', { name: 'Ir a la solicitud' }).click();
  await inspector(page).getByRole('button', { name: '+ Añadir respuesta' }).click();
  await inspector(page).getByLabel('Código HTTP').fill('409');
  await inspector(page).getByLabel('Etiqueta').fill('Correo ya registrado');
  await clearSelection(page);
  await expect(labels(page)).toHaveText(['llama · POST /creacionUsuario', 'responde 201', 'responde 409 · Correo ya registrado']);

  // Tres trazos entre los mismos nodos: ninguna etiqueta tapa a otra y cada una selecciona la suya.
  const boxes = await labels(page).evaluateAll((ls) => ls.map((l) => l.getBoundingClientRect().toJSON() as DOMRect));
  for (const [i, a] of boxes.entries()) {
    for (const b of boxes.slice(i + 1)) {
      expect(a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom, 'etiquetas encimadas').toBe(false);
    }
  }
  for (const [i, summary] of ['llama', 'responde201', 'responde409· Correo ya registrado'].entries()) {
    await clearSelection(page);
    await labels(page).nth(i).click();
    await expect(inspector(page).locator('.edge-summary-label')).toContainText(summary.replace(/(\d+)/, '$1'));
  }

  // Previsualizar: primero la ida, luego la vuelta.
  await clearSelection(page);
  await labels(page).first().click();
  await inspector(page).getByRole('button', { name: /Previsualizar interacción/ }).click();
  const edges = page.locator('.react-flow__edge');
  await expect(edges.nth(0)).toHaveClass(/edge-preview-active/);
  await expect(page.locator('.canvas-hint')).toContainText('1 de 3: Creación de cuenta → API Usuarios');
  await expect(edges.nth(1)).toHaveClass(/edge-preview-active/);
  await expect(page.locator('.canvas-hint')).toContainText('2 de 3: API Usuarios → Creación de cuenta (responde 201)');
  await page.keyboard.press('Escape');
  await expect(page.locator('.canvas-hint')).toHaveCount(0);

  // Con la animación apagada, flechas y etiquetas siguen diciendo el sentido.
  await page.getByRole('button', { name: 'Animar el sentido de las conexiones' }).click();
  await clearSelection(page);
  await expect(edges.nth(0).locator('.kind-edge')).toHaveAttribute('marker-end', 'url(#walkie-arrow-closed)');
  await expect(edges.nth(1).locator('.kind-edge')).toHaveAttribute('marker-end', 'url(#walkie-arrow-open)');
  await page.getByRole('button', { name: 'Animar el sentido de las conexiones' }).click();

  await page.keyboard.press('Control+s');
  await expect(saveStatus(page)).toHaveText('Guardado');
  await page.reload();
  await expect(labels(page)).toHaveText(['llama · POST /creacionUsuario', 'responde 201', 'responde 409 · Correo ya registrado']);
  await labels(page).nth(1).click();
  await expect(inspector(page).getByLabel('Código HTTP')).toHaveValue('201');
  await expect(inspector(page).getByLabel('Qué ocurre después')).toHaveValue('Se muestra la confirmación');
});

test('notas adhesivas, duplicar y autoguardado', async ({ page }) => {
  await login(page);
  await openNewFeature(page, 'Notas y copias');

  // Una pantalla con imagen y una conexión.
  await dropNode(page, 'Pantalla', 160, 160);
  await rename(page, 0, 'Inicio');
  await node(page, 'Inicio').click();
  await inspector(page).locator('input[type=file]').setInputFiles({ name: 'inicio.png', mimeType: 'image/png', buffer: png(64, 40) });
  await expect(node(page, 'Inicio').locator('img')).toBeVisible();
  await dropNode(page, 'API', 560, 160);
  await connect(page, 'Inicio', 'API');

  // Ctrl+D no interfiere con un campo del inspector; con la caja seleccionada, la duplica.
  await node(page, 'Inicio').click();
  await inspector(page).getByLabel('Título').focus();
  await page.keyboard.press('Control+d');
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await node(page, 'Inicio').click();
  await page.keyboard.press('Control+d');
  await expect(node(page, 'Inicio')).toHaveCount(2);
  // La copia: seleccionada, corrida, con su imagen, con id propio y sin conexiones.
  const copies = await node(page, 'Inicio').evaluateAll((ns) =>
    ns.map((n) => ({ id: n.getAttribute('data-id'), at: (n as HTMLElement).style.transform, selected: n.classList.contains('selected') })),
  );
  expect(copies.map((c) => c.at)).toEqual(['translate(160px, 160px)', 'translate(184px, 184px)']);
  expect(copies.map((c) => c.selected)).toEqual([false, true]);
  expect(copies[0]!.id).not.toBe(copies[1]!.id);
  await expect(node(page, 'Inicio').locator('img')).toHaveCount(2);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);

  // "Duplicar" también está en el menú contextual.
  await node(page, 'API').click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Duplicar/ }).click();
  await expect(node(page, 'API')).toHaveCount(2);

  // Nota adhesiva: crear desde la barra, editar con doble clic, mover y eliminar una copia.
  await clearSelection(page);
  await page.getByRole('button', { name: 'Nota adhesiva' }).click();
  await page.getByLabel('Texto de la nota').fill('Pendiente: validar');
  await clearSelection(page);
  const note = page.locator('.sticky-note');
  await expect(note).toHaveText('Pendiente: validar');
  await note.dblclick();
  await page.getByLabel('Texto de la nota').fill('Pendiente: validar con seguridad');
  await page.keyboard.press('Control+Enter');
  const before = (await note.boundingBox())!;
  await page.mouse.move(before.x + 30, before.y + 20);
  await page.mouse.down();
  await page.mouse.move(before.x + 30, before.y + 180, { steps: 8 });
  await page.mouse.up();
  expect((await note.boundingBox())!.y).toBeGreaterThan(before.y + 100);
  await page.keyboard.press('Control+d');
  await expect(note).toHaveCount(2);
  await page.keyboard.press('Delete');
  await expect(note).toHaveCount(1);
  await expect(page.locator('.react-flow__node-stickyNote .react-flow__handle')).toHaveCount(0);

  // Modo manual (por defecto): no guarda solo.
  await page.waitForTimeout(2000);
  await expect(saveStatus(page)).toHaveText('Sin guardar');
  await page.getByRole('button', { name: /^Guardar(?! como)/ }).click();
  await expect(saveStatus(page)).toHaveText('Guardado');
  await page.reload();
  await expect(page.locator('.react-flow__node')).toHaveCount(5);
  await expect(page.locator('.sticky-note')).toHaveText('Pendiente: validar con seguridad');
  await expect(node(page, 'Inicio').locator('img')).toHaveCount(2);

  // Autoguardado: se activa desde el estado de guardado y guarda tras una pausa.
  await page.locator('.save-menu .popover-trigger').click();
  await page.getByLabel('Autoguardado').check();
  await page.keyboard.press('Escape');
  await dropNode(page, 'Servicio', 560, 420);
  await expect(saveStatus(page)).toHaveText('Sin guardar · auto');
  await expect(saveStatus(page)).toHaveText('Guardado · auto');

  // Si falla, lo dice, conserva los cambios y deja reintentar.
  await page.route('**/api/features/*/canvas', (route) => (route.request().method() === 'PUT' ? route.abort() : route.continue()));
  await rename(page, 4, 'Avisos');
  await expect(saveStatus(page)).toHaveText('Error al guardar · auto');
  // Salir con el guardado fallando: la persona decide.
  let asked = '';
  page.once('dialog', (dialog) => {
    asked = dialog.message();
    void dialog.dismiss();
  });
  await page.locator('.brand').click();
  await expect.poll(() => asked).toContain('No se pudieron guardar');
  await expect(page).toHaveURL(/\/features\//);
  await page.unroute('**/api/features/*/canvas');
  await page.getByRole('button', { name: 'Reintentar' }).click();
  await expect(saveStatus(page)).toHaveText('Guardado · auto');

  // Con cambios recién hechos, salir los guarda antes (sin preguntar).
  await rename(page, 4, 'Notificaciones');
  const url = page.url();
  await page.locator('.brand').click();
  await expect(page).toHaveURL(/\/apps$/);
  await page.goto(url);
  await expect(node(page, 'Notificaciones')).toHaveCount(1);
  await expect(saveStatus(page)).toHaveText('Al día · auto');
});
