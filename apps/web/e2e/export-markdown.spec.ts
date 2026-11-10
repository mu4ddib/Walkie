import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { connect, dropNode, login, png, readZip, saveStatus } from './helpers';

/**
 * Feature export-markdown (docs/features/export-markdown/spec.md), criterios 1 a 7 y 9, con API, Keycloak,
 * Postgres y RustFS reales: documentar una feature (pantalla con imagen e inputs, regla, API, portal,
 * conexiones y un tour), exportarla y leer el .zip descargado.
 */
test('exportar una feature documentada a un .zip con su Markdown e imágenes', async ({ page }) => {
  await login(page);
  const app = `E2E export ${Date.now()}`;
  await page.getByLabel('Nueva app').fill(app);
  await page.getByRole('button', { name: 'Crear app' }).click();
  await page.getByRole('link', { name: app }).click();
  for (const feature of ['Iniciar sesión', 'Transferir']) {
    await page.getByLabel('Nueva feature').fill(feature);
    await page.getByRole('button', { name: 'Crear feature' }).click();
    await expect(page.getByRole('link', { name: feature })).toBeVisible();
  }
  await page.getByRole('link', { name: 'Iniciar sesión' }).click();

  // Regla, pantalla con imagen e input que la usa, API con método y ruta, y portal (datos ficticios).
  await dropNode(page, 'Regla', 320, 360);
  await field(page, 'Título').fill('Documento válido');
  await field(page, 'Expresión').fill('solo dígitos\nde 6 a 10');
  await dropNode(page, 'Pantalla', 80, 120);
  await field(page, 'Título').fill('Login');
  const image = png(64, 40);
  await page.getByLabel('Subir imagen').setInputFiles({ name: 'login.png', mimeType: 'image/png', buffer: image });
  await expect(page.locator('.pixel-node img')).toBeVisible();
  await page.getByRole('button', { name: '+ Agregar input' }).click();
  await field(page, 'Nombre').fill('documento');
  await page.getByLabel('Obligatorio').check();
  await page.getByRole('group', { name: 'Reglas' }).getByLabel('Documento válido').check();
  await dropNode(page, 'API', 400, 120);
  await field(page, 'Título').fill('Consultar cliente');
  await field(page, 'Método').selectOption('GET');
  await field(page, 'Ruta HTTP').fill('/clientes/{id}');
  await dropNode(page, 'Portal', 560, 360);
  await page.getByLabel('Feature destino').selectOption({ label: 'Transferir' });
  await connect(page, 1, 2); // Login → Consultar cliente
  await connect(page, 1, 3); // Login → Transferir
  await page.locator('.react-flow__pane').click({ position: { x: 700, y: 600 } });

  // Tour de dos pasos.
  await page.getByLabel('Nombre del tour nuevo').fill('Primer ingreso');
  await page.getByRole('button', { name: 'Nuevo tour' }).click();
  await page.getByLabel('Nodo del paso nuevo').selectOption({ label: 'Pantalla: Login' });
  await page.getByRole('button', { name: 'Agregar paso' }).click();
  await field(page, 'Paso 1: nota').fill('Aquí empieza todo.');
  await page.getByLabel('Nodo del paso nuevo').selectOption({ label: 'API: Consultar cliente' });
  await page.getByRole('button', { name: 'Agregar paso' }).click();
  await page.keyboard.press('Control+s');
  await expect(saveStatus(page)).toHaveText('Guardado');

  // Exportar baja <slug>.zip (criterios 1 y 9).
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('iniciar-sesion.zip');
  const files = readZip(await readFile((await file.path())!));

  // El .md y la imagen enlazada, con los bytes subidos (criterio 2).
  const markdown = files.get('iniciar-sesion.md')!.toString('utf8');
  const imagePath = /!\[Login\]\((img\/login-[0-9a-f]{8}\.png)\)/.exec(markdown)?.[1];
  expect(imagePath).toBeDefined();
  expect([...files.keys()].sort()).toEqual([imagePath, 'iniciar-sesion.md'].sort());
  expect(files.get(imagePath!)!.equals(image)).toBe(true);

  // Encabezado, diagrama, secciones, conexiones y tour (criterios 3 a 7).
  expect(markdown).toMatch(new RegExp(`^# Iniciar sesión\\n\\nApp: \\*\\*${app}\\*\\* · Versión del lienzo: 1 ·`));
  expect(markdown).toContain('```mermaid\nflowchart LR\n');
  expect(markdown).toContain('["Pantalla: Login"]');
  expect(markdown).toContain('{{"Regla: Documento válido"}}');
  expect(markdown).toMatch(/-->\|"llama[":]/);
  for (const heading of ['## Pantallas', '## Reglas', '## APIs', '## Portales', '## Conexiones', '## Tours']) {
    expect(markdown).toContain(heading);
  }
  expect(markdown).toContain('| `documento` | string | Sí |  | Documento válido |');
  expect(markdown).toContain('```\nsolo dígitos\nde 6 a 10\n```');
  expect(markdown).toContain('Valida: `documento` (Login).');
  expect(markdown).toContain('`GET /clientes/{id}`');
  expect(markdown).toContain('Lleva a **Transferir**.');
  // Sin etiqueta propia, la solicitud lleva el endpoint del contrato.
  expect(markdown).toMatch(/- Login → Consultar cliente \(llama[):]/);
  expect(markdown).toContain('- Login → Transferir (navega)');
  expect(markdown).toContain('1. **Login**: Aquí empieza todo.\n2. **Consultar cliente**');

  // Con cambios sin guardar se exporta lo guardado, y se avisa (criterio 1).
  await page.locator('.react-flow__node').first().click();
  await field(page, 'Título').fill('Regla cambiada');
  const second = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar' }).click();
  const unsaved = readZip(await readFile((await (await second).path())!)).get('iniciar-sesion.md')!.toString('utf8');
  await expect(page.getByRole('note').filter({ hasText: 'Se exportó lo guardado' })).toBeVisible();
  expect(unsaved).toContain('### Documento válido');
  expect(unsaved).not.toContain('Regla cambiada');
});

const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });
