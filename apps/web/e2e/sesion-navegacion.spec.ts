import { expect, test, type Page } from '@playwright/test';
import { login, openNewFeature } from './helpers';

/**
 * Sesión y navegación repetida (spec walkie-live-documentacion, revisión final, punto 4). Aísla la pérdida de sesión
 * intermitente que se veía en WebKit: entra una vez y recorre galería → app → lienzo muchas veces con navegaciones
 * completas (`page.goto`, como los helpers de las demás pruebas), y en cada una anota qué pasó. No reintenta ni
 * vuelve a entrar: si la sesión se pierde, la prueba falla y dice en qué paso y con qué estado.
 *
 * Por cada navegación registra:
 * - si el usuario OIDC sigue en `sessionStorage` y cuánto le falta para expirar (token);
 * - qué pantalla quedó: la página esperada, «Iniciar sesión» (sesión perdida) o «Cargando…» colgado (restauración);
 * - las respuestas de la API que no fueron 2xx (401 = token rechazado) y los errores de consola;
 * - cuánto tardó la galería en dibujar su lista (carga de la galería).
 */
const ROUNDS = Number(process.env.WALKIE_ROUNDS ?? 15);

type Step = {
  round: number;
  target: string;
  outcome: 'ok' | 'signed-out' | 'loading' | 'navigation-error' | 'other';
  error?: string;
  hasUser: boolean;
  expiresIn: number | null;
  ms: number;
  failed: string[];
  console: string[];
};

async function sessionState(page: Page) {
  return page.evaluate(() => {
    const key = Object.keys(sessionStorage).find((k) => k.startsWith('oidc.user:'));
    if (!key) return { hasUser: false, expiresIn: null };
    const user = JSON.parse(sessionStorage.getItem(key)!) as { expires_at?: number };
    return { hasUser: true, expiresIn: user.expires_at ? Math.round(user.expires_at - Date.now() / 1000) : null };
  });
}

test('la sesión sobrevive a navegaciones completas repetidas (galería, app y lienzo)', async ({ page, browserName }) => {
  test.setTimeout(60_000 + ROUNDS * 30_000);
  const failed: string[] = [];
  const consoleErrors: string[] = [];
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 400) failed.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });
  page.on('requestfailed', (r) => {
    // Las solicitudes en curso que corta una navegación (ERR_ABORTED / cancelled) son normales: no se cuentan.
    const error = r.failure()?.errorText ?? '';
    if (/abort|cancel/i.test(error)) return;
    if (r.url().includes('/api/') || r.url().includes(':8080')) failed.push(`failed ${error} ${new URL(r.url()).pathname}`);
  });
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200));
  });

  await login(page);
  await openNewFeature(page, 'Sesión repetida');
  const canvasPath = new URL(page.url()).pathname;
  const appPath = canvasPath.replace(/\/features\/.*/, '');
  const steps: Step[] = [];

  for (let round = 0; round < ROUNDS; round++) {
    for (const [target, ready] of [
      ['/apps', page.getByRole('list', { name: 'Apps' })],
      [appPath, page.getByLabel('Nueva feature')],
      [canvasPath, page.locator('.react-flow')],
    ] as const) {
      failed.length = 0;
      consoleErrors.length = 0;
      const t0 = Date.now();
      let navigationError: string | undefined;
      try {
        await page.goto(target);
      } catch (e) {
        // Se anota y se sigue: cuenta como fallo de la prueba, pero se ve qué estado queda después.
        navigationError = (e as Error).message.split('\n')[0];
      }
      const signIn = page.getByRole('button', { name: 'Iniciar sesión' });
      const loading = page.getByText('Cargando…', { exact: true });
      let outcome: Step['outcome'] = 'other';
      try {
        await expect(ready.or(signIn)).toBeVisible({ timeout: 15_000 });
        outcome = (await ready.isVisible()) ? 'ok' : 'signed-out';
      } catch {
        outcome = (await loading.isVisible()) ? 'loading' : 'other';
      }
      if (navigationError) outcome = outcome === 'ok' ? 'navigation-error' : outcome;
      const state = await sessionState(page);
      steps.push({ round, target, outcome, error: navigationError, ...state, ms: Date.now() - t0, failed: [...failed], console: [...consoleErrors] });
    }
  }

  const bad = steps.filter((s) => s.outcome !== 'ok');
  const gallery = steps.filter((s) => s.target === '/apps').map((s) => s.ms);
  test.info().annotations.push({
    type: 'sesion',
    description: JSON.stringify({
      browserName,
      navigations: steps.length,
      bad,
      galleryMs: { max: Math.max(...gallery), mean: Math.round(gallery.reduce((a, b) => a + b, 0) / gallery.length) },
      apiFailures: steps.flatMap((s) => s.failed).length,
    }),
  });
  expect(bad, JSON.stringify(bad, null, 1)).toEqual([]);
});
