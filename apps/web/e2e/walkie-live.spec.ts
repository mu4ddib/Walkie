import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from '@playwright/test';
import { login } from './helpers';

/**
 * Walkie Live (docs/features/walkie-live/spec.md, tarea 5) con la CLI, la API, Keycloak y Postgres reales: un proyecto
 * ficticio se analiza con `walkie scan` (la CLI de verdad, no un paquete fabricado), se carga en «Importar proyecto
 * local» con vista previa, se guarda, se revisa y se descarta un hallazgo; la decisión sigue tras recargar y el mismo
 * paquete no se guarda dos veces.
 */
function scanFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'walkie-live-'));
  const project = join(root, 'tienda');
  const files: Record<string, string> = {
    'src/Tienda.Api/Tienda.Api.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>',
    'src/Tienda.Api/Program.cs': [
      'var app = WebApplication.CreateBuilder(args).Build();',
      'var pedidos = app.MapGroup("/api/pedidos");',
      'pedidos.MapGet("/{pedidoId:guid}", (Guid pedidoId) => Results.Ok());',
      'pedidos.MapPost("/", () => Results.Created());',
      'app.Run();',
    ].join('\n'),
    'docker-compose.yml': ['services:', '  db:', '    image: postgres:17', '    environment:', '      POSTGRES_DB: tienda'].join('\n'),
  };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(project, path)), { recursive: true });
    writeFileSync(join(project, path), content);
  }
  const pack = join(root, 'architecture.walkiepack');
  execFileSync('dotnet', ['run', '--project', '../cli/src/Walkie.Cli', '--', 'scan', project, '-o', pack], { stdio: 'pipe' });
  return pack;
}

/** Con `WALKIE_CAPTURES=<carpeta>` guarda capturas para revisar el diseño a mano. */
async function capture(page: import('@playwright/test').Page, name: string) {
  const dir = process.env.WALKIE_CAPTURES;
  if (dir) await page.screenshot({ path: join(dir, `walkie-live-${name}.png`), fullPage: true });
}

test('importar un proyecto local analizado con la CLI y revisarlo', async ({ page }) => {
  test.setTimeout(240_000);
  const pack = scanFixture();

  await login(page);
  const app = `E2E Walkie Live ${Date.now()}`;
  await page.getByLabel('Nueva app').fill(app);
  await page.getByRole('button', { name: 'Crear app' }).click();
  await page.getByRole('link', { name: app }).click();
  const appUrl = page.url();

  const sources = page.getByRole('region', { name: 'Proyectos locales' });
  await expect(sources).toContainText('Aún no hay análisis de proyectos locales');
  await page.getByRole('button', { name: 'Importar proyecto local' }).first().click();

  const dialog = page.getByRole('dialog', { name: 'Importar proyecto local' });
  await expect(dialog).toContainText('walkie scan .');
  await dialog.getByLabel('Archivo .walkiepack').setInputFiles(pack);

  // Vista previa (dryRun): qué trae, sin guardar nada.
  const summary = dialog.getByLabel('Resumen del análisis');
  await expect(summary).toContainText('tienda');
  await expect(summary).toContainText('walkie-cli');
  await expect(summary).toContainText('API');
  await capture(page, 'importar-proyecto-local');
  const saved = page.waitForResponse((r) => r.url().includes('/sources/snapshots') && !r.url().includes('dryRun') && r.status() === 201);
  await dialog.getByRole('button', { name: 'Guardar análisis' }).click();
  await saved;

  // La revisión del análisis guardado.
  await expect(page.getByRole('heading', { name: 'Revisión del análisis' })).toBeVisible();
  const list = page.getByRole('list', { name: 'Hallazgos' });
  const post = list.getByRole('button', { name: /api:POST \/api\/pedidos/ });
  await expect(post).toContainText('Nuevo');
  await expect(page.getByRole('group', { name: 'Hallazgos por estado' })).toContainText('Nuevo');

  await post.click();
  const inspector = page.getByRole('complementary', { name: 'Detalle del hallazgo' });
  await expect(inspector.getByRole('region', { name: 'Evidencia' })).toContainText('src/Tienda.Api/Program.cs');

  await capture(page, 'revision');
  await inspector.getByLabel('Nota (opcional)').fill('No va al catálogo');
  await inspector.getByRole('button', { name: 'Descartar…' }).click();
  await expect(inspector).toContainText('Seguirá descartado');
  await inspector.getByRole('button', { name: 'Confirmar' }).click();
  await expect(inspector.getByRole('status')).toHaveText('Descartado.');
  await expect(post).toContainText('Descartado');

  // La decisión queda guardada.
  await page.reload();
  await expect(page.getByRole('list', { name: 'Hallazgos' }).getByRole('button', { name: /api:POST \/api\/pedidos/ })).toContainText(
    'Descartado',
  );

  // En la app aparece la fuente; el mismo paquete no se guarda otra vez.
  await page.goto(appUrl);
  await expect(sources).toContainText('tienda');
  await page.getByRole('button', { name: 'Importar proyecto local' }).first().click();
  await dialog.getByLabel('Archivo .walkiepack').setInputFiles(pack);
  await expect(dialog).toContainText('Este paquete ya está cargado en la app');
  await dialog.getByRole('button', { name: 'Abrir revisión' }).click();
  await expect(page.getByRole('heading', { name: 'Revisión del análisis' })).toBeVisible();
});

