import { expect, test, type Page } from '@playwright/test';
import { dropNode, login, saveStatus } from './helpers';

/**
 * Feature modo-tour (docs/features/modo-tour/spec.md), criterios 5, 7, 8, 9 y 11, con API, Keycloak,
 * Postgres y RustFS reales: armar un tour de tres pasos (pantalla, regla y portal), guardar y recargar
 * idéntico, recorrerlo con teclado y botones, terminar, salir con Esc e ir a la feature del portal.
 */
test('armar un tour de tres pasos, recargar idéntico, recorrerlo y terminar', async ({ page }) => {
  await login(page);
  const app = `E2E tour ${Date.now()}`;
  await page.getByLabel('Nueva app').fill(app);
  await page.getByRole('button', { name: 'Crear app' }).click();
  await page.getByRole('link', { name: app }).click();
  for (const feature of ['Iniciar sesión', 'Transferir']) {
    await page.getByLabel('Nueva feature').fill(feature);
    await page.getByRole('button', { name: 'Crear feature' }).click();
    await expect(page.getByRole('link', { name: feature })).toBeVisible();
  }
  await page.getByRole('link', { name: 'Iniciar sesión' }).click();

  // Tres nodos: pantalla, regla y portal a Transferir.
  await dropNode(page, 'Pantalla', 80, 120);
  await field(page, 'Título').fill('Login');
  await dropNode(page, 'Regla', 320, 120);
  await field(page, 'Título').fill('Documento válido');
  await dropNode(page, 'Portal', 560, 120);
  await page.getByLabel('Feature destino').selectOption({ label: 'Transferir' });
  await clearSelection(page);

  // Tour de tres pasos con notas (criterios 1 y 2).
  await page.getByLabel('Nombre del tour nuevo').fill('Primer ingreso');
  await page.getByRole('button', { name: 'Nuevo tour' }).click();
  const notes = [
    'Aquí empieza todo: el usuario escribe su documento.',
    'El documento debe tener solo dígitos.',
    'Si todo sale bien, sigue a Transferir.',
  ];
  for (const [index, label] of ['Pantalla: Login', 'Regla: Documento válido', 'Portal: Transferir'].entries()) {
    await page.getByLabel('Nodo del paso nuevo').selectOption({ label });
    await page.getByRole('button', { name: 'Agregar paso' }).click();
    await field(page, `Paso ${index + 1}: nota`).fill(notes[index]!);
  }
  await expect(saveStatus(page)).toHaveText('Sin guardar');

  // Guardar y recargar idéntico (criterio 11).
  const before = await tourEditor(page);
  await page.keyboard.press('Control+s');
  await expect(saveStatus(page)).toHaveText('Guardado');
  await page.reload();
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await page.getByRole('button', { name: 'Primer ingreso' }).click();
  expect(await tourEditor(page)).toEqual(before);

  // Ver tour: solo lectura, sin paleta ni panel, barra con el paso (criterios 5 y 6).
  const viewport = await viewportTransform(page);
  await page.getByRole('button', { name: 'Ver tour' }).click();
  const bar = page.getByRole('toolbar', { name: 'Tour' });
  const bubble = page.getByRole('region', { name: 'Paso del tour' });
  await expect(bar.getByRole('status')).toHaveText('Paso 1 de 3');
  await expect(page.locator('.canvas')).toHaveClass(/canvas-touring/);
  await expect(page.getByRole('button', { name: 'Nuevo tour' })).toBeHidden();
  await expect(bubble).toContainText(notes[0]!);
  await expect(page.locator('.react-flow__node.tour-current')).toContainText('Login');
  await expect(page.locator('.react-flow__node.tour-dim')).toHaveCount(2);
  await expect(page.getByRole('img', { name: 'Walkie, el guía' })).toBeVisible();

  // Teclado y botones (criterio 7).
  await page.keyboard.press('ArrowRight');
  await expect(bar.getByRole('status')).toHaveText('Paso 2 de 3');
  await expect(bubble).toContainText(notes[1]!);
  await bar.getByRole('button', { name: 'Siguiente' }).click();
  await expect(bar.getByRole('status')).toHaveText('Paso 3 de 3');
  await expect(bubble.getByRole('button', { name: 'Ir a Transferir' })).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(bar.getByRole('status')).toHaveText('Paso 2 de 3');
  await bar.getByRole('button', { name: 'Anterior' }).click();
  await expect(bar.getByRole('status')).toHaveText('Paso 1 de 3');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');

  // Último paso: "Terminar" celebra y sale; la vista vuelve a como estaba (criterios 7 y 8).
  await bar.getByRole('button', { name: 'Terminar' }).click();
  await expect(bubble).toContainText('¡Fin del tour!');
  await expect(bar).toBeHidden();
  await expect(page.locator('.canvas')).not.toHaveClass(/canvas-touring/);
  await expect(page.locator('.react-flow__node.tour-dim')).toHaveCount(0);
  // La vista vuelve con la misma transición que el resto de la cámara: se espera a que llegue.
  await expect.poll(() => viewportTransform(page)).toBe(viewport);

  // Esc sale (criterio 7) y el lienzo sigue sin cambios.
  await page.getByRole('button', { name: 'Ver tour' }).click();
  await expect(bar).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(bar).toBeHidden();
  expect(await viewportTransform(page)).toBe(viewport);
  await expect(saveStatus(page)).toHaveText('Al día');

  // "Ir a Transferir" desde el paso del portal abre esa feature (criterio 9).
  await page.getByRole('button', { name: 'Ver tour' }).click();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await bubble.getByRole('button', { name: 'Ir a Transferir' }).click();
  await expect(page.getByRole('navigation', { name: 'Ruta' })).toContainText('Transferir');
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
});

const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });

async function clearSelection(page: Page) {
  await page.locator('.react-flow__pane').click({ position: { x: 700, y: 600 } });
}

/**
 * Nombre del tour y, por paso, lo que dice su encabezado cerrado (nodo, tipo y vista previa de la nota) y la nota
 * completa (en su `title`), como los muestra el editor del panel (spec tours-compactos).
 */
function tourEditor(page: Page) {
  return page.locator('.tour-editor').evaluate((editor) => ({
    name: editor.querySelector<HTMLInputElement>('.tour-name-input')!.value,
    steps: [...editor.querySelectorAll('.tour-step')].map((step) => ({
      heading: step.querySelector('.tour-step-text')!.textContent,
      full: step.querySelector('.tour-step-toggle')!.getAttribute('title'),
    })),
  }));
}

const viewportTransform = (page: Page) =>
  page.locator('.react-flow__viewport').evaluate((v) => (v as HTMLElement).style.transform);
