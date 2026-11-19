import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { login, rename, saveStatus } from './helpers';

/**
 * Walkie Live, tarea 9 (docs/features/walkie-live/spec.md): crear módulos y features con su lienzo inicial desde un
 * análisis real (CLI, API, Keycloak y Postgres reales). Un monorepo ficticio con dos apps React que comparten
 * /pedidos, un backend con un módulo de pedidos y dos backends que publican la misma API. Recorre, en orden:
 * - vincular una API a un elemento que ya estaba en el catálogo;
 * - crear el módulo con sus interfaces (y en la misma solicitud la API que faltaba);
 * - crear la feature de una app con sus pantallas, su navegación y sus llamadas por la interfaz del módulo, sin la
 *   conexión ambigua, con una interrupción de red al confirmar que se reintenta sin duplicar;
 * - crear el otro candidato «Pedidos» de la otra app;
 * - editar el lienzo a mano y reanalizar sin que nada se sobrescriba.
 * Con `WALKIE_CAPTURES=<carpeta>` guarda capturas de los lienzos generados.
 */
const API = process.env.VITE_API_URL ?? 'http://localhost:5080';

const ROUTES = (extra: boolean) =>
  [
    "import { createBrowserRouter } from 'react-router-dom';",
    "import { Pedidos, Pedido, Ayuda } from './pages';",
    'export const router = createBrowserRouter([',
    "  { path: '/pedidos', element: <Pedidos /> },",
    "  { path: '/pedidos/:id', element: <Pedido /> },",
    ...(extra ? ["  { path: '/ayuda', element: <Ayuda /> },"] : []),
    ']);',
  ].join('\n');

function writeProject(project: string, extraRoute: boolean) {
  const files: Record<string, string> = {
    'src/Ventas.Api/Ventas.Api.csproj':
      '<Project Sdk="Microsoft.NET.Sdk.Web"><ItemGroup><ProjectReference Include="..\\Pedidos\\Pedidos.csproj" /></ItemGroup></Project>',
    'src/Ventas.Api/Program.cs': [
      'var app = WebApplication.CreateBuilder(args).Build();',
      'Pedidos.Endpoints.Map(app);',
      'app.MapGet("/api/salud", () => "ok");',
      'app.Run();',
    ].join('\n'),
    'src/Pedidos/Pedidos.csproj': '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>',
    'src/Pedidos/Endpoints.cs': [
      'namespace Pedidos;',
      'public static class Endpoints',
      '{',
      '    public static void Map(WebApplication app)',
      '    {',
      '        app.MapGet("/api/pedidos", () => 1);',
      '        app.MapGet("/api/pedidos/{id}", (int id) => 1);',
      '    }',
      '}',
    ].join('\n'),
    'src/Compras.Api/Compras.Api.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>',
    'src/Compras.Api/Program.cs': ['var app = WebApplication.CreateBuilder(args).Build();', 'app.MapGet("/api/salud", () => "ok");', 'app.Run();'].join('\n'),
    'tienda/package.json': JSON.stringify({ name: 'tienda-web', dependencies: { react: '^19.0.0', 'react-router-dom': '^7.0.0' } }),
    'tienda/src/main.tsx': ROUTES(extraRoute),
    'tienda/src/pages.tsx': [
      "import { Link } from 'react-router-dom';",
      'export function Pedidos() {',
      "  fetch('/api/pedidos');",
      "  fetch('/api/salud');",
      '  return <Link to="/pedidos/1">ver</Link>;',
      '}',
      'export function Pedido({ id }: { id: string }) {',
      '  fetch(`/api/pedidos/${id}`);',
      '  return <Link to="/pedidos">volver</Link>;',
      '}',
      'export const Ayuda = () => null;',
    ].join('\n'),
    'admin/package.json': JSON.stringify({ name: 'admin-web', dependencies: { react: '^19.0.0', 'react-router-dom': '^7.0.0' } }),
    'admin/src/main.tsx': ROUTES(false),
    'admin/src/pages.tsx': "export function Pedidos() { fetch('/api/pedidos'); return null; }\nexport const Pedido = () => null;\nexport const Ayuda = () => null;\n",
  };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(project, path)), { recursive: true });
    writeFileSync(join(project, path), content);
  }
}

