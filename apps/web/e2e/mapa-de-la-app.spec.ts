import { expect, test, type Page } from '@playwright/test';
import { login, openNewFeature, seedCanvas } from './helpers';

/**
 * Feature mapa-de-la-app (docs/features/mapa-de-la-app/spec.md) con API, Keycloak y Postgres reales: «Login» lleva con
 * un portal a «Conectar cuentas para eventos» y las dos usan la misma API del catálogo. El mapa es una vista adicional:
 * la galería sigue igual. Datos ficticios.
 */

const API = process.env.VITE_API_URL ?? 'http://localhost:5080';

/** Llamada a la API real con el token de la sesión. */
async function api<T>(page: Page, method: string, path: string, body?: unknown): Promise<T> {
  return page.evaluate(
    async ({ api, method, path, body }) => {
      const key = Object.keys(sessionStorage).find((k) => k.startsWith('oidc.user:'))!;
      const token = (JSON.parse(sessionStorage.getItem(key)!) as { access_token: string }).access_token;
      const res = await fetch(`${api}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return (await res.json()) as T;
    },
    { api: API, method, path, body },
  );
}

/** Con `WALKIE_CAPTURES=<carpeta>`, guarda capturas para revisar el resultado visual. */
async function capture(page: Page, name: string) {
  const dir = process.env.WALKIE_CAPTURES;
  if (dir) await page.screenshot({ path: `${dir}/mapa-de-la-app-${name}.png` });
}

const featureBox = (page: Page, name: string) =>
  page.locator('.react-flow__node-feature').filter({ has: page.locator('.map-feature-name', { hasText: new RegExp(`^${name}$`) }) });

test('mapa de la app: features, portales, componentes compartidos, abrir en el lienzo y acomodar', async ({ page }) => {
  await login(page);
  await openNewFeature(page, 'Login');
  const [, appId, loginId] = /apps\/([^/]+)\/features\/([^/?#]+)/.exec(page.url())!;

  // Segunda feature y un componente del catálogo, por la API.
  const events = await api<{ id: string }>(page, 'POST', `/api/apps/${appId}/features`, { name: 'Conectar cuentas para eventos' });
  const item = await api<{ id: string }>(page, 'POST', `/api/apps/${appId}/catalog`, { type: 'api', title: 'API usuarios' });

  await seedCanvas(page, {
    schemaVersion: 0,
    nodes: {
      login: { id: 'login', type: 'screen', title: 'Login page' },
      home: { id: 'home', type: 'screen', title: 'Home' },
      p1: { id: 'p1', type: 'portal', title: 'Conectar cuentas para eventos', targetFeatureId: events.id },
      users: { id: 'users', type: 'ref', title: 'API usuarios', catalogId: item.id },
    },
    edges: {
      e1: { id: 'e1', from: 'login', to: 'home', kind: 'navigation' },
      e2: { id: 'e2', from: 'home', to: 'p1', kind: 'navigation' },
      e3: { id: 'e3', from: 'login', to: 'users', kind: 'request' },
    },
    layout: { login: { x: 0, y: 0 }, home: { x: 320, y: 0 }, p1: { x: 640, y: 0 }, users: { x: 320, y: 200 } },
  });
  await page.goto(`/apps/${appId}/features/${events.id}`);
  await expect(page.locator('.react-flow')).toBeVisible();
  await seedCanvas(page, {
    schemaVersion: 0,
    nodes: {
      cal: { id: 'cal', type: 'screen', title: 'Calendarios' },
      users: { id: 'users', type: 'ref', title: 'API usuarios', catalogId: item.id },
    },
    edges: { e1: { id: 'e1', from: 'cal', to: 'users', kind: 'request' } },
    layout: { cal: { x: 0, y: 0 }, users: { x: 320, y: 0 } },
  });

  // La galería sigue igual, con un acceso más: «Ver mapa».
  await page.goto(`/apps/${appId}`);
  await expect(page.getByRole('list', { name: 'Features' }).getByRole('listitem')).toHaveCount(2);
  await expect(page.getByLabel('Nueva feature')).toBeVisible();
  await page.getByRole('link', { name: '◇ Ver mapa' }).click();
  await expect(page).toHaveURL(new RegExp(`/apps/${appId}/map$`));

  // Cada feature es una caja con lo que tiene; el portal es una flecha con la caja desde la que se llega.
  await expect(featureBox(page, 'Login')).toContainText('2 pantallas · 1 API');
  await expect(featureBox(page, 'Conectar cuentas para eventos')).toContainText('1 pantalla · 1 API');
  const arrow = page.locator(`.map-edge-label[data-edge-id="${loginId}>${events.id}"]`);
  await expect(arrow).toHaveText('desde Home');
  await capture(page, '1-mapa');

  // Una feature seleccionada muestra a dónde lleva y qué comparte.
  await featureBox(page, 'Login').click();
  const panel = page.getByRole('complementary', { name: 'Feature' });
  await expect(panel.getByRole('region', { name: 'Llevan a' })).toContainText('→ Conectar cuentas para eventos');
  await expect(panel.getByRole('region', { name: 'Componentes compartidos' })).toContainText('API usuarios');
  await expect(featureBox(page, 'Conectar cuentas para eventos')).not.toHaveClass(/map-dim/);

  // Componentes compartidos: apagados por defecto; con el interruptor, la API aparece unida a las dos.
  await expect(page.locator('.react-flow__node-catalog')).toHaveCount(0);
  await page.getByLabel(/Mostrar componentes compartidos/).check();
  await expect(page.locator('.react-flow__node-catalog')).toContainText('Lo usan 2 features');
  await expect(page.locator('.map-edge-uses')).toHaveCount(2);
  await capture(page, '2-compartidos');

  // Acomodar: mover una caja se guarda para todos y sobrevive a recargar.
  const before = (await featureBox(page, 'Login').boundingBox())!;
  await page.mouse.move(before.x + 40, before.y + 20);
  await page.mouse.down();
  await page.mouse.move(before.x + 40, before.y + 220, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await featureBox(page, 'Login').boundingBox())!.y).toBeGreaterThan(before.y + 100);
  await page.waitForResponse((r) => r.url().endsWith('/map/layout') && r.request().method() === 'PUT');
  const moved = (await featureBox(page, 'Login').boundingBox())!;
  const other = (await featureBox(page, 'Conectar cuentas para eventos').boundingBox())!;
  await page.reload();
  await expect(featureBox(page, 'Login')).toBeVisible();
  const reloaded = (await featureBox(page, 'Login').boundingBox())!;
  const otherReloaded = (await featureBox(page, 'Conectar cuentas para eventos').boundingBox())!;
  // La vista se ajusta al abrir: se compara la posición relativa entre las dos cajas.
  expect(Math.sign(reloaded.y - otherReloaded.y)).toBe(Math.sign(moved.y - other.y));
  await expect(page.getByLabel(/Mostrar componentes compartidos/)).toBeChecked();

  // Una flecha seleccionada lista sus portales; «Abrir en el lienzo» abre Login con el portal seleccionado.
  await page.locator(`.map-edge-label[data-edge-id="${loginId}>${events.id}"]`).click();
  const connection = page.getByRole('complementary', { name: 'Conexión' });
  await expect(connection).toContainText('Login → Conectar cuentas para eventos');
  await expect(connection).toContainText('Desde «Home»');
  await connection.getByRole('button', { name: 'Abrir en el lienzo' }).click();
  await expect(page).toHaveURL(new RegExp(`/features/${loginId}\\?select=p1$`));
  await expect(page.getByRole('complementary', { name: 'Propiedades' })).toContainText('Portal');
  await expect(page.locator('[data-testid="rf__node-p1"]')).toHaveClass(/selected/);

  // Desde el editor se vuelve al mapa por el selector de features.
  await page.getByRole('navigation', { name: 'Ruta' }).getByRole('button', { name: /^Login/ }).click();
  await page.getByRole('dialog', { name: 'Cambiar de feature' }).getByRole('link', { name: '◇ Ver mapa de la app' }).click();
  await expect(page).toHaveURL(new RegExp(`/apps/${appId}/map$`));

  // Doble clic en una feature abre su lienzo.
  await featureBox(page, 'Conectar cuentas para eventos').dblclick();
  await expect(page).toHaveURL(new RegExp(`/features/${events.id}$`));
});
