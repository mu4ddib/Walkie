import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { login, rename, saveStatus } from './helpers';

/**
 * Walkie Live, tarea 11: Walkie analizándose a sí mismo, de punta a punta con la CLI, la API, la web, Keycloak y
 * Postgres reales. Se analiza una copia del código de Walkie (la API, la web y el compose, en sus mismas rutas) para
 * poder cambiarla y reanalizar sin tocar el repo.
 *
 * CLI → .walkiepack → «Crear app desde proyecto local» (vista previa, confirmar) → revisión → coincidencia por firma con
 * algo documentado a mano → crear en el catálogo → crear un módulo → crear una feature → abrir el lienzo → editar y
 * guardar → reanalizar → comparar → lo documentado sigue igual.
 *
 * También demuestra lo que Walkie deja fuera a propósito: la web llama a la API por `request()` con la URL armada en
 * tiempo de ejecución, así que el análisis no ve esas llamadas (limitación `dynamic-http-url`) y la feature nace solo
 * con sus pantallas y su navegación, sin inventar conexiones.
 */
const REPO = resolve(process.cwd(), '../..'); // Playwright corre desde apps/web
const API = process.env.VITE_API_URL ?? 'http://localhost:5080';
const PARTS = ['apps/api/src', 'apps/api/Directory.Build.props', 'apps/web/src', 'apps/web/package.json', 'infra/docker-compose.yml'];
const FILES_ENDPOINTS = 'apps/api/src/Walkie.Modules.Files/Features/AssetEndpoints.cs';

function copyOfWalkie(): string {
  const root = join(mkdtempSync(join(tmpdir(), 'walkie-se-analiza-')), 'Walkie');
  for (const part of PARTS) {
    const to = join(root, part);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(join(REPO, part), to, { recursive: true, filter: (src) => !/[\\/](bin|obj|node_modules)([\\/]|$)/.test(src) });
  }
  return root;
}

function scan(root: string, source: string, name: string): string {
  const pack = join(dirname(root), `${name}.walkiepack`);
  execFileSync('dotnet', ['run', '--project', '../cli/src/Walkie.Cli', '--', 'scan', root, '-o', pack, '--source-id', source], { stdio: 'pipe' });
  return pack;
}

async function capture(page: Page, name: string) {
  const dir = process.env.WALKIE_CAPTURES;
  if (dir) await page.screenshot({ path: join(dir, `walkie-se-analiza-${name}.png`), fullPage: true });
}