/** Analiza el proyecto con la CLI real. La primera vez escribe `.walkie/source.json`: la segunda es la misma fuente. */
function scan(project: string, name: string): string {
  const pack = join(dirname(project), `${name}.walkiepack`);
  execFileSync('dotnet', ['run', '--project', '../cli/src/Walkie.Cli', '--', 'scan', project, '-o', pack], { stdio: 'pipe' });
  return pack;
}

async function capture(page: Page, name: string) {
  const dir = process.env.WALKIE_CAPTURES;
  if (dir) await page.screenshot({ path: join(dir, `walkie-live-${name}.png`) });
}

async function importPack(page: Page, appUrl: string, pack: string) {
  await page.goto(appUrl);
  await page.getByRole('button', { name: 'Importar proyecto local' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Importar proyecto local' });
  await dialog.getByLabel('Archivo .walkiepack').setInputFiles(pack);
  await expect(dialog.getByLabel('Resumen del análisis')).toContainText('walkie-cli');
  await dialog.getByRole('button', { name: 'Guardar análisis' }).click();
  await expect(page.getByRole('heading', { name: 'Revisión del análisis' })).toBeVisible();
}

/** Abre el lienzo y mide cuánto tarda en dibujar sus cajas y cuántas tareas largas tiene «Ver todo». */
async function openCanvas(page: Page, link: string, boxes: number) {
  const started = Date.now();
  await page.getByRole('link', { name: link }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(boxes, { timeout: 15_000 });
  const openMs = Date.now() - started;
  await expect(saveStatus(page)).toHaveAttribute('data-state', 'idle'); // «Al día»: abrirlo no lo ensucia
  // «Ver todo» (tecla 0) con teclado real, midiendo cada cuadro y las tareas largas mientras la cámara se mueve.
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __long: number[]; __stop: boolean };
    w.__frames = [];
    w.__long = [];
    w.__stop = false;
    new PerformanceObserver((list) => list.getEntries().forEach((e) => w.__long.push(e.duration))).observe({ type: 'longtask' });
    let last = performance.now();
    const tick = (t: number) => {
      w.__frames.push(t - last);
      last = t;
      if (!w.__stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const before = await page.locator('.react-flow__viewport').getAttribute('style');
  await page.keyboard.press('0');
  await page.waitForTimeout(1200);
  const { frames, longTasks } = await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __long: number[]; __stop: boolean };
    w.__stop = true;
    return { frames: w.__frames.slice(1), longTasks: w.__long };
  });
  const after = await page.locator('.react-flow__viewport').getAttribute('style');
  const worst = Math.round(Math.max(0, ...frames));
  console.log(
    `[perf] ${link}: ${boxes} cajas dibujadas en ${openMs} ms; «Ver todo» ${before === after ? 'sin mover (ya encuadrado)' : 'movió la vista'}: ` +
      `${frames.length} cuadros, peor ${worst} ms, ${longTasks.length} tareas largas`,
  );
  expect(worst).toBeLessThan(200);
  expect(openMs).toBeLessThan(5_000);
  return openMs;
}

/** Las cajas del lienzo no se tocan entre sí (lo que ve la persona, ya medido). */
async function expectNoOverlaps(page: Page) {
  const rects = await page.locator('.react-flow__node').evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().toJSON() as DOMRect));
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const [a, b] = [rects[i]!, rects[j]!];
      const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      expect(overlap, `cajas ${i} y ${j} encimadas`).toBe(false);
    }
  }
}

