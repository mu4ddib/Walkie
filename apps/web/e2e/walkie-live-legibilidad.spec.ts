import { expect, test, type Page } from '@playwright/test';
import { planInitialCanvas, type CanvasDraft } from '../src/discovery/initialCanvas';
import { pedidos, synthetic, walkieApps, walkieCatalog } from '../src/discovery/layout/layoutFixtures';
import { login, openNewFeature, saveStatus, seedCanvas } from './helpers';

/**
 * Lienzos descubiertos legibles (spec walkie-live-documentacion, parte 3 y revisión final) con API, Keycloak y Postgres
 * reales. Siembra el lienzo inicial de borradores reales (las propuestas «Apps» y «Catalog» del análisis de Walkie,
 * la tienda de Pedidos) y uno sintético de 75 cajas, y mide **lo que dibuja el Canvas**, no la distribución:
 * - cajas contra cajas (ninguna encimada: obligatorio);
 * - etiquetas contra cajas ajenas y etiquetas contra etiquetas (se miden y se documentan);
 * - cruces entre los trazos dibujados de conexiones que no comparten caja (se miden: no se exige cero);
 * - flechas: cada conexión con punta tiene su marcador y termina en el borde de su caja de destino;
 * - al cambiar de modo, las cajas visibles quedan dentro del área libre y la vista no salta (cuadro a cuadro);
 * - al volver a «Completa», las posiciones guardadas y la vista que había, exactas; nada se guarda;
 * - el costo de cada cambio de modo por fase (marcas `walkie-modo:*` del Canvas): cálculo, render, primer cuadro,
 *   cámara, último cuadro estable y tareas largas (solo Chromium las informa).
 * Corre en 1280×800, 1440×900 y 1920×1080, en Chromium y en WebKit (`WALKIE_BROWSER=webkit`). Con
 * `WALKIE_CAPTURES=<carpeta>` guarda capturas. Datos ficticios (los ids de catálogo de los borradores no existen: las
 * APIs se siembran como cajas con su método y ruta, que es como se dibujan).
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
    edges: edges as Record<string, { id: string; from: string; to: string; kind: string }>,
    layout,
  };
}

const slug = (s: string) => s.normalize('NFD').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();

async function capture(page: Page, name: string) {
  const dir = process.env.WALKIE_CAPTURES;
  if (dir) await page.screenshot({ path: `${dir}/legibilidad-${test.info().project.name}-${name}.png` });
}

type Box = { x: number; y: number; w: number; h: number };
type Pt = { x: number; y: number };
const overlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Espera a que la vista deje de moverse (en Safari, con cuadros lentos, «Ver todo» tarda más de un segundo). */
async function settled(page: Page) {
  let last = '';
  await expect
    .poll(
      async () => {
        const now = await page.evaluate(() => getComputedStyle(document.querySelector('.react-flow__viewport')!).transform);
        const same = now === last;
        last = now;
        return same;
      },
      { intervals: [300], timeout: 15_000 },
    )
    .toBe(true);
}

/**
 * Lo que está dibujado, en px de pantalla: cajas visibles, etiquetas, cada conexión con su trazo muestreado (cada 6 px
 * a lo largo del `path` real, con `getScreenCTM`) y su marcador, la vista y el área libre (sin barra ni inspector).
 */
