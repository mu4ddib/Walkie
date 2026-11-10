import { expect, test, type Page } from '@playwright/test';
import { login, openNewFeature, saveStatus } from './helpers';

/**
 * Feature recorridos-y-grupos (docs/features/recorridos-y-grupos/spec.md) con API, Keycloak y Postgres reales.
 * Los lienzos se siembran por la API (PUT del grafo con el token de la sesión) y se usan desde la interfaz.
 * Datos ficticios.
 */

const API = process.env.VITE_API_URL ?? 'http://localhost:5080';

/** Con `WALKIE_CAPTURES=<carpeta>`, guarda capturas para revisar el resultado visual. */
async function capture(page: Page, name: string) {
  const dir = process.env.WALKIE_CAPTURES;
  if (dir) await page.screenshot({ path: `${dir}/recorridos-y-grupos-${name}.png` });
}

/** Guarda `graph` como lienzo de la feature abierta (con la versión actual) y recarga la página. */
async function seedCanvas(page: Page, graph: Record<string, unknown>) {
  const featureId = /features\/([^/?#]+)/.exec(page.url())![1]!;
  const status = await page.evaluate(
    async ({ api, featureId, graph }) => {
      const key = Object.keys(sessionStorage).find((k) => k.startsWith('oidc.user:'))!;
      const token = (JSON.parse(sessionStorage.getItem(key)!) as { access_token: string }).access_token;
      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      const url = `${api}/api/features/${featureId}/canvas`;
      const current = (await (await fetch(url, { headers })).json()) as { version: number };
      const put = await fetch(url, { method: 'PUT', headers, body: JSON.stringify({ ...graph, version: current.version }) });
      return put.status;
    },
    { api: API, featureId, graph },
  );
  expect(status).toBe(200);
  await page.reload();
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  // La vista recordada es la del lienzo vacío: «Ver todo» encuadra lo sembrado (ya medido).
  await page.waitForTimeout(500);
  await page.keyboard.press('0');
  await page.waitForTimeout(500);
}

const box = (page: Page, title: string) =>
  page.locator('.react-flow__node').filter({ has: page.locator('.pixel-node-title', { hasText: new RegExp(`^${title}$`) }) });
const group = (page: Page, title: string) =>
  page.locator('.group-node').filter({ has: page.locator('.group-node-title', { hasText: new RegExp(`^${title}$`) }) });
const edges = (page: Page) => page.locator('.react-flow__edge');
const label = (page: Page, edgeId: string) => page.locator(`.kind-edge-label[data-edge-id="${edgeId}"]`);

/** Arrastra un grupo por su encabezado. */
async function dragGroup(page: Page, title: string, dx: number, dy: number) {
  const h = (await group(page, title).locator('.group-node-header').boundingBox())!;
  await page.mouse.move(h.x + 30, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + 30 + dx, h.y + h.height / 2 + dy, { steps: 12 });
}

/** AWS ⊃ microservicio usuarios ⊃ datos, con una pantalla fuera y un grupo Externos aparte. */
function nestedGraph(legacy = false) {
  const graph: Record<string, unknown> = {
    schemaVersion: 0,
    nodes: {
      s: { id: 's', type: 'screen', title: 'Creación de cuenta' },
      gw: { id: 'gw', type: 'api', title: 'Gateway', groupId: 'aws' },
      apiU: { id: 'apiU', type: 'api', title: 'API crear usuario', groupId: 'users' },
      db: { id: 'db', type: 'database', title: 'BD usuarios', groupId: 'data' },
      ext: { id: 'ext', type: 'service', title: 'Proveedor SMS', groupId: 'extg' },
    },
    edges: {
      e1: { id: 'e1', from: 's', to: 'apiU', kind: 'request' },
      e2: { id: 'e2', from: 's', to: 'gw', kind: 'request' },
      e3: { id: 'e3', from: 'apiU', to: 'db', kind: 'writes' },
      e4: { id: 'e4', from: 'gw', to: 'apiU', kind: 'request' },
      e5: { id: 'e5', from: 'apiU', to: 'ext', kind: 'event' },
    },
    layout: {
      s: { x: -400, y: 200 },
      aws: { x: 0, y: 0, w: 1100, h: 700 },
      users: { x: 40, y: 80, w: 700, h: 580 },
      data: { x: 80, y: 360, w: 400, h: 240 },
      extg: { x: 1300, y: 0, w: 400, h: 300 },
      gw: { x: 840, y: 160 },
      apiU: { x: 80, y: 160 },
      db: { x: 120, y: 440 },
      ext: { x: 1340, y: 120 },
      k1: { x: 400, y: 160 },
    },
    groups: {
      aws: { id: 'aws', title: 'AWS', kind: 'cloud' },
      users: { id: 'users', title: 'microservicio usuarios', kind: 'backend', ...(legacy ? {} : { parentId: 'aws' }) },
      data: { id: 'data', title: 'datos', kind: 'data', ...(legacy ? {} : { parentId: 'users' }) },
      extg: { id: 'extg', title: 'Externos', kind: 'external' },
    },
    stickyNotes: { k1: { id: 'k1', text: 'Escala con la demanda', ...(legacy ? {} : { groupId: 'users' }) } },
  };
  if (!legacy) graph.groupNesting = 'explicit';
  return graph;
}

test('grupos anidados: plegar, mover, expandir, conexiones, meter y sacar, guardar y recargar', async ({ page }) => {
  await login(page);
  await openNewFeature(page, 'Alta de usuario');
  await seedCanvas(page, nestedGraph());
  await expect(edges(page)).toHaveCount(5);

  // «datos» plegado; luego AWS plegado: se oculta todo lo de dentro (grupos, nodos y la nota).
  await page.getByRole('button', { name: 'Plegar grupo datos' }).click();
  await expect(box(page, 'BD usuarios')).toBeHidden();
  await expect(edges(page)).toHaveCount(5); // e3 llega a «datos» plegado.
  await page.getByRole('button', { name: 'Plegar grupo AWS' }).click();
  await expect(group(page, 'microservicio usuarios')).toBeHidden();
  await expect(group(page, 'datos')).toBeHidden();
  await expect(box(page, 'API crear usuario')).toBeHidden();
  await expect(page.getByText('Escala con la demanda')).toBeHidden();
  await expect(group(page, 'AWS')).toContainText('3 nodos · 2 grupos');
  await capture(page, '1-aws-plegado');
  // Internas (e3, e4) ocultas; Creación de cuenta → AWS (e1, e2) y AWS → Proveedor SMS (e5), cada una en su carril.
  await expect(edges(page)).toHaveCount(3);
  await expect(label(page, 'e1')).toBeVisible();
  await expect(label(page, 'e2')).toBeVisible();
  // Entre dos grupos plegados.
  await page.getByRole('button', { name: 'Plegar grupo Externos' }).click();
  await expect(edges(page)).toHaveCount(3);
  await expect(label(page, 'e5')).toBeVisible();
  await page.getByRole('button', { name: 'Desplegar grupo Externos' }).click();

  // Mover AWS plegado: sus descendientes ocultos se mueven igual.
  const before = (await page.locator('.react-flow__viewport').evaluate((el) => getComputedStyle(el).transform)) as string;
  const zoom = Number(/matrix\(([^,]+)/.exec(before)?.[1] ?? 1);
  await dragGroup(page, 'AWS', 160, 80);
  await page.mouse.up();
  await page.getByRole('button', { name: 'Desplegar grupo AWS' }).click();
  // «datos» sigue plegado: su estado se conservó.
  await expect(group(page, 'microservicio usuarios')).toBeVisible();
  await expect(group(page, 'datos').locator('xpath=.')).toHaveAttribute('data-collapsed', 'true');
  await page.getByRole('button', { name: 'Desplegar grupo datos' }).click();
  const api = (await box(page, 'API crear usuario').boundingBox())!;
  const db = (await box(page, 'BD usuarios').boundingBox())!;
  // Misma distancia interna que en el grafo sembrado (40, 280), en px de pantalla.
  expect(Math.round((db.x - api.x) / zoom)).toBe(40);
  expect(Math.round((db.y - api.y) / zoom)).toBe(280);
  const screen = (await box(page, 'Creación de cuenta').boundingBox())!;
  expect(Math.round((api.x - screen.x) / zoom)).toBeGreaterThan(480 + 100);

  // Meter Externos en AWS: mientras se arrastra se indica la pertenencia resultante; al soltar, queda dentro.
  const aws = (await group(page, 'AWS').boundingBox())!;
  const ext = (await group(page, 'Externos').boundingBox())!;
  await dragGroup(page, 'Externos', aws.x + aws.width - 380 - ext.x, aws.y + 40 - ext.y);
  await expect(page.locator('.canvas-hint')).toContainText('Suelta para meter «Externos» en «AWS»');
  await expect(group(page, 'AWS')).toHaveAttribute('data-drop-target', 'true');
  await capture(page, '2-meter-grupo');
  await page.mouse.up();
  await expect(page.locator('.canvas-hint')).toContainText('«Externos» quedó dentro de «AWS»');
  await expect(group(page, 'AWS')).toContainText('4 nodos · 3 grupos');

  // Sin ciclos: AWS no puede quedar dentro de un grupo suyo.
  await group(page, 'AWS').locator('.group-node-title').click();
  const inspector = page.getByRole('complementary', { name: 'Propiedades' });
  const parent = inspector.getByLabel('Dentro del grupo');
  await expect(parent.locator('option')).toHaveText(['— Ninguno (suelto en el lienzo)']);
  // Sacar «datos» de su grupo desde el inspector: sube un nivel.
  await group(page, 'datos').locator('.group-node-title').click();
  await expect(inspector.getByText('Dentro de AWS › microservicio usuarios')).toBeVisible();
  await inspector.getByLabel('Dentro del grupo').selectOption({ label: 'AWS' });

  // Guardar y recargar: jerarquía, posiciones y plegados vuelven iguales.
  await page.getByRole('button', { name: 'Plegar grupo datos' }).click();
  await page.getByRole('button', { name: 'Plegar grupo AWS' }).click();
  await page.keyboard.press('Control+s');
  await expect(saveStatus(page)).toHaveText('Guardado');
  await page.reload();
  await expect(group(page, 'AWS')).toHaveAttribute('data-collapsed', 'true');
  await expect(group(page, 'Externos')).toBeHidden();
  await page.getByRole('button', { name: 'Desplegar grupo AWS' }).click();
  await expect(group(page, 'datos')).toHaveAttribute('data-collapsed', 'true');
  await expect(group(page, 'Externos')).toBeVisible();
  await group(page, 'datos').locator('.group-node-title').click();
  await expect(inspector.getByLabel('Dentro del grupo')).toHaveValue('aws');
});

test('un lienzo anterior (sin jerarquía guardada) se abre con la jerarquía inferida', async ({ page }) => {
  await login(page);
  await openNewFeature(page, 'Lienzo anterior');
  await seedCanvas(page, nestedGraph(true));

  await page.getByRole('button', { name: 'Plegar grupo AWS' }).click();
  await expect(group(page, 'microservicio usuarios')).toBeHidden();
  await expect(box(page, 'API crear usuario')).toBeHidden();
  await expect(page.getByText('Escala con la demanda')).toBeHidden();
  // Externos solo estaba al lado: sigue suelto.
  await expect(group(page, 'Externos')).toBeVisible();
});

/** Pantalla → API → Servicio → BD → Servicio → API → Pantalla, una decisión con dos ramas y un tour clásico. */
function flowGraph() {
  return {
    schemaVersion: 0,
    nodes: {
      s: { id: 's', type: 'screen', title: 'Creación de cuenta' },
      a: { id: 'a', type: 'api', title: 'API usuarios', groupId: 'back' },
      sv: { id: 'sv', type: 'service', title: 'Servicio usuarios', groupId: 'back' },
      db: { id: 'db', type: 'database', title: 'BD usuarios', groupId: 'back' },
      d: {
        id: 'd',
        type: 'rule',
        title: '¿Correo libre?',
        mode: 'decision',
        branches: [
          { id: 'yes', label: 'Sí' },
          { id: 'no', label: 'No' },
        ],
      },
      ok: { id: 'ok', type: 'screen', title: 'Cuenta creada' },
      err: { id: 'err', type: 'screen', title: 'Correo en uso' },
    },
    edges: {
      r1: { id: 'r1', from: 's', to: 'a', kind: 'request' },
      r2: { id: 'r2', from: 'a', to: 'sv', kind: 'request' },
      q1: { id: 'q1', from: 'sv', to: 'db', kind: 'reads' },
      q2: { id: 'q2', from: 'db', to: 'sv', kind: 'response' },
      p2: { id: 'p2', from: 'sv', to: 'a', kind: 'response', replyTo: 'r2', status: 200 },
      p1: { id: 'p1', from: 'a', to: 's', kind: 'response', replyTo: 'r1', status: 201 },
      dd: { id: 'dd', from: 's', to: 'd', kind: 'uses' },
      by: { id: 'by', from: 'd', to: 'ok', kind: 'uses', branch: 'yes' },
      bn: { id: 'bn', from: 'd', to: 'err', kind: 'uses', branch: 'no' },
    },
    layout: {
      s: { x: 0, y: 200 },
      back: { x: 320, y: 0, w: 1100, h: 480 },
      a: { x: 360, y: 200 },
      sv: { x: 720, y: 200 },
      db: { x: 1100, y: 200 },
      d: { x: 0, y: 640 },
      ok: { x: 400, y: 560 },
      err: { x: 400, y: 760 },
    },
    groups: { back: { id: 'back', title: 'Backend', kind: 'backend' } },
    groupNesting: 'explicit',
    tours: { t0: { id: 't0', name: 'Tour clásico', steps: [{ nodeId: 's', note: 'Aquí empieza' }, { nodeId: 'a' }] } },
  };
}

test('recorridos: crear con varias conexiones, ramas, reproducir con grupos plegados y resolver un paso eliminado', async ({
  page,
}) => {
  await login(page);
  await openNewFeature(page, 'Alta con recorrido');
  await seedCanvas(page, flowGraph());
  const inspector = page.getByRole('complementary', { name: 'Propiedades' });

  // Mayús + clic suma conexiones (en desorden); la barra contextual ofrece «Crear recorrido».
  await label(page, 'p1').click();
  for (const id of ['q2', 'r1', 'p2', 'q1', 'r2']) await label(page, id).click({ modifiers: ['Shift'] });
  const bar = page.getByRole('toolbar', { name: 'Conexiones seleccionadas' });
  await expect(bar).toContainText('6 conexiones seleccionadas');
  await bar.getByRole('button', { name: 'Crear recorrido' }).click();

  // Se abre el editor con el orden sugerido (único) y el nombre listo para escribir.
  await expect(inspector.getByLabel('Nombre del recorrido')).toBeFocused();
  await inspector.getByLabel('Nombre del recorrido').fill('Alta exitosa');
  await expect(inspector.getByText('✓ Los pasos están encadenados.')).toBeVisible();
  const steps = inspector.getByRole('list', { name: 'Pasos' });
  const expected = [
    'Creación de cuenta → API usuarios',
    'API usuarios → Servicio usuarios',
    'Servicio usuarios → BD usuarios',
    'BD usuarios → Servicio usuarios',
    'Servicio usuarios → API usuarios · responde 200',
    'API usuarios → Creación de cuenta · responde 201',
  ];
  for (const [i, text] of expected.entries()) {
    await expect(steps.getByRole('listitem', { name: `Paso ${i + 1}` })).toContainText(text);
  }
  await inspector.getByLabel('Paso 1: descripción').fill('Envía el formulario de alta');
  // Siguiente paso: la decisión y luego su rama «Sí» (dos continuaciones posibles: decide el usuario).
  await inspector.getByRole('button', { name: /Siguiente paso: Creación de cuenta → ¿Correo libre\?/ }).click();
  await expect(inspector.getByText('2 continuaciones posibles desde «¿Correo libre?»')).toBeVisible();
  await inspector.getByRole('button', { name: /Siguiente paso: ¿Correo libre\? → Cuenta creada/ }).click();
  await expect(steps.getByRole('listitem', { name: 'Paso 8' })).toContainText('Rama elegida en la decisión: «Sí»');
  await capture(page, '3-editor-recorrido');

  // Segundo recorrido desde una conexión, con la otra rama, agregando el paso desde el lienzo.
  await inspector.getByRole('button', { name: '← Todos los tours' }).click();
  await label(page, 'dd').click();
  await inspector.getByRole('button', { name: 'Crear recorrido desde aquí' }).click();
  await inspector.getByLabel('Nombre del recorrido').fill('Correo repetido');
  await inspector.getByRole('button', { name: '＋ Elegir pasos en el lienzo' }).click();
  await expect(page.locator('.canvas-hint')).toContainText('Agregando pasos a «Correo repetido»');
  await expect(page.locator('[data-testid="rf__edge-bn"]')).toHaveClass(/flow-candidate/);
  await label(page, 'bn').click();
  await expect(steps.getByRole('listitem', { name: 'Paso 2' })).toContainText('Rama elegida en la decisión: «No»');
  await page.keyboard.press('Escape');

  // Plegar Backend y guardar: la reproducción no debe tocar lo guardado.
  await inspector.getByRole('button', { name: '← Todos los tours' }).click();
  await page.getByRole('button', { name: 'Plegar grupo Backend' }).click();
  await page.keyboard.press('Control+s');
  await expect(saveStatus(page)).toHaveText('Guardado');

  // Reproducir: pausar, avanzar por pasos, velocidad, encuadrar y detener.
  await inspector.getByRole('button', { name: 'Alta exitosa' }).click();
  await inspector.getByRole('button', { name: '▶ Reproducir recorrido' }).click();
  const player = page.getByRole('region', { name: 'Reproducción del recorrido' });
  await expect(player).toContainText('Alta exitosa');
  await expect(player.getByRole('status')).toHaveText('Paso 1 de 8');
  await expect(player).toContainText('Envía el formulario de alta');
  await player.getByRole('button', { name: '⏸ Pausar' }).click();
  await player.getByRole('button', { name: 'Paso siguiente' }).click();
  await expect(player.getByRole('status')).toHaveText('Paso 2 de 8');
  await expect(player).toContainText('API usuarios → Servicio usuarios');
  // Backend se despliega solo en la vista para mostrar el paso; lo ajeno se atenúa.
  await expect(group(page, 'Backend')).not.toHaveAttribute('data-collapsed', 'true');
  await expect(page.locator('[data-testid="rf__edge-r2"]')).toHaveClass(/flow-edge-active/);
  await expect(box(page, 'Cuenta creada').or(page.locator('.react-flow__node.flow-dim')).first()).toBeVisible();
  await expect(box(page, 'Correo en uso')).toHaveClass(/flow-dim/);
  await expect(box(page, 'Servicio usuarios')).toHaveClass(/flow-target/, { timeout: 10_000 });
  await capture(page, '4-reproduccion');
  await player.getByRole('button', { name: 'Paso anterior' }).click();
  await expect(player.getByRole('status')).toHaveText('Paso 1 de 8');
  await player.getByLabel('Velocidad').selectOption('2');
  await player.getByRole('button', { name: '⛶ Encuadrar recorrido' }).click();
  await player.getByRole('button', { name: /Continuar/ }).click();
  await expect(player.getByRole('status')).toHaveText('Paso 3 de 8', { timeout: 15_000 });
  await player.getByRole('button', { name: '■ Detener' }).click();
  await expect(player).toBeHidden();
  // Restaurado: Backend vuelve a verse plegado y no hay cambios sin guardar.
  await expect(group(page, 'Backend')).toHaveAttribute('data-collapsed', 'true');
  await expect(saveStatus(page)).toHaveText('Guardado');

  // Un tour guardado antes de estos cambios se sigue reproduciendo con el guía.
  await inspector.getByRole('button', { name: '← Todos los tours' }).click();
  await inspector.getByRole('button', { name: 'Tour clásico' }).click();
  await inspector.getByRole('button', { name: 'Ver tour' }).click();
  await expect(page.getByRole('toolbar', { name: 'Tour' })).toContainText('Paso 1 de 2');
  await page.getByRole('toolbar', { name: 'Tour' }).getByRole('button', { name: 'Salir' }).click();

  // Eliminar una conexión usada: aviso, paso marcado y se resuelve quitándolo.
  await page.getByRole('button', { name: 'Desplegar grupo Backend' }).click();
  await label(page, 'r2').click();
  await page.keyboard.press('Delete');
  await expect(page.locator('.canvas-hint')).toContainText('se usaba en «Alta exitosa»');
  // Clic en el borde superior del lienzo (libre tras «Ver todo»): nada seleccionado, el inspector muestra los tours.
  const paneBox = (await page.locator('.react-flow__pane').boundingBox())!;
  await page.mouse.click(paneBox.x + paneBox.width * 0.4, paneBox.y + 12);
  await inspector.getByRole('button', { name: '← Todos los tours' }).click();
  await expect(inspector.getByText('⚠ 1 paso por revisar')).toBeVisible();
  await inspector.getByRole('button', { name: 'Alta exitosa' }).click();
  await expect(steps.getByRole('listitem', { name: 'Paso 2' })).toContainText('Conexión eliminada: API usuarios → Servicio usuarios');
  await capture(page, '5-paso-eliminado');
  await inspector.getByRole('button', { name: 'Quitar paso 2' }).click();
  await expect(steps.getByRole('listitem', { name: 'Paso 2' })).toContainText('Salto');

  // Guardar y recargar: los recorridos vuelven con sus pasos.
  await page.keyboard.press('Control+s');
  await expect(saveStatus(page)).toHaveText('Guardado');
  await page.reload();
  await expect(inspector.getByText('Correo repetido')).toBeVisible();
  await inspector.getByRole('button', { name: 'Alta exitosa' }).click();
  await expect(steps.getByRole('listitem')).toHaveCount(7);
});
