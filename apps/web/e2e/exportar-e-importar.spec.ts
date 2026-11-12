import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { login, openNewFeature, png, readZip, saveStatus, seedCanvas } from './helpers';

/**
 * Feature exportar-e-importar (docs/features/exportar-e-importar/spec.md) con API, Keycloak y Postgres reales.
 * Tarea 1: el contexto para IA de una feature (Markdown y JSON). Datos ficticios.
 */

const API = process.env.VITE_API_URL ?? 'http://localhost:5080';

/** Pone la descripción (el propósito) de la feature abierta por la API, con el token de la sesión. */
async function describeFeature(page: Page, name: string, description: string) {
  const featureId = /features\/([^/?#]+)/.exec(page.url())![1]!;
  const status = await page.evaluate(
    async ({ api, featureId, name, description }) => {
      const key = Object.keys(sessionStorage).find((k) => k.startsWith('oidc.user:'))!;
      const token = (JSON.parse(sessionStorage.getItem(key)!) as { access_token: string }).access_token;
      const res = await fetch(`${api}/api/features/${featureId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description }),
      });
      return res.status;
    },
    { api: API, featureId, name, description },
  );
  expect(status).toBe(200);
}

/** Con `WALKIE_CAPTURES=<carpeta>`, guarda capturas para revisar el resultado visual. */
async function capture(page: Page, name: string) {
  const dir = process.env.WALKIE_CAPTURES;
  if (dir) await page.screenshot({ path: `${dir}/exportar-e-importar-${name}.png` });
}

function graph() {
  return {
    schemaVersion: 0,
    nodes: {
      s1: { id: 's1', type: 'screen', title: 'Login', inputs: [{ name: 'documento', type: 'string', required: true }] },
      a1: { id: 'a1', type: 'api', title: 'API Auth', http: { method: 'POST', path: '/sesiones' } },
      q1: { id: 'q1', type: 'resource', title: 'Auditoría', resource: { kind: 'queue', provider: 'aws' } },
    },
    edges: {
      e1: { id: 'e1', from: 's1', to: 'a1', kind: 'request' },
      e2: { id: 'e2', from: 'a1', to: 'q1', kind: 'event' },
    },
    layout: { s1: { x: 0, y: 0 }, a1: { x: 320, y: 0 }, q1: { x: 640, y: 0 } },
    tours: { t1: { id: 't1', name: 'Entrar', kind: 'flow', steps: [{ edgeId: 'e1', note: 'Envía el documento' }] } },
  };
}

test('contexto para IA: vista previa con su tamaño, copiar y descargar el Markdown y el JSON', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await login(page);
  await openNewFeature(page, 'Iniciar sesión');
  await describeFeature(page, 'Iniciar sesión', 'El cliente entra con su documento y clave.');
  await seedCanvas(page, graph());

  await page.getByRole('button', { name: 'Exportar' }).click();
  await page.getByRole('menuitem', { name: /Contexto para IA/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Contexto para IA' });
  const preview = dialog.getByLabel('Vista previa del contexto');
  await expect(preview).toContainText('# Contexto para IA: Iniciar sesión');
  await expect(preview).toContainText('El cliente entra con su documento y clave.');
  await expect(preview).toContainText('### Auditoría (Cola)');
  await expect(preview).toContainText('1. Login → API Auth (llama: POST /sesiones) — Envía el documento');
  await expect(preview).toContainText('La solicitud «Login → API Auth (llama: POST /sesiones)» no tiene respuesta documentada.');
  await expect(dialog.getByRole('status')).toHaveText(/≈ [\d.]+ tokens · [\d.]+ caracteres/);
  await capture(page, '1-contexto-ia');

  // Copiar: lo copiado es el mismo Markdown de la vista previa.
  await dialog.getByRole('button', { name: 'Copiar al portapapeles' }).click();
  await expect(dialog.getByRole('button', { name: 'Copiado ✓' })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied.startsWith('# Contexto para IA: Iniciar sesión\n')).toBe(true);
  expect(copied).toContain('## Vacíos detectados');

  // Descargas: el .md y el JSON (con el propósito, los componentes y los vacíos).
  const md = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Descargar .md' }).click();
  const mdFile = await md;
  expect(mdFile.suggestedFilename()).toBe('iniciar-sesion-contexto-ia.md');
  expect(await readFile((await mdFile.path())!, 'utf8')).toBe(copied);

  const json = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Descargar JSON' }).click();
  const jsonFile = await json;
  expect(jsonFile.suggestedFilename()).toBe('iniciar-sesion.context.json');
  const ai = JSON.parse(await readFile((await jsonFile.path())!, 'utf8')) as {
    format: string;
    feature: { name: string; description: string };
    components: { id: string; is: string }[];
    gaps: { kind: string }[];
  };
  expect(ai.format).toBe('walkie-ai-context');
  expect(ai.feature).toMatchObject({ name: 'Iniciar sesión', description: 'El cliente entra con su documento y clave.' });
  expect(ai.components.find((c) => c.id === 'q1')?.is).toBe('Cola');
  expect(ai.gaps.map((g) => g.kind)).toContain('request-without-response');

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('contexto para IA de la app: todas sus features, cómo se conectan y el JSON', async ({ page }) => {
  await login(page);
  await openNewFeature(page, 'Transferir');
  const transferir = /features\/([^/?#]+)/.exec(page.url())![1]!;
  const appUrl = /^(.*\/apps\/[^/]+)/.exec(page.url())![1]!;

  // Una segunda feature que lleva a «Transferir» por un portal.
  await page.goto(appUrl);
  await page.getByLabel('Nueva feature').fill('Inicio');
  await page.getByRole('button', { name: 'Crear feature' }).click();
  await page.getByRole('link', { name: 'Inicio', exact: true }).click();
  await describeFeature(page, 'Inicio', 'Lo primero que ve el cliente.');
  await seedCanvas(page, {
    schemaVersion: 0,
    nodes: {
      s1: { id: 's1', type: 'screen', title: 'Home' },
      p1: { id: 'p1', type: 'portal', title: 'Ir a transferir', targetFeatureId: transferir },
    },
    edges: { e1: { id: 'e1', from: 's1', to: 'p1', kind: 'navigation' } },
    layout: { s1: { x: 0, y: 0 }, p1: { x: 320, y: 0 } },
  });

  await page.goto(appUrl);
  await page.getByRole('button', { name: 'Contexto para IA' }).click();
  const dialog = page.getByRole('dialog', { name: 'Contexto para IA de la app' });
  const preview = dialog.getByLabel('Vista previa del contexto');
  await expect(preview).toContainText('(app completa)');
  await expect(preview).toContainText('- **Inicio** → **Transferir** (por el portal «Ir a transferir»)');
  await expect(preview).toContainText('## Feature: Inicio');
  await expect(preview).toContainText('## Feature: Transferir');
  await expect(preview).toContainText('Lo primero que ve el cliente.');
  await capture(page, '2-contexto-ia-app');

  const json = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Descargar JSON' }).click();
  const file = await json;
  expect(file.suggestedFilename()).toMatch(/\.app-context\.json$/);
  const ai = JSON.parse(await readFile((await file.path())!, 'utf8')) as {
    format: string;
    features: { feature: { name: string } }[];
    map: { links: { from: string; to: string }[] };
  };
  expect(ai.format).toBe('walkie-app-ai-context');
  expect(ai.features.map((f) => f.feature.name)).toEqual(['Inicio', 'Transferir']);
  expect(ai.map.links).toEqual([{ from: 'Inicio', to: 'Transferir', via: 'Ir a transferir' }]);
});

/** Sube una imagen a la app abierta por la API (con el token de la sesión) y devuelve su id. */
async function uploadImage(page: Page, bytes: Buffer): Promise<string> {
  const appId = /apps\/([^/?#]+)/.exec(page.url())![1]!;
  return page.evaluate(
    async ({ api, appId, data }) => {
      const key = Object.keys(sessionStorage).find((k) => k.startsWith('oidc.user:'))!;
      const token = (JSON.parse(sessionStorage.getItem(key)!) as { access_token: string }).access_token;
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(data)], { type: 'image/png' }), 'pantalla.png');
      const res = await fetch(`${api}/api/apps/${appId}/assets`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      return ((await res.json()) as { id: string }).id;
    },
    { api: API, appId, data: [...bytes] },
  );
}

/** Ancho y alto de un PNG (cabecera IHDR). */
const pngSize = (buffer: Buffer) => ({ width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) });

test('imagen del lienzo: PNG de todo el lienzo a 2× y SVG con las cajas y la imagen de la pantalla', async ({ page }) => {
  await login(page);
  await openNewFeature(page, 'Iniciar sesión');
  const asset = await uploadImage(page, png(32, 24));
  await seedCanvas(page, {
    ...graph(),
    nodes: { ...graph().nodes, s1: { ...graph().nodes.s1, assetId: asset } },
  });
  await expect(page.locator('.pixel-node img')).toBeVisible();

  await page.getByRole('button', { name: 'Exportar' }).click();
  await page.getByRole('menuitem', { name: /Imagen \(PNG o SVG\)/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Imagen del lienzo' });
  await capture(page, '3-imagen');

  // PNG de todo el lienzo a 2×: más ancho que alto (tres cajas en fila) y al doble de su tamaño.
  const pngDownload = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Descargar imagen' }).click();
  const pngFile = await pngDownload;
  expect(pngFile.suggestedFilename()).toBe('iniciar-sesion@2x.png');
  const pngBytes = await readFile((await pngFile.path())!);
  if (process.env.WALKIE_CAPTURES) await pngFile.saveAs(`${process.env.WALKIE_CAPTURES}/exportar-e-importar-4-imagen-generada.png`);
  expect(pngBytes.subarray(1, 4).toString()).toBe('PNG');
  const size = pngSize(pngBytes);
  expect(size.width).toBeGreaterThan(size.height);
  expect(size.width).toBeGreaterThan(1600);
  await expect(dialog.getByRole('status')).toHaveText('Descargada: iniciar-sesion@2x.png');

  // SVG: vectorial, con los títulos de las cajas, la imagen de la pantalla incrustada y sin puntos de conexión.
  await dialog.getByRole('radio', { name: /^SVG/ }).check();
  const svgDownload = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Descargar imagen' }).click();
  const svgFile = await svgDownload;
  expect(svgFile.suggestedFilename()).toBe('iniciar-sesion.svg');
  const svg = await readFile((await svgFile.path())!, 'utf8');
  expect(svg.startsWith('<svg')).toBe(true);
  for (const title of ['Login', 'API Auth', 'Auditoría']) expect(svg).toContain(title);
  expect(svg).toContain('data:image/png;base64');
  expect(svg).not.toContain('react-flow__handle');

  // Lo visible, en PNG a 1×: del tamaño del lienzo en pantalla.
  await dialog.getByRole('radio', { name: /^PNG/ }).check();
  await dialog.getByRole('radio', { name: /^Lo que se ve/ }).check();
  await dialog.getByRole('radio', { name: /^1×/ }).check();
  const visibleDownload = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Descargar imagen' }).click();
  const visibleFile = await visibleDownload;
  expect(visibleFile.suggestedFilename()).toBe('iniciar-sesion-vista.png');
  const pane = (await page.locator('.canvas-flow .react-flow').boundingBox())!;
  expect(pngSize(await readFile((await visibleFile.path())!))).toEqual({
    width: Math.round(pane.width),
    height: Math.round(pane.height),
  });
});

test('PDF: guarda lo pendiente y descarga el documento con el lienzo y la imagen de la pantalla', async ({ page }) => {
  await login(page);
  await openNewFeature(page, 'Iniciar sesión');
  const asset = await uploadImage(page, png(32, 24));
  await seedCanvas(page, {
    ...graph(),
    nodes: { ...graph().nodes, s1: { ...graph().nodes.s1, assetId: asset } },
  });
  await expect(page.locator('.pixel-node img')).toBeVisible();

  // Un cambio sin guardar: el PDF lo guarda antes, así la imagen y el texto coinciden.
  await page.locator('.react-flow__node').filter({ hasText: 'API Auth' }).click();
  await page.getByRole('complementary', { name: 'Propiedades' }).getByLabel('Título').fill('API de autenticación');
  await expect(saveStatus(page)).toHaveText('Sin guardar');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar' }).click();
  await page.getByRole('menuitem', { name: /^PDF/ }).click();
  const file = await download;
  await expect(saveStatus(page)).toHaveText('Guardado');

  expect(file.suggestedFilename()).toBe('iniciar-sesion.pdf');
  const pdf = await readFile((await file.path())!);
  expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  // Dos imágenes: el lienzo (página apaisada) y la pantalla.
  expect(pdf.toString('latin1').match(/\/Subtype\s*\/Image/g)?.length).toBe(2);
  expect(pdf.toString('latin1')).toMatch(/\/MediaBox\s*\[\s*0\s+0\s+841\.8/);
  if (process.env.WALKIE_CAPTURES) await file.saveAs(`${process.env.WALKIE_CAPTURES}/exportar-e-importar-5.pdf`);
});

test('archivo de Walkie: manifest, lienzo guardado, imagen de la pantalla y catálogo', async ({ page }) => {
  await login(page);
  await openNewFeature(page, 'Iniciar sesión');
  await describeFeature(page, 'Iniciar sesión', 'El cliente entra con su documento.');
  const image = png(16, 12);
  const asset = await uploadImage(page, image);
  await seedCanvas(page, {
    ...graph(),
    nodes: { ...graph().nodes, s1: { ...graph().nodes.s1, assetId: asset } },
  });

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar' }).click();
  await page.getByRole('menuitem', { name: /^Archivo de Walkie/ }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('iniciar-sesion.walkie');

  const files = readZip(await readFile((await file.path())!));
  const manifest = JSON.parse(files.get('manifest.json')!.toString('utf8')) as {
    format: string;
    scope: string;
    features: { id: string; name: string; description: string; canvas: string }[];
    images: { assetId: string; path: string }[];
    catalog: { count: number };
  };
  expect(manifest).toMatchObject({ format: 'walkie-package', scope: 'feature', catalog: { count: 0 } });
  const [feature] = manifest.features;
  expect(feature).toMatchObject({ name: 'Iniciar sesión', description: 'El cliente entra con su documento.' });
  const canvas = JSON.parse(files.get(feature!.canvas)!.toString('utf8')) as { nodes: Record<string, { title: string }> };
  expect(Object.values(canvas.nodes).map((n) => n.title).sort()).toEqual(['API Auth', 'Auditoría', 'Login']);
  expect(manifest.images).toEqual([{ assetId: asset, path: `img/${asset}.png`, contentType: 'image/png' }]);
  expect(files.get(`img/${asset}.png`)!.equals(image)).toBe(true);
  expect(JSON.parse(files.get('catalog.json')!.toString('utf8'))).toEqual([]);
});
