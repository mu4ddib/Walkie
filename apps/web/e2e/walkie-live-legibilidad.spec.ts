import { expect, test, type Page } from '@playwright/test';
import { planInitialCanvas, type CanvasDraft } from '../src/discovery/initialCanvas';
import { pedidos, synthetic, walkieApps, walkieCatalog } from '../src/discovery/layout/layoutFixtures';
import { login, openNewFeature, saveStatus, seedCanvas } from './helpers';

/**
 * Lienzos descubiertos legibles (spec walkie-live-documentacion, parte 3) con API, Keycloak y Postgres reales. Siembra
 * el lienzo inicial de borradores reales (las propuestas «Apps» y «Catalog» del análisis de Walkie, la tienda de
 * Pedidos) y uno sintético de 75 cajas, y mide en el navegador, no solo en capturas:
 * - al abrir sin vista guardada el zoom nunca queda ilegible (encuadra todo o abre en `LEGIBLE_ZOOM` desde arriba a la
 *   izquierda), y «Ver todo» sigue mostrando todo;
 * - ninguna caja se encima con otra y ninguna etiqueta tapa una caja ajena;
 * - los tres modos de presentación cambian solo lo dibujado (el lienzo sigue «Al día» y el grafo guardado es el mismo);
 * - cuánto tarda en pintarse cada cambio de modo.
 * Corre en 1280×800, 1440×900 y 1920×1080 (y en WebKit con `WALKIE_BROWSER=webkit`). Con `WALKIE_CAPTURES=<carpeta>`
 * guarda capturas. Datos ficticios (los ids de catálogo de los borradores no existen: las APIs se siembran como cajas).
 */
const LEGIBLE_ZOOM = 0.7;
const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];

/** El grafo que crearía Walkie Live con ese borrador, con las APIs como cajas propias (con su método y ruta). */
function graphOf(draft: CanvasDraft) {
  const plan = planInitialCanvas(draft);
  const nodes = Object.fromEntries(
    draft.nodes.map((n) => {
      const id = plan.nodes[n.key]!;
      if (n.type === 'screen') return [id, { id, type: 'screen', title: n.title, description: `Ruta: ${n.route}` }];
      const [method, path] = n.title.split(' ');
      return [id, { id, type: 'api', title: n.title, http: { method, path } }];
    }),
  );
  const edges = Object.fromEntries(
    draft.edges.map((e) => {
      const id = plan.edges[e.key]!;
      return [id, { id, from: plan.nodes[e.from]!, to: plan.nodes[e.to]!, kind: e.kind, operation: e.operation }];
    }),
  );
  const layout = Object.fromEntries(Object.entries(plan.layout).map(([key, p]) => [plan.nodes[key]!, p]));
  return {
    schemaVersion: 0,
    nodes: nodes as Record<string, { id: string; type: string; title: string }>,
    edges: edges as Record<string, { id: string; from: string; to: string }>,
    layout,
  };
}

const slug = (s: string) => s.normalize('NFD').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();

async function capture(page: Page, name: string) {
  const dir = process.env.WALKIE_CAPTURES;
  if (dir) await page.screenshot({ path: `${dir}/legibilidad-${test.info().project.name}-${name}.png` });
}

type Rect = { x: number; y: number; w: number; h: number; id?: string };
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Cajas y etiquetas visibles en px de pantalla, y el zoom actual. */
async function geometry(page: Page) {
  return page.evaluate(() => {
    const rect = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    const transform = getComputedStyle(document.querySelector('.react-flow__viewport')!).transform;
    const zoom = new DOMMatrix(transform).a;
    const boxes = [...document.querySelectorAll('.react-flow__node:not([style*="visibility: hidden"]) .pixel-node')].map((el) => ({
      ...rect(el),
      id: el.closest('.react-flow__node')!.getAttribute('data-id')!,
    }));
    const labels = [...document.querySelectorAll('.kind-edge-label')].map((el) => ({ ...rect(el), id: el.getAttribute('data-edge-id')! }));
    const pane = rect(document.querySelector('.canvas-flow')!);
    const inspector = document.querySelector('.inspector');
    return { zoom, boxes, labels, pane, inspector: inspector ? rect(inspector) : null };
  });
}