test('crear un módulo y dos features «Pedidos» de un monorepo, editarlas y reanalizar sin perder nada', async ({ page }) => {
  test.setTimeout(360_000);
  const root = mkdtempSync(join(tmpdir(), 'walkie-live-lienzos-'));
  const project = join(root, 'monorepo');
  writeProject(project, false);
  const pack = scan(project, 'primero');

  await login(page);
  const app = `E2E Walkie Live lienzos ${Date.now()}`;
  await page.getByLabel('Nueva app').fill(app);
  await page.getByRole('button', { name: 'Crear app' }).click();
  await page.getByRole('link', { name: app }).click();
  const appUrl = page.url();
  const appId = /apps\/([^/?#]+)/.exec(appUrl)![1]!;

  // Un elemento que ya estaba en el catálogo, escrito por una persona.
  const existing = await page.evaluate(
    async ({ api, appId }) => {
      const key = Object.keys(sessionStorage).find((k) => k.startsWith('oidc.user:'))!;
      const token = (JSON.parse(sessionStorage.getItem(key)!) as { access_token: string }).access_token;
      const res = await fetch(`${api}/api/apps/${appId}/catalog`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'api', title: 'Lista de pedidos', http: { method: 'GET', path: '/api/pedidos' } }),
      });
      return ((await res.json()) as { id: string }).id;
    },
    { api: API, appId },
  );
  expect(existing).toBeTruthy();

  await importPack(page, appUrl, pack);
  const reviewUrl = page.url();
  const list = page.getByRole('list', { name: 'Hallazgos' });
  const inspector = page.getByRole('complementary', { name: 'Detalle del hallazgo' });

  // Monorepo: /pedidos de cada app es su propia pantalla, y hay dos candidatos «Pedidos».
  await expect(list.getByRole('button', { name: /screen:tienda:\/pedidos$/ })).toBeVisible();
  await expect(list.getByRole('button', { name: /screen:admin:\/pedidos$/ })).toBeVisible();
  await expect(list.getByRole('button', { name: /feature:tienda:Pedidos/ })).toBeVisible();
  await expect(list.getByRole('button', { name: /feature:admin:Pedidos/ })).toBeVisible();

  // La lista de pedidos coincide por firma con lo que ya estaba: se vincula, sin crear otra.
  await list.getByRole('button', { name: /api:GET \/api\/pedidos$/ }).click();
  await inspector.getByRole('button', { name: 'Vincular…' }).click();
  await inspector.getByRole('button', { name: 'Confirmar' }).click();
  await expect(inspector.getByRole('status')).toContainText('Vinculado a «Lista de pedidos»');

  // El módulo: sus APIs (la que faltaba se crea en la misma solicitud) y las interfaces que ofrece.
  await list.getByRole('button', { name: /module:/ }).click();
  await inspector.getByRole('button', { name: 'Crear módulo…' }).click();
  let preview = inspector.getByRole('region', { name: 'Lo que se creará' });
  await expect(preview.getByRole('list', { name: 'Lo que no entra' })).toContainText('Sin decidir');
  await preview.getByRole('checkbox', { name: /Crear también en el catálogo las APIs que faltan/ }).check();
  await expect(preview).toContainText('Interfaces');
  await expect(preview).toContainText('(ofrece Lista de pedidos)');
  await expect(preview.getByRole('list', { name: 'Avisos' })).toContainText('no todo proyecto es un módulo reutilizable');
  await capture(page, 'modulo-vista-previa');
  await inspector.getByRole('button', { name: 'Confirmar y crear' }).click();
  await expect(inspector.getByRole('status')).toContainText('Módulo creado');
  await openCanvas(page, 'Abrir el módulo', 2);
  await expectNoOverlaps(page);
  await expect(page.getByRole('region', { name: 'Módulo compartido' }).getByRole('button', { name: 'De dónde viene' })).toBeVisible();
  await capture(page, 'modulo-lienzo');

  // La feature de la tienda: pantallas, navegación y llamadas por la interfaz del módulo; la llamada ambigua no.
  await page.goto(reviewUrl);
  await list.getByRole('button', { name: /feature:tienda:Pedidos/ }).click();
  await inspector.getByRole('button', { name: 'Crear feature…' }).click();
  preview = inspector.getByRole('region', { name: 'Lo que se creará' });
  await expect(preview).toContainText('Pedidos (/pedidos)');
  await expect(preview).toContainText('(módulo)');
  await expect(preview).toContainText('2 de navegación y 2 solicitudes HTTP');
  await expect(preview.getByRole('list', { name: 'Lo que no entra' })).toContainText('Ambigua');
  await expect(preview.getByRole('list', { name: 'Avisos' })).toContainText('Compras.Api');
  await capture(page, 'feature-vista-previa');

  // Interrupción: la API crea, pero la respuesta no llega. Reintentar con el mismo applyId no duplica nada.
  let interrupted = false;
  await page.route('**/api/snapshots/*/apply', async (route) => {
    if (interrupted || route.request().url().includes('dryRun')) return route.fallback();
    interrupted = true;
    await route.fetch(); // la solicitud llega y se aplica…
    await route.abort('connectionreset'); // …pero el navegador no ve la respuesta
  });
  await inspector.getByRole('button', { name: 'Confirmar y crear' }).click();
  await expect(inspector.getByRole('alert')).toContainText('no se aplicará dos veces');
  await page.unroute('**/api/snapshots/*/apply');
  await inspector.getByRole('button', { name: 'Confirmar y crear' }).click();
  await expect(inspector.getByRole('status')).toContainText('Feature creada: «Pedidos»');

  await openCanvas(page, 'Abrir la feature', 3); // dos pantallas y la caja del módulo
  await expectNoOverlaps(page);
  await expect(page.locator('.kind-edge-label', { hasText: 'navega' })).toHaveCount(2);
  await expect(page.getByRole('region', { name: 'Origen de la feature' })).toBeVisible();
  await capture(page, 'feature-lienzo');

  // Edición manual posterior: es un lienzo como cualquier otro.
  await rename(page, 0, 'Pedidos editada a mano');
  await page.keyboard.press('Control+s');
  await expect(saveStatus(page)).toHaveText(/Guardado/);

  // El otro «Pedidos», de la otra app: otra feature, con su app en el nombre.
  await page.goto(reviewUrl);
  await list.getByRole('button', { name: /feature:admin:Pedidos/ }).click();
  await inspector.getByRole('button', { name: 'Crear feature…' }).click();
  await expect(inspector.getByLabel('Nombre')).toHaveValue('Pedidos (admin)');
  await inspector.getByRole('button', { name: 'Confirmar y crear' }).click();
  await expect(inspector.getByRole('status')).toContainText('Feature creada: «Pedidos (admin)»');
  await openCanvas(page, 'Abrir la feature', 3);
  await expectNoOverlaps(page);
  await capture(page, 'feature-admin-lienzo');

  // Reanalizar (cambió el código): nada se sobrescribe ni se vuelve a crear.
  writeProject(project, true);
  await importPack(page, appUrl, scan(project, 'segundo'));
  await expect(list.getByRole('button', { name: /feature:tienda:Pedidos/ })).toContainText(/Creado|Cambió/);
  await expect(list.getByRole('button', { name: /screen:tienda:\/ayuda/ })).toContainText('Nuevo');
  await page.goto(appUrl);
  const features = page.getByRole('list', { name: 'Features' });
  await expect(features.getByRole('link', { name: 'Pedidos', exact: true })).toHaveCount(1);
  await features.getByRole('link', { name: 'Pedidos', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await expect(page.locator('.react-flow__node', { hasText: 'Pedidos editada a mano' })).toBeVisible();
  await capture(page, 'feature-despues-de-reanalizar');
});
