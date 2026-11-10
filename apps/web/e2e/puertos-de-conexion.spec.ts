import { expect, test, type Page } from '@playwright/test';
import { login, openNewFeature, seedCanvas } from './helpers';

/**
 * Feature puertos-de-conexion (docs/features/puertos-de-conexion/spec.md) con API, Keycloak y Postgres reales: cada
 * conexión sale y entra por el lado que mira al otro extremo y las que comparten lado se reparten. Datos ficticios.
 */

/** Parecido al lienzo que reportó el problema: «Home» con tres salidas, decisión con dos ramas y un grupo plegado. */
const graph = {
  schemaVersion: 0,
  nodes: {
    login: { id: 'login', type: 'screen', title: 'Login page' },
    d: {
      id: 'd',
      type: 'rule',
      title: 'Con cuál te logras',
      mode: 'decision',
      branches: [
        { id: 'g', label: 'google' },
        { id: 'm', label: 'microsoft' },
      ],
    },
    google: { id: 'google', type: 'screen', title: 'autenticación de google' },
    ms: { id: 'ms', type: 'screen', title: 'Autenticación de microsoft' },
    cloud1: { id: 'cloud1', type: 'service', title: 'OAuth Google', groupId: 'cloud' },
    cloud2: { id: 'cloud2', type: 'service', title: 'OAuth Microsoft', groupId: 'cloud' },
    home: { id: 'home', type: 'screen', title: 'Home' },
    api: { id: 'api', type: 'api', title: 'API' },
    portal: { id: 'portal', type: 'portal', title: 'Conectar cuentas para eventos' },
  },
  edges: {
    e1: { id: 'e1', from: 'login', to: 'd', kind: 'navigation' },
    e2: { id: 'e2', from: 'd', to: 'google', kind: 'uses', branch: 'g' },
    e3: { id: 'e3', from: 'd', to: 'ms', kind: 'uses', branch: 'm' },
    e4: { id: 'e4', from: 'google', to: 'cloud1', kind: 'uses' },
    e5: { id: 'e5', from: 'ms', to: 'cloud2', kind: 'uses' },
    h1: { id: 'h1', from: 'home', to: 'google', kind: 'navigation' },
    h2: { id: 'h2', from: 'home', to: 'api', kind: 'request' },
    h3: { id: 'h3', from: 'home', to: 'portal', kind: 'navigation' },
  },
  layout: {
    login: { x: 0, y: 160 },
    d: { x: 280, y: 160 },
    google: { x: 640, y: 80 },
    ms: { x: 640, y: 280 },
    cloud: { x: 1000, y: 120, w: 400, h: 300 },
    cloud1: { x: 1040, y: 200 },
    cloud2: { x: 1040, y: 320 },
    home: { x: 280, y: 520 },
    api: { x: 640, y: 520 },
    portal: { x: 640, y: 700 },
  },
  groups: { cloud: { id: 'cloud', title: 'servicios cloud', kind: 'environment', collapsed: true } },
  groupNesting: 'explicit',
};

/** Con `WALKIE_CAPTURES=<carpeta>`, guarda capturas para revisar el resultado visual. */
async function capture(page: Page, name: string) {
  const dir = process.env.WALKIE_CAPTURES;
  if (dir) await page.screenshot({ path: `${dir}/puertos-de-conexion-${name}.png` });
}

/** Primer y último punto del trazo de una conexión, en coordenadas del lienzo. */
async function ends(page: Page, edgeId: string) {
  const d = await page.locator(`[data-testid="rf__edge-${edgeId}"] path.kind-edge`).getAttribute('d');
  const numbers = (d ?? '').match(/-?\d+(\.\d+)?/g)!.map(Number);
  return { sx: numbers[0]!, sy: numbers[1]!, tx: numbers.at(-2)!, ty: numbers.at(-1)! };
}

const box = (page: Page, title: string) =>
  page.locator('.react-flow__node').filter({ has: page.locator('.pixel-node-title', { hasText: new RegExp(`^${title}$`) }) });

test('las conexiones se reparten por lado y cambian de lado al mover una caja', async ({ page }) => {
  await login(page);
  await openNewFeature(page, 'Puertos');
  await seedCanvas(page, graph);
  await capture(page, '1-reparto');

  // «Home» saca tres conexiones por su derecha: cada una por su punto, de arriba abajo como sus destinos.
  const [toGoogle, toApi, toPortal] = await Promise.all(['h1', 'h2', 'h3'].map((id) => ends(page, id)));
  expect(new Set([toGoogle!.sx, toApi!.sx, toPortal!.sx]).size).toBe(1);
  expect(toGoogle!.sy).toBeLessThan(toApi!.sy);
  expect(toApi!.sy).toBeLessThan(toPortal!.sy);

  // «servicios cloud» (plegado) recibe dos conexiones por su izquierda, cada una en su punto.
  const [c1, c2] = await Promise.all(['e4', 'e5'].map((id) => ends(page, id)));
  expect(c1!.tx).toBe(c2!.tx);
  expect(c1!.ty).not.toBe(c2!.ty);

  // Las ramas salen de su salida en la decisión (puntos distintos).
  const [yes, no] = await Promise.all(['e2', 'e3'].map((id) => ends(page, id)));
  expect(yes!.sy).not.toBe(no!.sy);

  // Mover el portal debajo de «Home»: su conexión pasa a salir por abajo (misma x que el centro de Home).
  const zoom = Number(
    /matrix\(([^,]+)/.exec(await page.locator('.react-flow__viewport').evaluate((el) => getComputedStyle(el).transform))?.[1] ?? 1,
  );
  const portal = (await page.locator('[data-testid="rf__node-portal"]').boundingBox())!;
  await page.mouse.move(portal.x + 40, portal.y + 20);
  await page.mouse.down();
  await page.mouse.move(portal.x + 40 - 360 * zoom, portal.y + 20 + 160 * zoom, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const e = await ends(page, 'h3');
      const home = await ends(page, 'h2');
      // Sale por abajo: más abajo que las salidas de la derecha y llega por arriba del portal.
      return e.sy > home.sy && e.ty > e.sy && Math.abs(e.sx - e.tx) < 120;
    })
    .toBe(true);
  await capture(page, '2-cambio-de-lado');
});

