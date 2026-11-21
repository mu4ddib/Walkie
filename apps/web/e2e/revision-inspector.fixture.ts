import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { login } from './helpers';

/** Pantallas del proyecto ficticio: cada una llama a la misma API, así su hallazgo tiene muchas relaciones y evidencias. */
export const SCREENS = 36;

/** La API con evidencia extensa (la llaman todas las pantallas) y su fila en la lista. */
export const BIG_API = /api:GET \/api\/clientes-corporativos\/\{\}\/cuentas-de-ahorro-programado\/\{\}\/movimientos-conciliados/;

/**
 * Un proyecto ficticio (React + .NET, sin datos reales) analizado con la CLI de verdad: rutas largas y anidadas, una API
 * que llaman {@link SCREENS} pantallas (muchas relaciones y evidencias, una por archivo) y muchos hallazgos (la lista
 * es más alta que la ventana).
 */
export function scanBigReview(): string {
  const root = mkdtempSync(join(tmpdir(), 'walkie-inspector-'));
  const project = join(root, 'banca-corporativa');
  const route = '/api/clientes-corporativos/{clienteId:guid}/cuentas-de-ahorro-programado/{cuentaId:guid}/movimientos-conciliados';
  const files: Record<string, string> = {
    'src/Banca.Corporativa.Api/Banca.Corporativa.Api.csproj':
      '<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>',
    'src/Banca.Corporativa.Api/Program.cs': [
      'var app = WebApplication.CreateBuilder(args).Build();',
      `app.MapGet("${route}", (Guid clienteId, Guid cuentaId) => Results.Ok());`,
      'app.MapPost("/api/clientes-corporativos/{clienteId:guid}/solicitudes", (Guid clienteId) => Results.Created());',
      'app.Run();',
    ].join('\n'),
    'web/package.json': JSON.stringify({ name: 'banca-web', dependencies: { react: '^19.0.0', 'react-router-dom': '^7.0.0' } }),
  };
  const imports: string[] = [];
  const routes: string[] = [];
  for (let i = 0; i < SCREENS; i++) {
    const name = `ConciliacionDeMovimientosProgramados${i}`;
    const dir = `web/src/modulos/tesoreria-corporativa/conciliacion-bancaria/cuentas-de-ahorro-programado/pantalla-${i}`;
    files[`${dir}/${name}.tsx`] = [
      `export function ${name}({ clienteId, cuentaId }: { clienteId: string; cuentaId: string }) {`,
      '  fetch(`/api/clientes-corporativos/${clienteId}/cuentas-de-ahorro-programado/${cuentaId}/movimientos-conciliados`);',
      '  return null;',
      '}',
    ].join('\n');
    imports.push(`import { ${name} } from './${dir.slice('web/src/'.length)}/${name}';`);
    routes.push(`  { path: '/tesoreria/conciliacion/${i}/:clienteId/:cuentaId', element: <${name} /> },`);
  }
  files['web/src/main.tsx'] = [
    "import { createBrowserRouter } from 'react-router-dom';",
    ...imports,
    'export const router = createBrowserRouter([',
    ...routes,
    ']);',
  ].join('\n');
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(project, path)), { recursive: true });
    writeFileSync(join(project, path), content);
  }
  const pack = join(root, 'banca.walkiepack');
  execFileSync('dotnet', ['run', '--project', '../cli/src/Walkie.Cli', '--', 'scan', project, '-o', pack, '--no-source-file'], { stdio: 'pipe' });
  return pack;
}

/** Crea una app, importa el paquete y deja abierta su revisión. Devuelve la URL de la revisión. */
export async function openReview(page: Page, pack: string): Promise<string> {
  await login(page);
  const app = `E2E Inspector ${Date.now()}`;
  await expect(page.getByRole('list', { name: 'Apps' })).toBeVisible();
  await page.getByLabel('Nueva app').fill(app);
  await expect(page.getByLabel('Nueva app')).toHaveValue(app);
  await page.getByRole('button', { name: 'Crear app', exact: true }).click();
  await page.getByRole('link', { name: app }).click();
  await page.getByRole('button', { name: 'Importar proyecto local' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Importar proyecto local' });
  await dialog.getByLabel('Archivo .walkiepack').setInputFiles(pack);
  await expect(dialog.getByLabel('Resumen del análisis')).toContainText('banca');
  await dialog.getByRole('button', { name: 'Guardar análisis' }).click();
  await expect(page.getByRole('heading', { name: 'Revisión del análisis' })).toBeVisible();
  return page.url();
}
