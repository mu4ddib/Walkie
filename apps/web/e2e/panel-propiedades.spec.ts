import { expect, test, type Page } from '@playwright/test';
import { connect, dropNode, login, openNewFeature, saveStatus } from './helpers';

/**
 * Feature panel-propiedades (docs/features/panel-propiedades/spec.md), criterios 11 y 12, con API,
 * Keycloak y Postgres reales: documentar pantalla, regla, API y conexión, guardar, recargar idéntico
 * y borrar una regla asociada sin dejar referencias rotas.
 */
test('documentar inputs, reglas, API y conexión; recargar idéntico; borrar la regla limpia los inputs', async ({
  page,
}) => {
  await login(page);
  await openNewFeature(page, 'Abrir cuenta');

  // Regla con expresión (criterio 5).
  await dropNode(page, 'Regla', 360, 400);
  await field(page, 'Título').fill('Documento válido');
  await field(page, 'Expresión').fill('cc: solo dígitos\nde 6 a 10\nsin espacios\nobligatorio');

  // Pantalla con descripción e inputs: obligatorio con regla y enum con opciones (criterios 4, 8, 8b, 9).
  await dropNode(page, 'Pantalla', 120, 120);
  await field(page, 'Título').fill('Datos del cliente');
  await field(page, 'Descripción').fill('Pide documento y tipo de cuenta.');
  await page.getByRole('button', { name: '+ Agregar input' }).click();
  await field(page, 'Nombre').fill('documento');
  await page.getByLabel('Obligatorio').check();
  await page.getByRole('group', { name: 'Reglas' }).getByLabel('Documento válido').check();
  await page.getByRole('button', { name: '+ Agregar input' }).click();
  await field(page, 'Nombre', 1).fill('cuenta');
  await field(page, 'Tipo', 1).selectOption('enum');
  await field(page, 'Opciones (una por línea)').fill('Ahorros\nCorriente');

  // API con método y ruta (criterio 6).
  await dropNode(page, 'API', 440, 120);
  await field(page, 'Título').fill('Consultar cliente');
  await field(page, 'Método').selectOption('GET');
  await field(page, 'Ruta HTTP').fill('/clientes/{id}');

  // Conexión con etiqueta y condición (criterio 7).
  await connect(page, 1, 2);
  await page.locator('.kind-edge-label').click();
  await field(page, 'Etiqueta').fill('Buscar');
  // La condición es un detalle opcional: va en su sección plegable.
  await page.locator('summary', { hasText: 'Condición' }).click();
  await field(page, 'Condición').fill('200');

  // Lo que se ve en el lienzo (criterios 5, 6, 8 y 8c).
  await page.locator('.react-flow__pane').click({ position: { x: 700, y: 600 } });
  await expect(node(page, 'Datos del cliente').locator('.pixel-node-list li')).toHaveText([
    'documento* : string',
    'cuenta : enum',
  ]);
  await expect(node(page, 'Documento válido').locator('.pixel-node-expression')).toHaveText(
    'cc: solo dígitosde 6 a 10sin espacios+1 más',
  );
  await expect(node(page, 'Consultar cliente').locator('.pixel-node-http')).toHaveText('GET /clientes/{id}');
  await expect(page.locator('.kind-edge-label')).toHaveText('llama · Buscar [200]');
  await node(page, 'Documento válido').click();
  await expect(page.getByRole('region', { name: 'Usada por' }).getByRole('listitem')).toHaveText([
    'Datos del cliente · documento',
  ]);

  // Criterio 12: guardar y recargar idéntico, en el lienzo y en el panel.
  const before = await snapshot(page);
  await page.keyboard.press('Control+s');
  await expect(saveStatus(page)).toHaveText('Guardado');
  await page.reload();
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await expect(saveStatus(page)).toHaveText('Al día');
  expect(await snapshot(page)).toEqual(before);

  // Criterio 11: borrar la regla quita la asociación del input.
  await node(page, 'Documento válido').click();
  await page.keyboard.press('Delete');
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await node(page, 'Datos del cliente').click();
  await expect(page.getByText('No hay reglas en el lienzo.').first()).toBeVisible();
  await page.keyboard.press('Control+s');
  await expect(saveStatus(page)).toHaveText('Guardado');
  await page.reload();
  await node(page, 'Datos del cliente').click();
  await expect(page.getByLabel('Obligatorio').first()).toBeChecked();
  await expect(page.getByText('No hay reglas en el lienzo.').first()).toBeVisible();
});

/** Campo del panel por su etiqueta exacta (`index` si se repite, ej. por input). */
const field = (page: Page, label: string, index = 0) => page.getByLabel(label, { exact: true }).nth(index);

const node = (page: Page, title: string) =>
  page.locator('.react-flow__node').filter({ has: page.locator('.pixel-node-title', { hasText: title }) });

/** Contenido visible de cada nodo y conexión, más los valores del panel de cada nodo. */
async function snapshot(page: Page) {
  await page.locator('.react-flow__pane').click({ position: { x: 700, y: 600 } });
  const canvas = await page.evaluate(() => ({
    nodes: [...document.querySelectorAll<HTMLElement>('.react-flow__node')]
      .map((n) => `${n.innerText}|${n.style.transform}`)
      .sort(),
    edges: [...document.querySelectorAll('.kind-edge-label')].map((e) => e.textContent).sort(),
  }));
  const panels: Record<string, string[]> = {};
  for (const title of ['Documento válido', 'Datos del cliente', 'Consultar cliente']) {
    await node(page, title).click();
    panels[title] = await page
      .locator('.properties-panel')
      .evaluate((panel) =>
        [...panel.querySelectorAll<HTMLInputElement>('input, textarea, select')].map((e) =>
          e.type === 'checkbox' ? `${e.closest('label')?.textContent}=${e.checked}` : e.value,
        ),
      );
  }
  await page.locator('.kind-edge-label').click();
  panels.edge = await page
    .locator('.properties-panel')
    .evaluate((panel) => [...panel.querySelectorAll<HTMLInputElement>('input, select')].map((e) => e.value));
  return { canvas, panels };
}
