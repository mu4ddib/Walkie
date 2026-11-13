import { expect, test, type Page } from '@playwright/test';
import { connect, dropNode, login, saveStatus } from './helpers';

/**
 * Feature espacio-de-trabajo (docs/features/espacio-de-trabajo/spec.md), criterios 13 a 17, con API, Keycloak y
 * Postgres reales: contrato de una API, estructura de una base, notas y detalle de una conexión; se guardan, vuelven
 * igual al recargar y el contrato pasa entero al catálogo con "Guardar como componente".
 */
test('inspector técnico: contrato, base de datos, notas y conexión recargan idénticos', async ({ page }) => {
  await login(page);
  const app = `E2E detalle ${Date.now()}`;
  await page.getByLabel('Nueva app').fill(app);
  await page.getByRole('button', { name: 'Crear app' }).click();
  await page.getByRole('link', { name: app }).click();
  await page.getByLabel('Nueva feature').fill('Transferir');
  await page.getByRole('button', { name: 'Crear feature' }).click();
  await page.getByRole('link', { name: 'Transferir' }).click();

  await dropNode(page, 'API', 120, 160);
  await dropNode(page, 'Base de datos', 460, 160);
  await connect(page, 0, 1);
  const inspector = page.getByRole('complementary', { name: 'Propiedades' });

  // API: método, ruta, autenticación, un parámetro y dos respuestas (criterio 13).
  await node(page, 0).click();
  await inspector.getByLabel('Método', { exact: true }).selectOption('POST');
  await inspector.getByLabel('Ruta HTTP').fill('/transferencias');
  const contract = inspector.getByRole('group', { name: 'Contrato de la API' });
  // Las secciones vacías empiezan plegadas (detalle progresivo).
  await contract.locator('summary', { hasText: 'Autenticación' }).click();
  await contract.getByLabel('Tipo de autenticación').selectOption('bearer');
  await contract.locator('summary', { hasText: 'Parámetros' }).click();
  await contract.getByRole('button', { name: '+ Parámetro' }).click();
  await contract.getByLabel('Nombre', { exact: true }).fill('X-Canal');
  await contract.getByLabel('Dónde').selectOption('header');
  await contract.locator('summary', { hasText: 'Respuestas' }).click();
  await contract.getByRole('button', { name: '+ Respuesta' }).click();
  await contract.getByRole('button', { name: '+ Respuesta' }).click();
  await contract.getByLabel('Código').nth(1).fill('422');
  await contract.getByLabel('Significado').nth(1).fill('Saldo insuficiente');
  await expect(node(page, 0).locator('.pixel-node-detail')).toHaveText(
    'Bearer (token) · 1 parámetro · 2 respuestas (1 error)',
  );

  // Base de datos con una tabla y su clave (criterio 14).
  await node(page, 1).click();
  const structure = inspector.getByRole('group', { name: 'Estructura de la base de datos' });
  await structure.getByLabel('Motor').fill('PostgreSQL');
  await structure.getByRole('button', { name: '+ Tabla' }).click();
  await structure.getByLabel('Nombre', { exact: true }).fill('transferencias');
  await structure.getByRole('button', { name: '+ Campo' }).click();
  await structure.getByLabel('Campo', { exact: true }).fill('id');
  await structure.getByLabel('Clave').selectOption('primary');
  await expect(node(page, 1).locator('.pixel-node-detail')).toHaveText('PostgreSQL · 1 tabla');

  // Conexión: su operación con entidades y ejemplo (criterio 15; spec interacciones).
  await page.locator('.kind-edge-label').click();
  await inspector.getByLabel('Operación', { exact: true }).selectOption('db.write');
  await inspector.locator('summary', { hasText: 'Entidades' }).click();
  await inspector.getByLabel('Tablas o entidades').fill('transferencias');
  await inspector.locator('summary', { hasText: 'Ejemplo de payload' }).click();
  await inspector.getByLabel('Ejemplo de payload').fill('{ "monto": 1000 }');

  // Guardar y recargar: todo vuelve igual (criterio 17).
  await page.keyboard.press('Control+s');
  await expect(saveStatus(page)).toHaveText('Guardado');
  await page.reload();
  await expect(saveStatus(page)).toHaveText('Al día');
  await node(page, 0).click();
  await expect(contract.getByLabel('Tipo de autenticación')).toHaveValue('bearer');
  await expect(contract.getByLabel('Nombre', { exact: true })).toHaveValue('X-Canal');
  await expect(contract.getByLabel('Significado').nth(1)).toHaveValue('Saldo insuficiente');
  await page.locator('.kind-edge-label').click();
  await expect(inspector.getByLabel('Operación', { exact: true })).toHaveValue('db.write');
  await expect(inspector.getByLabel('Tablas o entidades')).toHaveValue('transferencias');
  await expect(inspector.getByLabel('Ejemplo de payload')).toHaveValue('{ "monto": 1000 }');

  // El contrato pasa entero al catálogo y se ve en la definición compartida.
  await node(page, 0).click();
  await inspector.getByRole('button', { name: 'Guardar como componente' }).click();
  const shared = inspector.getByRole('region', { name: 'Definición compartida' });
  await expect(shared.getByLabel('Tipo de autenticación')).toHaveValue('bearer');
  await expect(node(page, 0).locator('.pixel-node-detail')).toHaveText(
    'Bearer (token) · 1 parámetro · 2 respuestas (1 error)',
  );
});

const node = (page: Page, i: number) => page.locator('.react-flow__node').nth(i);