/** Llama a la API con el token de la sesión (lo que haría alguien documentando a mano). */
async function api<T>(page: Page, method: string, path: string, body?: unknown): Promise<T> {
  return page.evaluate(
    async ({ base, method, path, body }) => {
      const key = Object.keys(sessionStorage).find((k) => k.startsWith('oidc.user:'))!;
      const token = (JSON.parse(sessionStorage.getItem(key)!) as { access_token: string }).access_token;
      const res = await fetch(`${base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      return (await res.json()) as T;
    },
    { base: API, method, path, body },
  );
}

test('Walkie se analiza a sí mismo: de la CLI al lienzo, y un reanálisis que no pisa nada', async ({ page }) => {
  test.setTimeout(360_000);
  const root = copyOfWalkie();
  const source = randomUUID();
  const first = scan(root, source, 'primero');

  // ---------- Crear la app desde el proyecto ----------
  await login(page);
  await page.getByRole('button', { name: 'Crear app desde proyecto local' }).click();
  const dialog = page.getByRole('dialog', { name: 'Crear app desde proyecto local' });
  await dialog.getByLabel('Archivo .walkiepack').setInputFiles(first);
  const summary = dialog.getByLabel('Resumen del análisis');
  await expect(summary).toContainText('Walkie');
  // Las APIs de Walkie: crece con cada endpoint nuevo (46 en la tarea 11; 50 con los miembros de ADR-0015).
  await expect(summary).toContainText('50 API');
  await expect(summary).toContainText(/parcial/i);
  const app = `E2E Walkie se analiza ${Date.now()}`;
  await dialog.getByLabel('Nombre de la app').fill(app);
  await capture(page, 'crear-app');
  await dialog.getByRole('button', { name: 'Crear app', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Revisión del análisis' })).toBeVisible();
  const reviewUrl = page.url();
  const appId = /apps\/([^/]+)\/sources/.exec(reviewUrl)![1]!;
  const list = page.getByRole('list', { name: 'Hallazgos' });
  const inspector = page.getByRole('complementary', { name: 'Detalle del hallazgo' });

  // Lo que no se ve, dicho como limitación: las llamadas de la web por request() no se relacionan con ninguna API.
  await page.getByText(/^Limitaciones \(\d+\)$/).click();
  await expect(page.getByText(/no se puede resolver sin ejecutar \(baseUrl\)/)).toBeVisible();

  // ---------- Matching: algo documentado a mano coincide por firma ----------
  const health = await api<{ id: string; version: number }>(page, 'POST', `/api/apps/${appId}/catalog`, {
    type: 'api',
    title: 'Salud de la API (a mano)',
    description: 'Lo escribió el equipo.',
    http: { method: 'GET', path: '/api/health' },
  });
  await page.reload();
  const healthRow = list.getByRole('button', { name: /api:GET \/api\/health/ });
  await expect(healthRow).toContainText('Coincide');
  await healthRow.click();
  await expect(inspector).toContainText('Misma firma');
  await inspector.getByRole('button', { name: 'Vincular…' }).click();
  await inspector.getByRole('button', { name: 'Confirmar' }).click();
  await expect(inspector.getByRole('status')).toContainText('Vinculado a «Salud de la API (a mano)»');

  // ---------- Crear en el catálogo ----------
  await list.getByRole('button', { name: /api:GET \/api\/apps$/ }).click();
  await inspector.getByRole('button', { name: 'Crear en el catálogo…' }).click();
  await expect(inspector.getByRole('region', { name: 'Lo que se creará' })).toContainText('GET /api/apps');
  await inspector.getByRole('button', { name: 'Confirmar y crear' }).click();
  await expect(inspector.getByRole('status')).toContainText('Creado en el catálogo');

  // ---------- Crear un módulo: el de imágenes, con sus APIs y su base ----------
  await page.goto(`${reviewUrl}?kind=module`); // 50 APIs van antes: se filtra por tipo, como el selector «Tipo»
  await list.getByRole('button', { name: /module:Walkie\.Modules\.Files/ }).click();
  await inspector.getByRole('button', { name: 'Crear módulo…' }).click();
  let preview = inspector.getByRole('region', { name: 'Lo que se creará' });
  await preview.getByRole('checkbox', { name: /Crear también en el catálogo las APIs que faltan/ }).check();
  await expect(preview).toContainText('Interfaces');
  await capture(page, 'modulo-vista-previa');
  await inspector.getByRole('button', { name: 'Confirmar y crear' }).click();
  await expect(inspector.getByRole('status')).toContainText('Módulo creado');

  // ---------- Crear una feature: el catálogo de la web. Solo pantallas y navegación: no hay llamadas que el análisis viera ----------
  await page.goto(`${reviewUrl}?kind=feature`);
  await list.getByRole('button', { name: /feature:apps\/web:Catalog/ }).click();
  await inspector.getByRole('button', { name: 'Crear feature…' }).click();
  preview = inspector.getByRole('region', { name: 'Lo que se creará' });
  await expect(preview).toContainText('/apps/:appId/catalog');
  // Lo que el análisis vio: dos pantallas, ninguna llamada (las de request() no se ven) y ninguna navegación entre ellas.
  await expect(preview).toContainText('Llama aninguna');
  await expect(preview).toContainText('0 de navegación y 0 solicitudes HTTP');
  await capture(page, 'feature-vista-previa');
  await inspector.getByRole('button', { name: 'Confirmar y crear' }).click();
  await expect(inspector.getByRole('status')).toContainText('Feature creada');

  // ---------- Abrir el lienzo, editar y guardar ----------
  await inspector.getByRole('link', { name: 'Abrir la feature' }).or(inspector.getByRole('button', { name: 'Abrir la feature' })).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(2); // dos pantallas; ninguna API inventada
  await expect(page.locator('.react-flow__node .pixel-node-kind', { hasText: /API/ })).toHaveCount(0);
  const featureUrl = page.url();
  await rename(page, 0, 'Catálogo (revisado a mano)');
  await page.keyboard.press('Control+s');
  await expect(saveStatus(page)).toHaveText(/Guardado/);
  await capture(page, 'feature-lienzo');

  // ---------- Reanalizar: el código cambió (una API nueva en el módulo de imágenes) ----------
  const endpoints = join(root, FILES_ENDPOINTS);
  writeFileSync(
    endpoints,
    readFileSync(endpoints, 'utf8').replace('routes.MapGet(', 'routes.MapGet("/api/assets/{assetId:guid}/miniatura", () => Results.Ok());\n        routes.MapGet('),
  );
  const second = scan(root, source, 'segundo');
  await page.goto(`/apps/${appId}`);
  await page.getByRole('button', { name: /^Cargar análisis nuevo de Walkie/ }).click();
  const upload = page.getByRole('dialog', { name: 'Importar proyecto local' });
  await upload.getByLabel('Archivo .walkiepack').setInputFiles(second);
  await expect(upload).toContainText('se comparará con el del');
  await upload.getByRole('button', { name: 'Guardar análisis' }).click();
  await expect(page.getByRole('heading', { name: 'Revisión del análisis' })).toBeVisible();

  // ---------- Comparar ----------
  const comparison = page.getByRole('region', { name: 'Comparación con el análisis anterior' });
  await expect(comparison.getByRole('button', { name: /Nuevo en este análisis 1\b/ })).toBeVisible();
  await expect(list.getByRole('button', { name: /api:GET \/api\/assets\/\{\}\/miniatura/ })).toContainText('Nuevo en este análisis');
  await expect(list.getByRole('button', { name: /api:GET \/api\/health/ })).toContainText('Vinculado');
  await page.goto(`${page.url().split('?')[0]}?kind=feature`);
  await expect(list.getByRole('button', { name: /feature:apps\/web:Catalog/ })).toContainText('Creado');
  await capture(page, 'reanalisis');

  // ---------- Lo documentado sigue igual ----------
  const after = await api<{ version: number; description?: string; title: string }>(page, 'GET', `/api/catalog/${health.id}`);
  expect(after).toMatchObject({ version: health.version, title: 'Salud de la API (a mano)', description: 'Lo escribió el equipo.' });
  await page.goto(featureUrl);
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await expect(page.locator('.react-flow__node', { hasText: 'Catálogo (revisado a mano)' })).toBeVisible();
  await expect(saveStatus(page)).toHaveText(/Al día/);
});