async function rendered(page: Page) {
  return page.evaluate(() => {
    const rect = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    const viewport = document.querySelector('.react-flow__viewport')!;
    const m = new DOMMatrix(getComputedStyle(viewport).transform);
    const boxes = [...document.querySelectorAll('.react-flow__node')]
      .filter((n) => getComputedStyle(n).visibility !== 'hidden' && getComputedStyle(n).display !== 'none' && n.querySelector('.pixel-node'))
      .map((n) => ({ ...rect(n.querySelector('.pixel-node')!), id: n.getAttribute('data-id')! }));
    const labels = [...document.querySelectorAll('.kind-edge-label')].map((el) => ({ ...rect(el), id: el.getAttribute('data-edge-id')! }));
    const edges = [...document.querySelectorAll('.react-flow__edge')].map((g) => {
      const path = g.querySelector<SVGPathElement>('path.kind-edge')!;
      const ctm = path.getScreenCTM()!;
      const total = path.getTotalLength();
      const points: { x: number; y: number }[] = [];
      for (let d = 0; d <= total; d += 6) {
        const p = path.getPointAtLength(d).matrixTransform(ctm);
        points.push({ x: p.x, y: p.y });
      }
      const end = path.getPointAtLength(total).matrixTransform(ctm);
      points.push({ x: end.x, y: end.y });
      const marker = path.getAttribute('marker-end');
      const markerId = marker?.match(/#([^)]+)/)?.[1];
      return {
        id: (g.getAttribute('data-testid') ?? '').replace('rf__edge-', ''),
        points,
        marker,
        markerExists: markerId ? !!document.getElementById(markerId) : null,
        visible: getComputedStyle(g).opacity !== '0' && total > 4,
      };
    });
    const pane = rect(document.querySelector('.canvas-flow')!);
    const inspector = document.querySelector('.canvas.has-inspector .inspector');
    const toolbar = document.querySelector('.toolbar-dock');
    const left = toolbar ? rect(toolbar).x + rect(toolbar).w : pane.x;
    const right = inspector ? rect(inspector).x : pane.x + pane.w;
    return { zoom: m.a, tx: m.e, ty: m.f, boxes, labels, edges, pane, free: { x: left, y: pane.y, w: right - left, h: pane.h } };
  });
}

type Rendered = Awaited<ReturnType<typeof rendered>>;

function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

/** Medidas de lo dibujado: lo que se exige (cajas, flechas) y lo que se documenta (etiquetas, cruces). */
function measureRendered(g: Rendered, ends: Record<string, [string, string]>) {
  const boxOverlaps: string[] = [];
  for (let i = 0; i < g.boxes.length; i++)
    for (let j = i + 1; j < g.boxes.length; j++) if (overlap(g.boxes[i]!, g.boxes[j]!)) boxOverlaps.push(`${g.boxes[i]!.id}/${g.boxes[j]!.id}`);
  let labelOverBox = 0;
  for (const l of g.labels) {
    const [from, to] = ends[l.id] ?? ['', ''];
    if (g.boxes.some((b) => b.id !== from && b.id !== to && overlap(l, b))) labelOverBox++;
  }
  let labelOverLabel = 0;
  for (let i = 0; i < g.labels.length; i++) for (let j = i + 1; j < g.labels.length; j++) if (overlap(g.labels[i]!, g.labels[j]!)) labelOverLabel++;
  const visible = g.edges.filter((e) => e.visible && ends[e.id]);
  let crossings = 0;
  for (let i = 0; i < visible.length; i++) {
    for (let j = i + 1; j < visible.length; j++) {
      const [a1, a2] = ends[visible[i]!.id]!;
      const [b1, b2] = ends[visible[j]!.id]!;
      if (a1 === b1 || a1 === b2 || a2 === b1 || a2 === b2) continue;
      const p = visible[i]!.points;
      const q = visible[j]!.points;
      let crossed = false;
      for (let s = 1; s < p.length && !crossed; s++) for (let t = 1; t < q.length && !crossed; t++) crossed = segmentsCross(p[s - 1]!, p[s]!, q[t - 1]!, q[t]!);
      if (crossed) crossings++;
    }
  }
  // Flechas: marcador presente y la punta en el borde de la caja de destino (a lo sumo 6 px, en pantalla).
  const badArrows: string[] = [];
  const boxById = new Map(g.boxes.map((b) => [b.id, b]));
  for (const e of visible) {
    if (!e.marker) continue;
    const target = boxById.get(ends[e.id]![1]);
    const tip = e.points[e.points.length - 1]!;
    const near = target && tip.x >= target.x - 6 && tip.x <= target.x + target.w + 6 && tip.y >= target.y - 6 && tip.y <= target.y + target.h + 6;
    if (!e.markerExists || !near) badArrows.push(e.id);
  }
  return { boxOverlaps, labelOverBox, labelOverLabel, labels: g.labels.length, crossings, edges: visible.length, badArrows };
}

/** Cajas visibles fuera del área libre (sin la barra de herramientas ni el inspector). */
function outsideFreeArea(g: Pick<Rendered, 'boxes' | 'free'>): string[] {
  const { free } = g;
  return g.boxes
    .filter((b) => b.x < free.x - 1 || b.y < free.y - 1 || b.x + b.w > free.x + free.w + 1 || b.y + b.h > free.y + free.h + 1)
    .map((b) => b.id);
}

async function openSeeded(page: Page, draft: CanvasDraft, name: string) {
  await openNewFeature(page, name);
  const graph = graphOf(draft);
  await seedCanvas(page, graph);
  // Sin vista guardada, como un lienzo recién creado desde la revisión (el lienzo guarda su vista al salir: se borra
  // desde otra página).
  const url = new URL(page.url()).pathname;
  await page.goto('/apps');
  await expect(page.getByRole('list', { name: 'Apps' })).toBeVisible();
  await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('walkie.viewport.')).forEach((k) => localStorage.removeItem(k)));
  await page.goto(url);
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  await settled(page);
  await expect(saveStatus(page)).toHaveAttribute('data-state', 'idle');
  const ends = Object.fromEntries(Object.values(graph.edges).map((e) => [e.id, [e.from, e.to] as [string, string]]));
  return { graph, ends };
}

