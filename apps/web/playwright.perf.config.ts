import { defineConfig, devices } from '@playwright/test';

/**
 * Banco de rendimiento (perf/*.perf.ts): mide sobre la compilación de producción (`vite build` + `vite preview`), no
 * sobre el servidor de desarrollo, para no medir el coste de React en modo desarrollo. Necesita Postgres, RustFS y
 * Keycloak levantados; la API la arranca Playwright o reutiliza la que esté corriendo.
 */
export default defineConfig({
  testDir: './perf',
  testMatch: /.*\.perf\.ts/,
  timeout: 600_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 1512, height: 860 },
    trace: 'off',
    actionTimeout: 15_000,
  },
  // WALKIE_BROWSER=webkit mide en el motor de Safari (`pnpm exec playwright install webkit` y `install-deps webkit`).
  projects:
    process.env.WALKIE_BROWSER === 'webkit'
      ? [{ name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1512, height: 860 } } }]
      : [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1512, height: 860 } } }],
  webServer: [
    {
      command: 'dotnet run --project ../api/src/Walkie.Api',
      url: 'http://localhost:5080/api/health',
      reuseExistingServer: true,
      timeout: 180_000,
    },
    {
      // WALKIE_PERF_READABLE=1: misma compilación de producción pero sin minificar, para leer los perfiles de CPU.
      command: process.env.WALKIE_PERF_READABLE
        ? 'pnpm exec vite build --minify false && pnpm preview --port 5173 --strictPort'
        : 'pnpm build && pnpm preview --port 5173 --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
});
