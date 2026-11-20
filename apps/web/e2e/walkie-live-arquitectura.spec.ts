import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { login, visibleGraph } from './helpers';

/**
 * Caso F (spec walkie-live-arquitectura): una tienda ficticia React + .NET, con un cliente HTTP envoltorio, servicios y
 * EF Core, analizada con la CLI real. Importar → «Explorar arquitectura» (sin decidir nada) → abrir el grupo del front →
 * la evidencia de una relación inferida → revisar la propuesta «Pedidos» como conjunto (una API coincide con algo hecho
 * a mano y se vincula; las demás se crean) → una sola aplicación → abrir el lienzo. Sin duplicados en el catálogo y sin
 * tocar el lienzo que ya existía. Sin datos reales.
 */
const API = process.env.VITE_API_URL ?? 'http://localhost:5080';

const FILES: Record<string, string> = {
  'Directory.Build.props': '<Project><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>',
  'api/Tienda.Api/Tienda.Api.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>',
  'api/Tienda.Api/Program.cs': [
    'var builder = WebApplication.CreateBuilder(args);',
    'builder.Services.AddDbContext<TiendaDbContext>(o => o.UseNpgsql("Host=db"));',
    'var app = builder.Build();',
    'var pedidos = app.MapGroup("/api/pedidos");',
    'pedidos.MapGet("/", (PedidosService s) => s.Listar());',
    'pedidos.MapGet("/{id:guid}", (Guid id, PedidosService s) => s.Obtener(id));',
    'pedidos.MapPut("/{id:guid}", (Guid id, PedidosService s) => s.Editar(id));',
    'var clientes = app.MapGroup("/api/clientes");',
    'clientes.MapGet("/", (ClientesService s) => s.Listar());',
    'clientes.MapPost("/", (ClientesService s) => s.Crear());',
    'app.Run();',
    'public sealed class PedidosService(TiendaDbContext db)',
    '{',
    '    public object Listar() => db.Pedidos.AsNoTracking().ToList();',
    '    public object Obtener(Guid id) => db.Pedidos.Single(p => p.Id == id);',
    '    public object Editar(Guid id) { var p = db.Pedidos.Single(x => x.Id == id); db.SaveChanges(); return p; }',
    '}',
    'public sealed class ClientesService(TiendaDbContext db)',
    '{',
    '    public object Listar() => db.Clientes.ToList();',
    '    public object Crear() { db.Clientes.Add(new Cliente()); db.SaveChanges(); return 1; }',
    '}',
    'public sealed class TiendaDbContext(DbContextOptions<TiendaDbContext> o) : DbContext(o)',
    '{',
    '    public DbSet<Pedido> Pedidos { get; set; } = null!;',
    '    public DbSet<Cliente> Clientes { get; set; } = null!;',
    '}',
  ].join('\n'),
  'web/package.json': '{ "name": "tienda-web", "dependencies": { "react": "19.0.0", "react-router-dom": "7.0.0" } }',
  // Un envoltorio de un nivel: el método llega como argumento y la base desde una constante.
  'web/src/http.ts': [
    "const BASE = '/api';",
    'export function request(method: string, path: string) {',
    '  return fetch(`${BASE}${path}`, { method });',
    '}',
  ].join('\n'),
  'web/src/servicios.ts': [
    "import { request } from './http';",
    "export const listarPedidos = () => request('GET', '/pedidos');",
    'export const obtenerPedido = (id: string) => request(\'GET\', `/pedidos/${id}`);',
    'export const editarPedido = (id: string) => request(\'PUT\', `/pedidos/${id}`);',
    "export const listarClientes = () => request('GET', '/clientes');",
    "export const crearCliente = () => request('POST', '/clientes');",
    'export const pedidoPath = (id: string) => `/pedidos/${id}`;',
  ].join('\n'),
  'web/src/rutas.tsx': [
    "import { createBrowserRouter } from 'react-router-dom';",
    "import { PedidosPage, PedidoPage, EditarPedidoPage, ClientesPage } from './paginas';",
    'export const router = createBrowserRouter([',
    "  { path: '/pedidos', element: <PedidosPage /> },",
    "  { path: '/pedidos/:id', element: <PedidoPage /> },",
    "  { path: '/pedidos/:id/editar', element: <EditarPedidoPage /> },",
    "  { path: '/clientes', element: <ClientesPage /> },",
    ']);',
  ].join('\n'),
  'web/src/paginas.tsx': [
    "import { Link, useNavigate } from 'react-router-dom';",
    "import { listarPedidos, obtenerPedido, editarPedido, listarClientes, crearCliente, pedidoPath } from './servicios';",
    "export function PedidosPage() { listarPedidos(); return <Link to={pedidoPath('1')}>Ver</Link>; }",
    'export function PedidoPage({ id }: { id: string }) { obtenerPedido(id); return <Link to={`/pedidos/${id}/editar`}>Editar</Link>; }',
    'export function EditarPedidoPage({ id }: { id: string }) { const navigate = useNavigate(); obtenerPedido(id); return <form onSubmit={() => editarPedido(id).then(() => navigate(pedidoPath(id)))} />; }',
    'export function ClientesPage() { listarClientes(); return <button onClick={() => crearCliente()}>Nuevo</button>; }',
  ].join('\n'),
};