/**
 * Cambia de modo y sigue, cuadro a cuadro (`requestAnimationFrame`), la vista y la posición dibujada de las cajas hasta
 * que nada se mueve durante 400 ms. Devuelve las fases (marcas `walkie-modo:*` del Canvas), las tareas largas
 * (Chromium) y el mayor cambio de la vista en un cuadro, como fracción del recorrido total (un salto ≈ 1).
 */
async function switchMode(page: Page, label: string) {
  await page.evaluate(() => {
    performance.clearMarks();
    performance.clearMeasures();
    const w = window as unknown as { __frames: { t: number; v: string; n: string }[]; __long: number[]; __obs?: PerformanceObserver };
    w.__frames = [];
    w.__long = [];
    try {
      w.__obs?.disconnect();
      w.__obs = new PerformanceObserver((list) => list.getEntries().forEach((e) => w.__long.push(Math.round(e.duration))));
      w.__obs.observe({ type: 'longtask', buffered: false });
    } catch {
      // WebKit no informa tareas largas.
    }
    const viewport = document.querySelector('.react-flow__viewport')!;
    const nodes = [...document.querySelectorAll('.react-flow__node')].slice(0, 40);
    let quietSince = performance.now();
    let last = '';
    const tick = () => {
      const v = getComputedStyle(viewport).transform;
      const n = nodes.map((x) => getComputedStyle(x).transform).join('|');
      const now = performance.now();
      if (v + n !== last) quietSince = now;
      last = v + n;
      w.__frames.push({ t: now, v, n });
      if (now - quietSince < 400 && w.__frames.length < 600) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.getByRole('radio', { name: label }).click();
  await expect(page.getByRole('radio', { name: label })).toHaveAttribute('aria-checked', 'true');
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const f = (window as unknown as { __frames: { t: number }[] }).__frames;
          return f.length > 1 && performance.now() - f[f.length - 1]!.t > 300;
        }),
      { timeout: 15_000 },
    )
    .toBe(true);
  return page.evaluate(() => {
    const w = window as unknown as { __frames: { t: number; v: string; n: string }[]; __long: number[] };
    const mark = (name: string) => performance.getEntriesByName(name, 'mark')[0]?.startTime;
    const start = mark('walkie-modo:inicio');
    const commit = mark('walkie-modo:commit');
    const camStart = mark('walkie-modo:camara-inicio');
    const camEnd = mark('walkie-modo:camara-fin');
    const calc = performance.getEntriesByName('walkie-modo:calculo', 'measure').map((m) => m.duration);
    const frames = w.__frames.filter((f) => start === undefined || f.t >= start);
    let lastChange = frames[0]?.t ?? 0;
    for (let i = 1; i < frames.length; i++) if (frames[i]!.v !== frames[i - 1]!.v || frames[i]!.n !== frames[i - 1]!.n) lastChange = frames[i]!.t;
    const firstFrame = frames.find((f) => commit !== undefined && f.t >= commit)?.t;
    const views = frames.map((f) => new DOMMatrix(f.v));
    const move = (a: DOMMatrix, b: DOMMatrix) => Math.hypot(b.e - a.e, b.f - a.f) + 1000 * Math.abs(b.a - a.a);
    const totalMove = views.length > 1 ? move(views[0]!, views[views.length - 1]!) : 0;
    let biggest = 0;
    for (let i = 1; i < views.length; i++) biggest = Math.max(biggest, move(views[i - 1]!, views[i]!));
    const r = (v: number | undefined) => (v === undefined ? null : Math.round(v));
    return {
      calculo: calc.length ? Math.round(Math.max(...calc) * 100) / 100 : null,
      render: r(commit !== undefined && start !== undefined ? commit - start : undefined),
      primerCuadro: r(firstFrame !== undefined && commit !== undefined ? firstFrame - commit : undefined),
      camara: r(camStart !== undefined && camEnd !== undefined ? camEnd - camStart : undefined),
      estable: r(start !== undefined ? lastChange - start : undefined),
      tareasLargas: w.__long,
      cuadros: frames.length,
      saltoMaximo: totalMove > 0.5 ? Math.round((biggest / totalMove) * 100) / 100 : 0,
      vistaMovida: totalMove > 0.5,
    };
  });
}