/**
 * Tarea 6: un hallazgo del análisis real entra al catálogo de la app. Vista previa con el elemento y su id, confirmar,
 * abrirlo en el catálogo de siempre con su procedencia. No crea features ni lienzos (eso es la tarea 9).
 */
test('crear en el catálogo un hallazgo del análisis real y abrirlo con su procedencia', async ({ page }) => {
  test.setTimeout(240_000);
  const pack = scanFixture();

  await login(page);
  const app = `E2E Walkie Live catálogo ${Date.now()}`;
  await page.getByLabel('Nueva app').fill(app);
  await page.getByRole('button', { name: 'Crear app' }).click();
  await page.getByRole('link', { name: app }).click();
  const appUrl = page.url();

  await page.getByRole('button', { name: 'Importar proyecto local' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Importar proyecto local' });
  await dialog.getByLabel('Archivo .walkiepack').setInputFiles(pack);
  await expect(dialog.getByLabel('Resumen del análisis')).toContainText('walkie-cli');
  await dialog.getByRole('button', { name: 'Guardar análisis' }).click();
  await expect(page.getByRole('heading', { name: 'Revisión del análisis' })).toBeVisible();

  const list = page.getByRole('list', { name: 'Hallazgos' });
  const get = list.getByRole('button', { name: /api:GET \/api\/pedidos\/\{\}/ });
  await get.click();
  const inspector = page.getByRole('complementary', { name: 'Detalle del hallazgo' });
  await inspector.getByRole('button', { name: 'Crear en el catálogo…' }).click();

  // Vista previa: lo que se creará, con su id y sus avisos; todavía nada en el catálogo.
  const preview = inspector.getByRole('region', { name: 'Lo que se creará' });
  await expect(preview).toContainText('GET /api/pedidos/{pedidoId}');
  await expect(preview.getByRole('list', { name: 'Avisos' })).toContainText('Sin evidencia para');
  await capture(page, 'crear-vista-previa');
  const created = page.waitForResponse((r) => r.url().includes('/apply') && !r.url().includes('dryRun') && r.status() === 200);
  await inspector.getByRole('button', { name: 'Confirmar y crear' }).click();
  await created;

  await expect(inspector.getByRole('status')).toContainText('Creado en el catálogo');
  await expect(get).toContainText('Creado');
  await inspector.getByRole('link', { name: 'Abrir en el catálogo' }).click();

  // El catálogo de siempre: el elemento es editable y dice de dónde viene.
  await expect(page).toHaveURL(/\/catalog\/[0-9a-f-]{36}$/);
  const detail = page.getByRole('complementary', { name: 'Detalle del elemento' });
  const provenance = detail.getByRole('region', { name: 'De dónde viene' });
  await expect(provenance).toContainText('Creado desde');
  await expect(provenance).toContainText('src/Tienda.Api/Program.cs');
  await expect(detail.getByLabel('Título')).toBeEditable();
  await capture(page, 'catalogo-procedencia');

  // Ni features ni lienzos nuevos: eso llega con la tarea 9.
  await page.goto(appUrl);
  await expect(page.getByRole('heading', { name: 'Aún no hay features' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Features' })).toHaveCount(0);
});