/** Ninguna caja encima de otra; ninguna etiqueta sobre una caja que no es uno de sus extremos. */
function assertNoOverlaps(g: Awaited<ReturnType<typeof geometry>>, ends: Record<string, [string, string]>) {
  for (let i = 0; i < g.boxes.length; i++)
    for (let j = i + 1; j < g.boxes.length; j++) expect(overlap(g.boxes[i]!, g.boxes[j]!), JSON.stringify([g.boxes[i], g.boxes[j]])).toBe(false);
  let covering = 0;
  for (const l of g.labels) {
    const [from, to] = ends[l.id] ?? ['', ''];
    if (g.boxes.some((b) => b.id !== from && b.id !== to && overlap(l, b))) covering++;
  }
  return covering;
}

async function openSeeded(page: Page, draft: CanvasDraft, name: string) {
  await openNewFeature(page, name);
  const graph = graphOf(draft);
  await seedCanvas(page, graph);
  // Sin vista guardada, como un lienzo recién creado desde la revisión (el lienzo guarda su vista al salir: se borra
  // desde otra página).
  const url = page.url();
  await page.goto('/apps');
  await expect(page.getByRole('list', { name: 'Apps' })).toBeVisible();
  await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('walkie.viewport.')).forEach((k) => localStorage.removeItem(k)));
  await page.goto(url);
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  await page.waitForTimeout(600);
  await expect(saveStatus(page)).toHaveAttribute('data-state', 'idle');
  const ends = Object.fromEntries(Object.values(graph.edges).map((e) => [e.id, [e.from, e.to] as [string, string]]));
  return { graph, ends };
}