test('puntos arriba y abajo: aparecen al pasar el puntero y sirven para conectar', async ({ page }) => {
  await login(page);
  await openNewFeature(page, 'Puertos arriba');
  await seedCanvas(page, graph);

  const home = box(page, 'Home');
  const top = home.locator('.react-flow__handle-top');
  await expect(top).toHaveCSS('opacity', '0');
  await home.hover();
  await expect(top).toHaveCSS('opacity', '1');

  // De abajo de «API» a arriba de «Home»... (conexión libre): se crea la conexión.
  const before = await page.locator('.react-flow__edge').count();
  const api = box(page, 'API');
  await api.hover();
  const from = (await api.locator('.react-flow__handle-bottom').boundingBox())!;
  await page.mouse.move(from.x + 4, from.y + 4);
  await page.mouse.down();
  await home.hover();
  const to = (await top.boundingBox())!;
  await page.mouse.move(to.x + 4, to.y + 4, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('.react-flow__edge')).toHaveCount(before + 1);
});

/** Pantalla → API con otra caja y una nota justo en medio. */
const blocked = {
  schemaVersion: 0,
  nodes: {
    screen: { id: 'screen', type: 'screen', title: 'Creación de cuenta' },
    api: { id: 'api', type: 'api', title: 'API usuarios' },
    middle: { id: 'middle', type: 'service', title: 'Servicio en medio' },
  },
  edges: { e: { id: 'e', from: 'screen', to: 'api', kind: 'request' } },
  layout: {
    screen: { x: 0, y: 200 },
    middle: { x: 360, y: 184 },
    api: { x: 760, y: 200 },
    note: { x: 360, y: 40 },
  },
  stickyNotes: { note: { id: 'note', text: 'Pendiente: validar con seguridad' } },
};

/** Puntos del trazo (coordenadas del lienzo). */
async function points(page: Page, edgeId: string) {
  const d = (await page.locator(`[data-testid="rf__edge-${edgeId}"] path.kind-edge`).getAttribute('d')) ?? '';
  const n = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  return Array.from({ length: n.length / 2 }, (_, i) => ({ x: n[2 * i]!, y: n[2 * i + 1]! }));
}

/** Caja de un nodo en coordenadas del lienzo: su posición sembrada y su tamaño medido. */
async function rect(page: Page, id: string, at: { x: number; y: number }) {
  const size = await page.locator(`[data-testid="rf__node-${id}"]`).evaluate((el) => ({ w: (el as HTMLElement).offsetWidth, h: (el as HTMLElement).offsetHeight }));
  return { ...at, ...size };
}

const crosses = (pts: { x: number; y: number }[], r: { x: number; y: number; w: number; h: number }) =>
  pts.some((p, i) => {
    if (i === 0) return false;
    const a = pts[i - 1]!;
    return Math.max(a.x, p.x) > r.x && Math.min(a.x, p.x) < r.x + r.w && Math.max(a.y, p.y) > r.y && Math.min(a.y, p.y) < r.y + r.h;
  });

test('las conexiones esquivan las cajas y notas que quedan en medio', async ({ page }) => {
  await login(page);
  await openNewFeature(page, 'Esquivar');
  await seedCanvas(page, blocked);
  await capture(page, '3-esquiva');

  const middle = await rect(page, 'middle', blocked.layout.middle);
  const note = await rect(page, 'note', blocked.layout.note);
  const route = await points(page, 'e');
  expect(route.length).toBeGreaterThan(2);
  expect(crosses(route, middle)).toBe(false);
  expect(crosses(route, note)).toBe(false);
  // Sale por la derecha de la pantalla y llega por la izquierda de la API.
  expect(route[0]!.x).toBeGreaterThan(blocked.layout.screen.x + 100);
  expect(route.at(-1)!.x).toBe(blocked.layout.api.x);

  // Apartar la caja de en medio (hacia abajo): la conexión vuelve a ser recta.
  const zoom = Number(
    /matrix\(([^,]+)/.exec(await page.locator('.react-flow__viewport').evaluate((el) => getComputedStyle(el).transform))?.[1] ?? 1,
  );
  const box = (await page.locator('[data-testid="rf__node-middle"]').boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, box.y + 20 + 260 * zoom, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => new Set((await points(page, 'e')).map((p) => Math.round(p.y))).size).toBe(1);
  await capture(page, '4-recta');
});
