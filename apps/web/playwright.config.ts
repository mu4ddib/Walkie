import { defineConfig, devices } from '@playwright/test';

/**
 * E2E del flujo completo (lienzo-base, tarea 8). Necesita Postgres y Keycloak:
 *   docker compose -f infra/docker-compose.yml up -d postgres keycloak
 * La API y la web las levanta Playwright (o reutiliza las que ya estén corriendo).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 1280, height: 800 },
    screenshot: 'only-on-failure',
    trace: 'off',
  },
  // WALKIE_BROWSER=webkit corre en el motor de Safari (local; el CI usa Chromium): `pnpm exec playwright install webkit` e `install-deps webkit`.
  projects:
    process.env.WALKIE_BROWSER === 'webkit'
      ? [{ name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } } }]
      : [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } }],
  webServer: [
    {
      command: 'dotnet run --project ../api/src/Walkie.Api',
      url: 'http://localhost:5080/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      // En WebKit, la compilación de producción: el WebSocket del servidor de desarrollo de Vite hace caer el proceso
      // de red de WebKit en Linux (GLib-CRITICAL «g_atomic_rc_box_release_full»), que se lleva el `sessionStorage` y
      // con él la sesión. Safari nunca carga ese WebSocket. Ver `e2e/sesion-navegacion.spec.ts` y apps/web/CLAUDE.md.
      command: process.env.WALKIE_BROWSER === 'webkit' ? 'pnpm build && pnpm preview --port 5173 --strictPort' : 'pnpm dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: process.env.WALKIE_BROWSER === 'webkit' ? 240_000 : 60_000,
    },
  ],
});