function scan(): string {
  const root = mkdtempSync(join(tmpdir(), 'walkie-arquitectura-'));
  const dir = join(root, 'tienda');
  for (const [path, content] of Object.entries(FILES)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  const pack = join(root, 'tienda.walkiepack');
  execFileSync('dotnet', ['run', '--project', '../cli/src/Walkie.Cli', '--', 'scan', dir, '-o', pack, '--source-id', randomUUID()], { stdio: 'pipe' });
  return pack;
}

async function capture(page: Page, name: string) {
  const dir = process.env.WALKIE_CAPTURES;
  if (dir) await page.screenshot({ path: join(dir, `arquitectura-${name}.png`), fullPage: true });
}

/** Una llamada a la API con el token de la sesión. */
async function api<T>(page: Page, path: string, init?: { method: string; body: unknown }): Promise<{ status: number; body: T }> {
  return page.evaluate(
    async ({ base, path, init }) => {
      const key = Object.keys(sessionStorage).find((k) => k.startsWith('oidc.user:'))!;
      const token = (JSON.parse(sessionStorage.getItem(key)!) as { access_token: string }).access_token;
      const res = await fetch(`${base}${path}`, {
        method: init?.method ?? 'GET',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(init ? { body: JSON.stringify(init.body) } : {}),
      });
      return { status: res.status, body: res.status === 204 ? null : await res.json() };
    },
    { base: API, path, init },
  ) as Promise<{ status: number; body: T }>;
}

test('explorar la arquitectura descubierta e incorporar una propuesta como conjunto', async ({ page }) => {
  test.setTimeout(300_000);
  const pack = scan();

  await login(page);
  const app = `E2E Arquitectura ${Date.now()}`;
  // La galería termina de cargar antes de escribir (si se vuelve a dibujar después, el campo queda vacío).
  await expect(page.getByRole('list', { name: 'Apps' })).toBeVisible();
  await page.getByLabel('Nueva app').fill(app);
  await expect(page.getByLabel('Nueva app')).toHaveValue(app);
  await page.getByRole('button', { name: 'Crear app', exact: true }).click();
  await page.getByRole('link', { name: app }).click();
  const appId = /apps\/([^/?#]+)/.exec(page.url())![1]!;

  // Lo que ya existía: una API hecha a mano (misma firma que una descubierta) y una feature con su lienzo.
  const manual = await api<{ id: string }>(page, `/api/apps/${appId}/catalog`, {
    method: 'POST',
    body: { type: 'api', title: 'Pedidos (a mano)', http: { method: 'GET', path: '/api/pedidos' } },
  });
  expect(manual.status).toBe(201);
  // Y otra que se llama igual que una descubierta (PUT /api/pedidos/{id}) con otro contrato: coincide solo por título.
  const twin = await api<{ id: string }>(page, `/api/apps/${appId}/catalog`, {
    method: 'POST',
    body: { type: 'api', title: 'PUT /api/pedidos/{id}', http: { method: 'POST', path: '/api/notas' } },
  });
  expect(twin.status).toBe(201);
  const existing = await api<{ id: string }>(page, `/api/apps/${appId}/features`, { method: 'POST', body: { name: 'Hecha a mano' } });
  expect(existing.status).toBe(201);
  const before = await api<{ version: number }>(page, `/api/features/${existing.body.id}/canvas`);

  await page.reload();
  await page.getByRole('button', { name: 'Importar proyecto local' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Importar proyecto local' });
  await dialog.getByLabel('Archivo .walkiepack').setInputFiles(pack);
  await dialog.getByRole('button', { name: 'Guardar análisis' }).click();
  await expect(page.getByRole('heading', { name: 'Revisión del análisis' })).toBeVisible();

  // Explorar: grupos y vínculos agregados, sin decisiones ni escrituras.
  const catalogBefore = await api<unknown[]>(page, `/api/apps/${appId}/catalog`);
  await page.getByRole('link', { name: 'Explorar arquitectura' }).click();
  await expect(page.getByRole('heading', { name: 'Arquitectura descubierta' })).toBeVisible();
  await expect(page.getByRole('note').filter({ hasText: 'Descubierta, no confirmada' })).toBeVisible();
  const canvas = page.getByRole('region', { name: 'Vista general de la arquitectura' });
  await expect(canvas.locator('.arch-group')).not.toHaveCount(0);
  const groupCount = await canvas.locator('.arch-group').count();
  expect(groupCount).toBeLessThan(12); // agrupado: nunca una caja por hallazgo
  await expect(canvas.locator('.arch-edge').first()).toBeVisible();
  const side = page.getByRole('complementary', { name: 'Grupos y propuestas' });
  await expect(side.getByText('Pedidos', { exact: true })).toBeVisible();
  await capture(page, 'vista-general-1280');
  await page.setViewportSize({ width: 1440, height: 900 });
  await capture(page, 'vista-general-1440');
  await page.setViewportSize({ width: 1280, height: 800 });
  // Más ancho para el grafo: los paneles se pliegan y la vista no salta (el zoom y el encuadre siguen).
  const viewport = canvas.locator('.react-flow__viewport');
  const transform = await viewport.getAttribute('style');
  await page.getByRole('button', { name: 'Ocultar grupos' }).click();
  await page.getByRole('button', { name: 'Ocultar detalle' }).click();
  await expect(side).toBeHidden();
  expect(await viewport.getAttribute('style')).toBe(transform);
  await capture(page, 'vista-general-paneles-plegados');
  await page.getByRole('button', { name: 'Mostrar grupos' }).click();
  await page.getByRole('button', { name: 'Mostrar detalle' }).click();

  // Filtros: sin ejecución se van las llamadas; vuelven al marcarla.
  const edges = await canvas.locator('.arch-edge').count();
  await page.getByRole('checkbox', { name: 'Ejecución' }).uncheck();
  await expect.poll(() => canvas.locator('.arch-edge').count()).toBeLessThan(edges);
  await page.getByRole('checkbox', { name: 'Ejecución' }).check();
  await expect(canvas.locator('.arch-edge')).toHaveCount(edges);

  // El grupo del front: sus pantallas y, para una, la cadena que explica una llamada inferida.
  await side.getByRole('button', { name: /^Abrir tienda-web/ }).click();
  const detail = page.getByRole('region', { name: /^Detalle de / });
  await expect(detail.locator('.arch-entity')).not.toHaveCount(0);
  await capture(page, 'grupo-front-1280');
  await detail.locator('.arch-entity.is-screen').filter({ has: page.locator('.arch-node-route', { hasText: /^\/pedidos$/ }) }).click();
  const inspector = page.getByRole('complementary', { name: 'Detalle de la arquitectura' });
  await expect(inspector.getByRole('heading', { name: 'Evidencia' })).toBeVisible();
  await inspector.getByRole('button', { name: /llama a GET \/api\/pedidos$/ }).click();
  await expect(inspector).toContainText(/Inferida · confianza media|Observada/);
  await expect(inspector.getByRole('heading', { name: /^Por qué \(\d+ pasos?\)/ })).toBeVisible();
  // En el orden en que ocurre: la pantalla, el servicio que arma la ruta y el envoltorio con fetch.
  await expect(inspector).toContainText('de quien llama a la API');
  const steps = inspector.locator('.arch-evidence li code');
  await expect(steps.first()).toContainText('web/src/paginas.tsx');
  await expect(steps.nth(1)).toContainText('web/src/servicios.ts');
  await expect(steps.last()).toContainText('web/src/http.ts');
  await capture(page, 'evidencia-relacion');

  // Nada cambió por explorar.
  expect((await api<unknown[]>(page, `/api/apps/${appId}/catalog`)).body).toHaveLength(catalogBefore.body.length);

  // Revisar «Pedidos» como conjunto: la lista coincide con la hecha a mano y se propone vincularla (no copiarla).
  await side.getByRole('button', { name: '← Vista general' }).click();
  const proposal = side.getByRole('listitem').filter({ hasText: 'Pedidos' }).filter({ has: page.getByRole('button', { name: 'Revisar' }) });
  await proposal.getByRole('button', { name: 'Revisar' }).click();
  const review = page.getByRole('complementary', { name: 'Revisar la propuesta Pedidos' });
  await expect(review.getByRole('heading', { name: /^Pantallas \(3\)/ })).toBeVisible();
  await expect(review.getByRole('radio', { name: 'Vincular a «Pedidos (a mano)»' })).toBeChecked();
  await expect(review.getByText('Clientes')).toHaveCount(0); // otra familia de rutas: no entra
  // La del mismo nombre y otro contrato no se vincula sola: sin elegir, no hay vista previa.
  const sameName = review.getByRole('group', { name: 'Qué hacer con PUT /api/pedidos/{id}' });
  await expect(sameName).toContainText('Coincide solo por el nombre');
  await expect(sameName.getByRole('radio', { name: 'Vincular a «PUT /api/pedidos/{id}»' })).not.toBeChecked();
  await expect(review.getByRole('button', { name: 'Ver qué se creará' })).toBeDisabled();
  await sameName.scrollIntoViewIfNeeded();
  await capture(page, 'revision-eleccion-por-titulo');
  await sameName.getByRole('radio', { name: 'Crear en el catálogo' }).check();
  await review.getByRole('button', { name: 'Ver qué se creará' }).click();
  const preview = review.getByRole('region', { name: 'Lo que se creará' });
  await expect(preview).toContainText(/3 pantallas, 3 APIs, 3 de navegación y 4 solicitudes HTTP/);
  await expect(preview).toContainText('Pedidos (a mano)');
  await expect(preview).toContainText('GET /api/pedidos/{id}, PUT /api/pedidos/{id}'); // solo lo que falta
  await capture(page, 'revision-conjunto');

  const applied = page.waitForResponse((r) => r.url().includes('/apply') && !r.url().includes('dryRun') && r.request().method() === 'POST');
  await review.getByRole('button', { name: 'Confirmar y crear' }).click();
  expect((await applied).status()).toBe(200);
  await expect(review.getByRole('status')).toContainText('Feature creada');

  // Sin duplicados: lo hecho a mano + las APIs nuevas; una sola con GET /api/pedidos.
  const catalog = await api<{ title: string; http?: { method: string; path: string } }[]>(page, `/api/apps/${appId}/catalog`);
  expect(catalog.body.filter((i) => i.http?.method === 'GET' && i.http.path === '/api/pedidos')).toHaveLength(1);
  // La del mismo nombre sigue con su contrato y la descubierta se creó aparte.
  expect(catalog.body.filter((i) => i.title === 'PUT /api/pedidos/{id}').map((i) => `${i.http?.method} ${i.http?.path}`).sort()).toEqual([
    'POST /api/notas',
    'PUT /api/pedidos/{id}',
  ]);
  // El lienzo que ya existía no cambió.
  expect((await api<{ version: number }>(page, `/api/features/${existing.body.id}/canvas`)).body.version).toBe(before.body.version);

  await review.getByRole('link', { name: 'Abrir el lienzo' }).click();
  // 3 pantallas y 3 APIs (la de la lista es la hecha a mano), con la navegación y las llamadas que vio el análisis.
  await expect(page.locator('.react-flow__node')).toHaveCount(6);
  await page.keyboard.press('0');
  await expect.poll(async () => (await visibleGraph(page)).edges.length).toBe(7);
  const graph = await visibleGraph(page);
  expect(graph.nodes.filter((n) => n.includes('|Pedidos (a mano)|'))).toHaveLength(1);
  await capture(page, 'lienzo-generado');
});
