import { expect, test } from '@playwright/test';
import { connect, dropNode, login, openNewFeature, rename, saveStatus, visibleGraph } from './helpers';

/**
 * Gate de la fase 1 (docs/roadmap.md): "un flujo se guarda y se recarga igual".
 * Cubre los criterios de docs/features/lienzo-base/spec.md con API, Keycloak y Postgres reales.
 */
test('crear, dibujar, guardar y recargar: el lienzo vuelve idéntico', async ({ page }) => {
  await login(page);
  await openNewFeature(page, 'Transferir');

  // Criterios 3 y 4: paleta y grilla de 8 px.
  await dropNode(page, 'Pantalla', 123, 165);
  await dropNode(page, 'API', 363, 165);
  await dropNode(page, 'Base de datos', 603, 165);
  await expect(page.locator('.pixel-node')).toHaveCount(3);
  await expect(page.locator('.pixel-node-title')).toHaveText(['Pantalla', 'API', 'Base de datos']);
  for (const transform of await page.locator('.react-flow__node').evaluateAll((ns) => ns.map((n) => (n as HTMLElement).style.transform))) {
    const [x, y] = transform.match(/-?\d+(\.\d+)?/g)!.map(Number);
    expect(x! % 8, transform).toBe(0);
    expect(y! % 8, transform).toBe(0);
  }

  // Criterio 5: tipo por defecto según el par, y cambiarlo.
  await connect(page, 0, 1);
  await connect(page, 1, 2);
  await expect(page.locator('.kind-edge-label')).toHaveText(['llama', 'lee']);
  await page.locator('.kind-edge-label').nth(1).click();
  await page.getByLabel('Tipo de conexión').selectOption('writes');
  await page.locator('.react-flow__pane').click({ position: { x: 600, y: 500 } });
  await expect(page.locator('.kind-edge-label')).toHaveText(['llama', 'escribe']);

  // Criterio 6: editar título (Escape cancela, Enter confirma).
  await page.locator('.react-flow__node').first().dblclick();
  await page.getByLabel('Título del nodo').fill('No debe quedar');
  await page.keyboard.press('Escape');
  await rename(page, 0, 'Formulario de transferencia');
  await expect(page.locator('.pixel-node-title').first()).toHaveText('Formulario de transferencia');

  // Criterio 8: guardar con Ctrl+S y recargar idéntico.
  await expect(saveStatus(page)).toHaveText('Sin guardar');
  const before = await visibleGraph(page);
  await page.keyboard.press('Control+s');
  await expect(saveStatus(page)).toHaveText('Guardado');

  await page.reload();
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await expect(saveStatus(page)).toHaveText('Al día');
  expect(await visibleGraph(page)).toEqual(before);
});

test('borrar un nodo se lleva sus conexiones y persiste', async ({ page }) => {
  await login(page);
  await openNewFeature(page);
  await dropNode(page, 'Pantalla', 120, 160);
  await dropNode(page, 'API', 360, 160);
  await dropNode(page, 'Base de datos', 600, 160);
  await connect(page, 0, 1);
  await connect(page, 1, 2);
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);

  // Criterio 7: Supr borra el nodo y sus conexiones.
  await page.locator('.react-flow__node').nth(1).click();
  await page.keyboard.press('Delete');
  await expect(page.locator('.pixel-node')).toHaveCount(2);
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);

  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(saveStatus(page)).toHaveText('Guardado');
  await page.reload();
  await expect(page.locator('.pixel-node-title')).toHaveText(['Pantalla', 'Base de datos']);
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
});

test('conflicto: si otra pestaña guardó antes, la API responde 409 y se puede recargar', async ({ page, context }) => {
  await login(page);
  await openNewFeature(page);
  await dropNode(page, 'Pantalla', 120, 160);
  await dropNode(page, 'API', 480, 160);
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(saveStatus(page)).toHaveText('Guardado');

  // Segunda pestaña: mismo lienzo (la sesión de Keycloak se reutiliza), cambia y guarda primero.
  const other = await context.newPage();
  await login(other, new URL(page.url()).pathname);
  await expect(other.locator('.pixel-node')).toHaveCount(2);
  await rename(other, 1, 'API de la otra pestaña');
  await other.getByRole('button', { name: 'Guardar' }).click();
  await expect(saveStatus(other)).toHaveText('Guardado');

  // Criterio 9: la primera pestaña tiene una versión vieja.
  await rename(page, 0, 'Cambio que choca');
  await page.getByRole('button', { name: 'Guardar' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Alguien guardó este lienzo antes que tú (versión 2)');
  await expect(saveStatus(page)).toHaveText('Sin guardar');

  await dialog.getByRole('button', { name: 'Recargar versión del servidor' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.pixel-node-title')).toHaveText(['Pantalla', 'API de la otra pestaña']);
  await expect(saveStatus(page)).toHaveText('Al día');
});