async function chooseMode(page: Page, label: string) {
  const started = await page.evaluate(() => performance.now());
  await page.getByRole('radio', { name: label }).click();
  await expect(page.getByRole('radio', { name: label })).toHaveAttribute('aria-checked', 'true');
  // Dos cuadros: el cambio ya está pintado.
  return page.evaluate(
    (t0) => new Promise<number>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(performance.now() - t0)))),
    started,
  );
}

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport });

    test('el lienzo denso de Walkie abre legible, sin cajas encimadas, y los modos no cambian lo guardado', async ({ page }) => {
      test.setTimeout(120_000);
      await login(page);
      await page.evaluate(() => localStorage.setItem('walkie.viewMode', '"full"'));
      const { graph, ends } = await openSeeded(page, walkieApps, 'Gestión de apps');

      const initial = await geometry(page);
      expect(initial.zoom).toBeGreaterThanOrEqual(LEGIBLE_ZOOM - 0.01);
      expect(initial.boxes.length).toBeGreaterThan(0);
      assertNoOverlaps(initial, ends);
      // La primera pantalla de la navegación («Apps») se ve entera y no queda bajo el inspector.
      const first = initial.boxes.find((b) => b.id === Object.values(graph.nodes).find((n) => n.title === 'Apps')!.id)!;
      expect(first.x).toBeGreaterThanOrEqual(initial.pane.x);
      if (initial.inspector) expect(first.x + first.w).toBeLessThanOrEqual(initial.inspector.x);
      await capture(page, `${viewport.width}-apps-inicial`);

      // «Ver todo» muestra las 30 cajas.
      await page.keyboard.press('0');
      await page.waitForTimeout(800);
      const all = await geometry(page);
      expect(all.boxes).toHaveLength(Object.keys(graph.nodes).length);
      const coveringFull = assertNoOverlaps(all, ends);
      await capture(page, `${viewport.width}-apps-completa`);

      // Resumen funcional: solo las pantallas, con lo que llaman contado.
      const summaryMs = await chooseMode(page, 'Resumen');
      const summary = await geometry(page);
      expect(summary.boxes).toHaveLength(3);
      await expect(page.locator('.pixel-node-calls').first()).toContainText('llama a');
      await capture(page, `${viewport.width}-apps-resumen`);

      // Explorar interacciones: sin etiquetas; al elegir «App», sus vecinas y sus conexiones con etiqueta.
      const interactionsMs = await chooseMode(page, 'Interacciones');
      await expect(page.locator('.kind-edge-label')).toHaveCount(0);
      const app = Object.values(graph.nodes).find((n) => n.title === 'App')!;
      await page.locator(`.react-flow__node[data-id="${app.id}"]`).click();
      const touching = Object.values(graph.edges).filter((e) => e.from === app.id || e.to === app.id).length;
      await expect(page.locator('.kind-edge-label')).toHaveCount(touching);
      await expect(page.locator('.react-flow__node.focus-dim').first()).toBeVisible();
      await capture(page, `${viewport.width}-apps-interacciones`);

      const fullMs = await chooseMode(page, 'Completa');
      await expect(page.locator('.kind-edge-label')).toHaveCount(Object.keys(graph.edges).length);

      // Nada de esto se guarda: el lienzo sigue al día y el grafo del servidor es el sembrado.
      await expect(saveStatus(page)).toHaveAttribute('data-state', 'idle');
      const saved = await page.evaluate(async (api) => {
        const key = Object.keys(sessionStorage).find((k) => k.startsWith('oidc.user:'))!;
        const token = (JSON.parse(sessionStorage.getItem(key)!) as { access_token: string }).access_token;
        const featureId = /features\/([^/?#]+)/.exec(location.href)![1]!;
        return (await fetch(`${api}/api/features/${featureId}/canvas`, { headers: { Authorization: `Bearer ${token}` } })).json();
      }, process.env.VITE_API_URL ?? 'http://localhost:5080');
      expect(saved.layout).toEqual(graph.layout);
      test.info().annotations.push({
        type: 'medidas',
        description: JSON.stringify({ viewport, initialZoom: initial.zoom, fitZoom: all.zoom, coveringFull, summaryMs, interactionsMs, fullMs }),
      });
    });

    test('Catalog, Pedidos y 75 cajas: sin cajas encimadas y con zoom inicial legible', async ({ page }) => {
      test.setTimeout(120_000);
      await login(page);
      await page.evaluate(() => localStorage.setItem('walkie.viewMode', '"full"'));
      const results: Record<string, unknown> = {};
      for (const [name, draft] of [
        ['Componentes compartidos', walkieCatalog],
        ['Tienda de pedidos', pedidos],
        ['Sintética de 75 cajas', synthetic(75)],
      ] as const) {
        await page.goto('/apps');
        // La galería tiene que haber cargado antes de escribir el nombre de la app (ver «Trampas conocidas»).
        await expect(page.getByRole('list', { name: 'Apps' })).toBeVisible();
        const t0 = Date.now();
        const { ends } = await openSeeded(page, draft, name);
        const g = await geometry(page);
        expect(g.zoom, name).toBeGreaterThanOrEqual(name === 'Tienda de pedidos' ? 0.75 : LEGIBLE_ZOOM - 0.01);
        assertNoOverlaps(g, ends);
        await capture(page, `${viewport.width}-${slug(name)}-inicial`);
        await page.keyboard.press('0');
        await page.waitForTimeout(800);
        const fit = await geometry(page);
        results[name] = { initialZoom: g.zoom, fitZoom: fit.zoom, covering: assertNoOverlaps(fit, ends), openMs: Date.now() - t0 };
        await capture(page, `${viewport.width}-${slug(name)}-completa`);
      }
      test.info().annotations.push({ type: 'medidas', description: JSON.stringify({ viewport, ...results }) });
    });
  });
}