// Diagnóstico (no cambia lo que se comprueba): si una prueba falla, adjunta las navegaciones de la página y los
// errores de consola, para distinguir una sesión perdida de una navegación inesperada.
test.beforeEach(({ page }, info) => {
  const log: string[] = [];
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) log.push(`${Date.now()} ${new URL(f.url()).pathname}`);
  });
  page.on('console', (m) => {
    if (m.type() === 'error') log.push(`${Date.now()} console: ${m.text().slice(0, 160)}`);
  });
  (info as unknown as { navigationLog: string[] }).navigationLog = log;
});
test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return;
  const log = (info as unknown as { navigationLog: string[] }).navigationLog ?? [];
  info.annotations.push({ type: 'navegaciones', description: JSON.stringify({ final: page.url(), log }) });
});

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport });

    test('Apps de Walkie: abre legible y lo dibujado se mide en cada modo sin cambiar lo guardado', async ({ page }) => {
      test.setTimeout(180_000);
      await login(page);
      await page.evaluate(() => localStorage.setItem('walkie.viewMode', '"full"'));
      const { graph, ends } = await openSeeded(page, walkieApps, 'Gestión de apps');
      const total = Object.keys(graph.nodes).length;

      // Al abrir: zoom legible y la primera pantalla de la navegación a la vista, fuera del inspector.
      const initial = await rendered(page);
      expect(initial.zoom).toBeGreaterThanOrEqual(LEGIBLE_ZOOM - 0.01);
      const first = initial.boxes.find((b) => b.id === Object.values(graph.nodes).find((n) => n.title === 'Apps')!.id)!;
      expect(outsideFreeArea({ boxes: [first], free: initial.free })).toEqual([]);
      await capture(page, `${viewport.width}-apps-inicial`);

      // «Completa» con «Ver todo»: lo dibujado, medido.
      await page.keyboard.press('0');
      await settled(page);
      const full = await rendered(page);
      expect(full.boxes).toHaveLength(total);
      const fullMeasures = measureRendered(full, ends);
      expect(fullMeasures.boxOverlaps).toEqual([]);
      expect(fullMeasures.badArrows).toEqual([]);
      expect(outsideFreeArea(full)).toEqual([]);
      await capture(page, `${viewport.width}-apps-completa`);
      const manualView = { zoom: full.zoom, tx: full.tx, ty: full.ty };
      const documented = Object.fromEntries(full.boxes.map((b) => [b.id, { x: (b.x - full.tx) / full.zoom, y: (b.y - full.ty) / full.zoom }]));

      // «Resumen»: solo las pantallas, juntas, a la vista y con lo que llaman contado; la vista se mueve sin saltar.
      const toSummary = await switchMode(page, 'Resumen');
      await settled(page);
      const summary = await rendered(page);
      expect(summary.boxes).toHaveLength(3);
      await expect(page.locator('.pixel-node-calls').first()).toContainText('llama a');
      const summaryMeasures = measureRendered(summary, ends);
      expect(summaryMeasures.boxOverlaps).toEqual([]);
      expect(summaryMeasures.badArrows).toEqual([]);
      expect(outsideFreeArea(summary)).toEqual([]);
      expect(toSummary.saltoMaximo).toBeLessThanOrEqual(0.5);
      // Sin los huecos de las APIs: las 3 pantallas entran con más zoom que la vista completa.
      expect(summary.zoom).toBeGreaterThan(full.zoom);
      await capture(page, `${viewport.width}-apps-resumen`);

      // «Completa» otra vez: las posiciones guardadas y la vista que había, exactas.
      const backToFull = await switchMode(page, 'Completa');
      await settled(page);
      const restored = await rendered(page);
      expect(Math.abs(restored.zoom - manualView.zoom)).toBeLessThan(0.001);
      expect(Math.abs(restored.tx - manualView.tx)).toBeLessThan(0.6);
      expect(Math.abs(restored.ty - manualView.ty)).toBeLessThan(0.6);
      for (const b of restored.boxes) {
        const flow = { x: (b.x - restored.tx) / restored.zoom, y: (b.y - restored.ty) / restored.zoom };
        expect(Math.abs(flow.x - documented[b.id]!.x)).toBeLessThan(1);
        expect(Math.abs(flow.y - documented[b.id]!.y)).toBeLessThan(1);
      }
      expect(backToFull.saltoMaximo).toBeLessThanOrEqual(0.5);

      // «Interacciones»: ni las cajas ni la vista se mueven; sin etiquetas hasta elegir; al elegir «App», las suyas.
      const toInteractions = await switchMode(page, 'Interacciones');
      expect(toInteractions.vistaMovida).toBe(false);
      await expect(page.locator('.kind-edge-label')).toHaveCount(0);
      const app = Object.values(graph.nodes).find((n) => n.title === 'App')!;
      await page.locator(`.react-flow__node[data-id="${app.id}"]`).click();
      const touching = Object.values(graph.edges).filter((e) => e.from === app.id || e.to === app.id).length;
      await expect(page.locator('.kind-edge-label')).toHaveCount(touching);
      await expect(page.locator('.react-flow__node.focus-dim').first()).toBeVisible();
      const focused = measureRendered(await rendered(page), ends);
      expect(focused.boxOverlaps).toEqual([]);
      await capture(page, `${viewport.width}-apps-interacciones`);
      await page.keyboard.press('Escape');
      const toFull = await switchMode(page, 'Completa');
      expect(toFull.vistaMovida).toBe(false);
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
        description: JSON.stringify({
          viewport,
          initialZoom: initial.zoom,
          fitZoom: full.zoom,
          summaryZoom: summary.zoom,
          completa: fullMeasures,
          resumen: summaryMeasures,
          interaccionesEnfocada: focused,
          cambios: { resumen: toSummary, completaDesdeResumen: backToFull, interacciones: toInteractions, completa: toFull },
        }),
      });
    });

    for (const [name, draft, minZoom] of [
      ['Componentes compartidos', walkieCatalog, LEGIBLE_ZOOM - 0.01],
      ['Tienda de pedidos', pedidos, 0.75],
      ['Sintética de 75 cajas', synthetic(75), LEGIBLE_ZOOM - 0.01],
    ] as const) {
      test(`${name}: lo dibujado sin cajas encimadas, flechas correctas y zoom inicial legible`, async ({ page }) => {
        test.setTimeout(180_000);
        await login(page);
        await page.evaluate(() => localStorage.setItem('walkie.viewMode', '"full"'));
        await expect(page.getByRole('list', { name: 'Apps' })).toBeVisible();
        const { graph, ends } = await openSeeded(page, draft, name);
        const opened = await rendered(page);
        expect(opened.zoom, name).toBeGreaterThanOrEqual(minZoom);
        expect(measureRendered(opened, ends).boxOverlaps).toEqual([]);
        await capture(page, `${viewport.width}-${slug(name)}-inicial`);
        await page.keyboard.press('0');
        await settled(page);
        const fit = await rendered(page);
        expect(fit.boxes).toHaveLength(Object.keys(graph.nodes).length);
        const measures = measureRendered(fit, ends);
        expect(measures.boxOverlaps).toEqual([]);
        expect(measures.badArrows).toEqual([]);
        expect(outsideFreeArea(fit)).toEqual([]);
        await capture(page, `${viewport.width}-${slug(name)}-completa`);
        const toSummary = await switchMode(page, 'Resumen');
        await settled(page);
        const summary = await rendered(page);
        expect(measureRendered(summary, ends).boxOverlaps).toEqual([]);
        expect(outsideFreeArea(summary)).toEqual([]);
        await capture(page, `${viewport.width}-${slug(name)}-resumen`);
        await switchMode(page, 'Completa');
        await expect(saveStatus(page)).toHaveAttribute('data-state', 'idle');
        test.info().annotations.push({
          type: 'medidas',
          description: JSON.stringify({ viewport, name, initialZoom: opened.zoom, fitZoom: fit.zoom, summaryZoom: summary.zoom, completa: measures, cambioResumen: toSummary }),
        });
      });
    }
  });
}
