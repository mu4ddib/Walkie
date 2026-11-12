import { expect, test, type Page } from '@playwright/test';
import { login, openNewFeature, seedCanvas } from './helpers';

/**
 * Feature conexiones-ida-y-vuelta (docs/features/conexiones-ida-y-vuelta/spec.md) con API, Keycloak y Postgres reales:
 * una solicitud y su respuesta (o sus respuestas) en cuatro disposiciones —en diagonal (el caso reportado), en línea,
 * apiladas y rodeando una caja— más un par muy cercano. Los trazos no comparten tramos y las etiquetas no se pisan
 * ni tapan cajas; sin lugar, se juntan en una etiqueta compuesta. Datos ficticios.
 */

type Pair = { request: string; responses: string[] };

const PAIRS: Record<string, Pair> = {
  diagonal: { request: 'r1', responses: ['s1'] },
  enLinea: { request: 'r2', responses: ['s2'] },
  apiladas: { request: 'r3', responses: ['s3'] },
  rodeo: { request: 'r4', responses: ['s4', 's5'] },
  cercanas: { request: 'r5', responses: ['s6'] },
};

function graph() {
  const node = (id: string, type: string, title: string) => ({ id, type, title });
  const req = (id: string, from: string, to: string) => ({ id, from, to, kind: 'request' });
  const res = (id: string, from: string, to: string, replyTo: string, status?: number) => ({
    id,
    from,
    to,
    kind: 'response',
    replyTo,
    ...(status ? { status } : {}),
  });
  return {
    schemaVersion: 0,
    nodes: {
      home: node('home', 'screen', 'Home'),
      api: node('api', 'api', 'API'),
      perfil: node('perfil', 'screen', 'Perfil'),
      apiPerfil: node('apiPerfil', 'api', 'API perfil'),
      lista: node('lista', 'screen', 'Movimientos'),
      apiLista: node('apiLista', 'api', 'API movimientos'),
      login: node('login', 'screen', 'Login'),
      auth: node('auth', 'api', 'API Auth'),
      wall: node('wall', 'service', 'Servicio en medio'),
      pago: node('pago', 'screen', 'Pago'),
      apiPago: node('apiPago', 'api', 'API pagos'),
    },
    edges: {
      r1: req('r1', 'home', 'api'),
      s1: res('s1', 'api', 'home', 'r1'),
      r2: req('r2', 'perfil', 'apiPerfil'),
      s2: res('s2', 'apiPerfil', 'perfil', 'r2', 200),
      r3: req('r3', 'lista', 'apiLista'),
      s3: res('s3', 'apiLista', 'lista', 'r3', 200),
      r4: req('r4', 'login', 'auth'),
      s4: res('s4', 'auth', 'login', 'r4', 201),
      s5: res('s5', 'auth', 'login', 'r4', 401),
      r5: req('r5', 'pago', 'apiPago'),
      s6: res('s6', 'apiPago', 'pago', 'r5', 202),
    },
    layout: {
      home: { x: 0, y: 0 },
      api: { x: 520, y: 360 },
      perfil: { x: 1000, y: 0 },
      apiPerfil: { x: 1560, y: 24 },
      lista: { x: 1000, y: 360 },
      apiLista: { x: 1040, y: 720 },
      login: { x: 0, y: 720 },
      auth: { x: 640, y: 720 },
      wall: { x: 320, y: 700 },
      pago: { x: 1500, y: 720 },
      apiPago: { x: 1760, y: 720 },
    },
  };
}

/** Con `WALKIE_CAPTURES=<carpeta>`, guarda capturas para revisar el resultado visual. */
async function capture(page: Page, name: string) {
  const dir = process.env.WALKIE_CAPTURES;
  if (dir) await page.screenshot({ path: `${dir}/conexiones-ida-y-vuelta-${name}.png` });
}

type Point = { x: number; y: number };
type Box = { x: number; y: number; width: number; height: number };

/** Puntos del trazo de una conexión (sus `d` son polilíneas con M y L, o escalones de React Flow sin curvas). */
async function pathOf(page: Page, id: string): Promise<Point[]> {
  const d = await page.locator(`.react-flow__edge[data-testid="rf__edge-${id}"] path.react-flow__edge-path`).getAttribute('d');
  const numbers = (d ?? '').match(/-?\d+(\.\d+)?/g)!.map(Number);
  const points: Point[] = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) points.push({ x: numbers[i]!, y: numbers[i + 1]! });
  return points;
}

/** ¿Dos trazos ortogonales comparten un trozo de tramo? */
function shareSegment(p: Point[], q: Point[]): boolean {
  const segs = (a: Point[]) => a.slice(1).map((b, i) => [a[i]!, b] as const);
  const near = (u: number, v: number) => Math.abs(u - v) < 1;
  return segs(p).some(([a, b]) =>
    segs(q).some(([c, d]) => {
      if (near(a.x, b.x) && near(c.x, d.x) && near(a.x, c.x)) {
        return Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) > 1;
      }
      if (near(a.y, b.y) && near(c.y, d.y) && near(a.y, c.y)) {
        return Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) > 1;
      }
      return false;
    }),
  );
}

const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const label = (page: Page, id: string) => page.locator(`.kind-edge-label[data-edge-id="${id}"]`);

test('ida y vuelta en cuatro disposiciones: trazos paralelos y etiquetas que no se pisan', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await login(page);
  await openNewFeature(page, 'Ida y vuelta');
  await seedCanvas(page, graph());
  await capture(page, '1-cuatro-disposiciones');

  const nodes: Box[] = [];
  for (const el of await page.locator('.react-flow__node').all()) nodes.push((await el.boundingBox())!);

  for (const [name, { request, responses }] of Object.entries(PAIRS)) {
    const ids = [request, ...responses];
    // Trazos: ninguno comparte tramo con otro del par.
    const paths = await Promise.all(ids.map((id) => pathOf(page, id)));
    for (let i = 0; i < paths.length; i++) {
      for (let j = i + 1; j < paths.length; j++) {
        expect(shareSegment(paths[i]!, paths[j]!), `${name}: ${ids[i]} y ${ids[j]} comparten tramo`).toBe(false);
      }
    }
    // Etiquetas: no se pisan entre ellas.
    const boxes = await Promise.all(ids.map(async (id) => (await label(page, id).boundingBox())!));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        expect(intersects(boxes[i]!, boxes[j]!), `${name}: etiquetas de ${ids[i]} y ${ids[j]}`).toBe(false);
      }
    }
    // …ni tapan cajas (tampoco la compuesta: se corre arriba o abajo del trazo).
    for (const [i, b] of boxes.entries()) {
      expect(nodes.some((n) => intersects(b, n)), `${name}: la etiqueta de ${ids[i]} tapa una caja`).toBe(false);
    }
  }

  // El par más cercano no tiene lugar: etiqueta compuesta, cada mitad la de su conexión.
  await expect(label(page, 'r5')).toHaveAttribute('data-joined', 'start');
  await expect(label(page, 's6')).toHaveAttribute('data-joined', 'end');
  await expect(label(page, 's6')).toContainText('responde');

  // Seleccionar una resalta solo esa.
  await page.locator('.react-flow__edge[data-testid="rf__edge-s1"]').click({ force: true });
  await expect(label(page, 's1')).toHaveAttribute('data-selected', 'true');
  await expect(label(page, 'r1')).not.toHaveAttribute('data-selected', 'true');
  await capture(page, '2-respuesta-seleccionada');
});
