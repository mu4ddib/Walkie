/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import { defineConfig, searchForWorkspaceRoot } from 'vite';
import react from '@vitejs/plugin-react';

// Sprites del guía (packages/sprites): fuera de apps/web, así que van por alias y se permiten en dev.
const sprites = fileURLToPath(new URL('../../packages/sprites', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@sprites': sprites } },
  // .env vive en la raíz del repo (lo crea el devcontainer desde .env.example).
  envDir: '../../',
  server: { port: 5173, strictPort: true, fs: { allow: [searchForWorkspaceRoot(process.cwd()), sprites] } },
  test: {
    environment: 'jsdom',
    // Las E2E (e2e/*.spec.ts) las corre Playwright, no Vitest.
    include: ['src/**/*.test.{ts,tsx}'],
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
