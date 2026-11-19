import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

/**
 * Walkie Live, tarea 10 (docs/features/walkie-live/spec.md) con la CLI, la API, Keycloak y Postgres reales: crear una
 * app desde un proyecto local (galería → guía de la CLI → .walkiepack → vista previa → nombre → crear → revisión), un
 * corte de red justo después de crear (el reintento con el mismo importId no duplica la app) y el reanálisis del mismo
 * proyecto desde la app, con las diferencias a la vista. Proyecto ficticio, sin datos reales.
 */
const BASE: Record<string, string> = {
  'src/Tienda.Api/Tienda.Api.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>',
  'docker-compose.yml': ['services:', '  db:', '    image: postgres:17', '    environment:', '      POSTGRES_DB: tienda'].join('\n'),
};
const program = (routes: string[]) =>
  ['var app = WebApplication.CreateBuilder(args).Build();', 'var pedidos = app.MapGroup("/api/pedidos");', ...routes, 'app.Run();'].join('\n');

function project(): { dir: string; scan: (routes: string[], name: string) => string } {
  const root = mkdtempSync(join(tmpdir(), 'walkie-reanalisis-'));
  const dir = join(root, 'tienda');
  for (const [path, content] of Object.entries(BASE)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return {
    dir,
    // El mismo proyecto (su .walkie/source.json lo deja la CLI en el primer análisis), con otras rutas.
    scan(routes, name) {
      writeFileSync(join(dir, 'src/Tienda.Api/Program.cs'), program(routes));
      const pack = join(root, name);
      rmSync(pack, { force: true });
      execFileSync('dotnet', ['run', '--project', '../cli/src/Walkie.Cli', '--', 'scan', dir, '-o', pack], { stdio: 'pipe' });
      return pack;
    },
  };
}

async function capture(page: Page, name: string) {
  const dir = process.env.WALKIE_CAPTURES;
  if (dir) await page.screenshot({ path: join(dir, `walkie-live-${name}.png`), fullPage: true });
}

test('crear una app desde un proyecto local y reanalizarlo', async ({ page }) => {
  test.setTimeout(300_000);
  const tienda = project();
  const first = tienda.scan(
    ['pedidos.MapGet("/{id:guid}", (Guid id) => Results.Ok());', 'pedidos.MapPost("/", () => Results.Created());'],
    'primero.walkiepack',
  );

  await login(page);
  // .walkie y app vacía siguen ahí, aparte.
  await expect(page.getByRole('button', { name: 'Importar app' })).toBeVisible();
  await expect(page.getByLabel('Nueva app')).toBeVisible();
  await page.getByRole('button', { name: 'Crear app desde proyecto local' }).click();
  const dialog = page.getByRole('dialog', { name: 'Crear app desde proyecto local' });
  await expect(dialog).toContainText('walkie scan .');
  await dialog.getByLabel('Archivo .walkiepack').setInputFiles(first);

  // Vista previa: qué trae y el nombre propuesto (de la fuente), sin crear nada.
  await expect(dialog.getByLabel('Resumen del análisis')).toContainText('walkie-cli');
  const name = dialog.getByLabel('Nombre de la app');
  await expect(name).toHaveValue(/^tienda/);
  const app = `E2E Desde proyecto ${Date.now()}`;
  await name.fill(app);
  await capture(page, 'crear-app-desde-proyecto');

  // Corte de red después de crear: la API recibe y crea la app, pero la respuesta no llega al navegador.
  await page.evaluate(() => {
    const real = window.fetch.bind(window);
    let cut = true;
    window.fetch = async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (cut && url.includes('/api/sources/import') && !url.includes('dryRun')) {
        cut = false;
        await (await real(input, init)).arrayBuffer();
        throw new TypeError('Failed to fetch');
      }
      return real(input, init);
    };
  });
  const lost = page.waitForResponse((r) => r.url().includes('/api/sources/import') && !r.url().includes('dryRun'));
  await dialog.getByRole('button', { name: 'Crear app', exact: true }).click();
  expect((await lost).status()).toBe(201);
  await expect(dialog.getByRole('alert')).toContainText('no se creará otra app');
  await capture(page, 'crear-app-error');
  const retried = page.waitForResponse((r) => r.url().includes('/api/sources/import') && !r.url().includes('dryRun'));
  await dialog.getByRole('button', { name: 'Reintentar' }).click();
  const response = await retried;
  expect(response.status()).toBe(200);
  expect(((await response.json()) as { status: string }).status).toBe('existing');

  // Revisión del primer análisis de la app nueva.
  await expect(page.getByRole('heading', { name: 'Revisión del análisis' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Ruta' })).toContainText(app);
  await expect(page.getByRole('note').filter({ hasText: 'primer análisis' })).toBeVisible();
  const list = page.getByRole('list', { name: 'Hallazgos' });
  const post = list.getByRole('button', { name: /api:POST \/api\/pedidos/ });
  await post.click();
  const inspector = page.getByRole('complementary', { name: 'Detalle del hallazgo' });
  await inspector.getByRole('button', { name: 'Descartar…' }).click();
  await inspector.getByRole('button', { name: 'Confirmar' }).click();
  await expect(inspector.getByRole('status')).toHaveText('Descartado.');

  // Una sola app con ese nombre, vacía (sin features ni catálogo).
  await page.goto('/apps');
  await expect(page.getByRole('link', { name: app })).toHaveCount(1);
  await page.getByRole('link', { name: app }).click();
  await expect(page.getByText('Aún no hay features')).toBeVisible();

  // Reanálisis: otra ruta, el contrato del detalle cambió y POST ya no está.
  const second = tienda.scan(
    ['pedidos.MapGet("/{pedidoId:guid}", (Guid pedidoId) => Results.Ok());', 'pedidos.MapDelete("/{pedidoId:guid}", (Guid pedidoId) => Results.NoContent());'],
    'segundo.walkiepack',
  );
  await page.getByRole('button', { name: /^Cargar análisis nuevo de tienda/ }).click();
  const upload = page.getByRole('dialog', { name: 'Importar proyecto local' });
  await upload.getByLabel('Archivo .walkiepack').setInputFiles(second);
  await expect(upload).toContainText('se comparará con el del');
  await upload.getByRole('button', { name: 'Guardar análisis' }).click();

  await expect(page.getByRole('heading', { name: 'Revisión del análisis' })).toBeVisible();
  const comparison = page.getByRole('region', { name: 'Comparación con el análisis anterior' });
  await expect(comparison).toContainText('Comparado con el análisis anterior');
  await expect(comparison.getByRole('button', { name: /Nuevo en este análisis 1/ })).toBeVisible();
  await expect(comparison.getByRole('button', { name: /Cambió desde el anterior 1/ })).toBeVisible();
  await expect(list.getByRole('button', { name: /api:DELETE \/api\/pedidos/ })).toContainText('Nuevo en este análisis');
  await expect(list.getByRole('button', { name: /api:GET \/api\/pedidos/ })).toContainText('Cambió desde el anterior');
  // El descartado que ya no aparece se marca (nada se borra).
  await expect(list.getByRole('button', { name: /api:POST \/api\/pedidos/ })).toContainText('Ya no aparece');
  await capture(page, 'reanalisis');

  // Filtrar por lo que pide revisión.
  await comparison.getByRole('button', { name: /Requiere revisión/ }).click();
  await expect(page).toHaveURL(/needsReview=true/);
  await expect(list.getByRole('button', { name: /api:DELETE/ })).toBeVisible();
  await capture(page, 'reanalisis-requiere-revision');
});
