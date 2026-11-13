import { expect, test, type Page } from '@playwright/test';
import { dropNode, login, openNewFeature, rename, saveStatus, seedCanvas } from './helpers';

/**
 * Feature interacciones (docs/features/interacciones/spec.md, ADR-0011) con API, Keycloak y Postgres reales: la
 * operación como fuente de verdad, retornos de cualquier intercambio, escenarios, mensajería por etapas, timeout y
 * contradicciones. Datos ficticios.
 */
/** Con `WALKIE_CAPTURES=<carpeta>`, guarda capturas para revisar el resultado visual. */
async function capture(page: Page, name: string) {
  const dir = process.env.WALKIE_CAPTURES;
  if (dir) await page.screenshot({ path: `${dir}/interacciones-${name}.png` });
}

const node = (page: Page, title: string) =>
  page.locator('.react-flow__node').filter({ has: page.locator('.pixel-node-title', { hasText: new RegExp(`^${title}$`) }) });
const inspector = (page: Page) => page.getByRole('complementary', { name: 'Propiedades' });
const labels = (page: Page) => page.locator('.kind-edge-label');
const label = (page: Page, edgeId: string) => page.locator(`.kind-edge-label[data-edge-id="${edgeId}"]`);
const operation = (page: Page) => inspector(page).getByLabel('Operación', { exact: true });
/** Textos de las etiquetas, ordenados (el lienzo pone cada retorno junto a su operación). */
const labelTexts = (page: Page) => labels(page).evaluateAll((ls) => ls.map((l) => l.textContent ?? '').sort());
const clearSelection = (page: Page) => page.locator('.react-flow__pane').click({ position: { x: 300, y: 730 } });

async function drag(page: Page, from: ReturnType<Page['locator']>, to: ReturnType<Page['locator']>) {
  const source = (await from.boundingBox())!;
  const target = (await to.boundingBox())!;
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 });
  await page.mouse.up();
}

const connect = (page: Page, from: string, to: string) =>
  drag(page, node(page, from).locator('.react-flow__handle-right').first(), node(page, to).locator('.react-flow__handle-left'));

test('Pantalla → API → BD → API → Pantalla: cada tramo con su operación, sus datos y sus retornos', async ({ page }) => {
  await login(page);
  await openNewFeature(page, 'Consulta de saldo');
  await dropNode(page, 'Pantalla', 120, 200);
  await dropNode(page, 'API', 380, 200);
  await dropNode(page, 'Base de datos', 640, 200);
  await rename(page, 0, 'Saldo');
  await rename(page, 1, 'API Cuentas');
  await rename(page, 2, 'BD Cuentas');

  // Al conectar, la conexión nace con la operación más probable y ofrece las otras del par (sin seleccionarla).
  await connect(page, 'Saldo', 'API Cuentas');
  await expect(labels(page)).toHaveText(['llama']);
  await connect(page, 'API Cuentas', 'BD Cuentas');
  const suggestions = page.getByRole('toolbar', { name: 'Operaciones sugeridas' });
  await expect(suggestions.getByRole('button', { name: 'Consultar' })).toHaveAttribute('aria-pressed', 'true');
  await capture(page, '1-sugerencias');
  await suggestions.getByRole('button', { name: 'Escribir' }).click();
  await expect(suggestions).toBeHidden();
  await expect(labels(page)).toHaveText(['llama', 'escribe']);

  // En el inspector: la operación es la única fuente de verdad (no hay «Tipo» ni acceso a datos aparte).
  await labels(page).nth(1).click();
  await expect(operation(page)).toHaveValue('db.write');
  await expect(inspector(page).getByLabel('Tipo', { exact: true })).toHaveCount(0);
  await operation(page).selectOption('db.query');
  await inspector(page).getByLabel('Tecnología').fill('PostgreSQL');
  await inspector(page).locator('summary', { hasText: 'Comando o query' }).click();
  await inspector(page).getByLabel('Comando', { exact: true }).fill('SELECT saldo FROM cuentas WHERE id = :cuenta');
  // Sin documentar `:cuenta`, se avisa (no bloquea); al agregarlo en «Parámetros», el aviso se va.
  await expect(inspector(page).getByRole('list', { name: 'Revisar la sintaxis' })).toContainText(':cuenta');
  await inspector(page).locator('summary', { hasText: 'Parámetros' }).click();
  await inspector(page).getByRole('button', { name: '+ Parámetro' }).click();
  await inspector(page).getByLabel('Nombre', { exact: true }).fill('cuenta');
  await expect(inspector(page).getByRole('list', { name: 'Revisar la sintaxis' })).toHaveCount(0);
  await inspector(page).locator('summary', { hasText: 'Timeout y reintentos' }).click();
  await inspector(page).getByLabel('Timeout (ms)').fill('3000');
  await inspector(page).getByLabel('Reintentos (cantidad)').fill('1');
  await capture(page, '2-inspector-consulta');
  // Una consulta tiene resultados, no «respuestas».
  await expect(inspector(page).getByRole('button', { name: /Añadir respuesta/ })).toHaveCount(0);
  await inspector(page).getByRole('button', { name: '+ Añadir resultado' }).click();
  await expect(inspector(page).getByRole('heading', { name: 'Retorno' })).toBeVisible();
  await inspector(page).getByRole('button', { name: 'Ir a la operación' }).click();
  await inspector(page).getByRole('button', { name: 'Añadir retorno resultado vacío' }).click();
  await inspector(page).getByLabel('Descripción del resultado').fill('La cuenta no existe');
  await clearSelection(page);
  await expect.poll(() => labelTexts(page)).toEqual(['consulta', 'devuelve · resultado', 'devuelve · resultado vacío', 'llama']);

  // La API responde a la pantalla (HTTP: con su código).
  await labels(page).filter({ hasText: /^llama$/ }).click();
  await inspector(page).getByRole('button', { name: '+ Añadir respuesta' }).click();
  await inspector(page).getByLabel('Código HTTP').fill('200');
  await clearSelection(page);
  await expect(labels(page).filter({ hasText: 'responde 200' })).toHaveCount(1);

  // Previsualizar con varias alternativas: se elige el escenario (o el timeout).
  // Seleccionada, la etiqueta es un selector: se la ubica por su id.
  const queryId = await labels(page).filter({ hasText: /^consulta$/ }).getAttribute('data-edge-id');
  const query = label(page, queryId!);
  await query.click();
  const scenario = inspector(page).getByLabel('Escenario');
  await capture(page, '3-escenarios');
  await expect(scenario.locator('option')).toHaveText(['resultado', 'resultado vacío · La cuenta no existe', 'Timeout (no llega respuesta)']);
  await scenario.selectOption({ label: 'resultado vacío · La cuenta no existe' });
  await inspector(page).getByRole('button', { name: '▶ Previsualizar interacción' }).click();
  await expect(page.locator('.canvas-hint')).toContainText('Previsualizando · 1 de 2');
  await expect(page.locator('.canvas-hint')).toContainText('resultado vacío', { timeout: 5000 });
  await page.keyboard.press('Escape');
  await scenario.selectOption({ label: 'Timeout (no llega respuesta)' });
  await inspector(page).getByRole('button', { name: '▶ Previsualizar interacción' }).click();
  // Se simula cada intento: la ida, la espera de su timeout y, tras el último, el timeout.
  await expect(page.locator('.canvas-hint')).toContainText('espera respuesta de «BD Cuentas» · 3000 ms (intento 1 de 2)', {
    timeout: 5000,
  });
  await expect(page.locator('.canvas-hint')).toContainText('(intento 2 de 2)', { timeout: 8000 });
  await expect(page.locator('.canvas-hint')).toContainText('termina por timeout', { timeout: 8000 });
  await page.keyboard.press('Escape');

  // Desde la pantalla, la cadena completa: Pantalla → API → BD → API → Pantalla.
  const callId = await labels(page).filter({ hasText: /^llama$/ }).getAttribute('data-edge-id');
  await label(page, callId!).click();
  await expect(inspector(page).getByLabel(/Con lo que ocurre dentro/)).toBeChecked();
  await inspector(page).getByRole('button', { name: '▶ Previsualizar interacción' }).click();
  await expect(page.locator('.canvas-hint')).toContainText('Previsualizando · 1 de 4: Saldo → API Cuentas');
  await expect(page.locator('.canvas-hint')).toContainText('2 de 4: API Cuentas → BD Cuentas', { timeout: 5000 });
  await expect(page.locator('.canvas-hint')).toContainText('3 de 4: BD Cuentas → API Cuentas', { timeout: 5000 });
  await expect(page.locator('.canvas-hint')).toContainText('4 de 4: API Cuentas → Saldo (responde 200)', { timeout: 5000 });
  await page.keyboard.press('Escape');
  await query.click();

  // Invertir la operación invierte también sus retornos (siguen saliendo de quien responde).
  const [, apiId, dbId] = await page.locator('.react-flow__node').evaluateAll((ns) => ns.map((n) => n.getAttribute('data-id')));
  const emptyId = await labels(page).filter({ hasText: 'resultado vacío' }).getAttribute('data-edge-id');
  const result = page.locator(`[data-testid="rf__edge-${emptyId}"]`);
  await query.click();
  await inspector(page).getByRole('button', { name: /Invertir sentido/ }).click();
  await expect(result).toHaveAttribute('aria-label', `Edge from ${apiId} to ${dbId}`);
  await inspector(page).getByRole('button', { name: /Invertir sentido/ }).click();
  await expect(result).toHaveAttribute('aria-label', `Edge from ${dbId} to ${apiId}`);

  // Guardar y recargar: todo vuelve igual.
  await page.keyboard.press('Control+s');
  await expect(saveStatus(page)).toHaveText('Guardado');
  await page.reload();
  await expect(saveStatus(page)).toHaveText('Al día');
  await expect
    .poll(() => labelTexts(page))
    .toEqual(['consulta', 'devuelve · resultado', 'devuelve · resultado vacío', 'llama', 'responde 200']);
  await query.click();
  await expect(operation(page)).toHaveValue('db.query');
  await expect(inspector(page).getByLabel('Comando', { exact: true })).toHaveValue('SELECT saldo FROM cuentas WHERE id = :cuenta');
  await expect(inspector(page).getByLabel('Tecnología')).toHaveValue('PostgreSQL');

  // Borrar la operación deja sus retornos sin vínculo y lo dice.
  await query.click();
  // Seleccionada, la etiqueta es un selector con el foco: se suelta para que la tecla llegue al lienzo.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Delete');
  await expect(page.locator('.canvas-hint')).toContainText('retornos quedaron sin operación asociada');
  await page.keyboard.press('Control+z');
  await expect(labels(page)).toHaveCount(5);
});

/** Mensajería por etapas, contradicción heredada, fan-out y timeout en un recorrido (lienzo sembrado). */
function messagingGraph() {
  const n = (id: string, type: string, title: string, x: number, y: number, extra: Record<string, unknown> = {}) => ({
    node: { id, type, title, ...extra },
    at: { [id]: { x, y } },
  });
  const parts = [
    n('pago', 'service', 'Servicio de pagos', 0, 0),
    n('topico', 'resource', 'pagos.solicitados', 320, 0, { resource: { kind: 'topic' } }),
    n('antifraude', 'service', 'Antifraude', 640, 0),
    n('bd', 'database', 'BD Pagos', 320, 240),
  ];
  return {
    schemaVersion: 0,
    nodes: Object.fromEntries(parts.map((p) => [p.node.id, p.node])),
    layout: Object.assign({}, ...parts.map((p) => p.at)),
    edges: {
      pub: { id: 'pub', from: 'pago', to: 'topico', kind: 'event', operation: 'message.publish', pattern: 'pub-sub' },
      ack: { id: 'ack', from: 'topico', to: 'pago', kind: 'response', replyTo: 'pub', result: { type: 'ack' } },
      del: { id: 'del', from: 'topico', to: 'antifraude', kind: 'event', operation: 'message.deliver' },
      rep: { id: 'rep', from: 'antifraude', to: 'pago', kind: 'event', operation: 'message.reply', correlatesWith: 'pub' },
      // Conexión anterior: el tipo dice «lee» y el acceso a datos «escribe».
      old: { id: 'old', from: 'pago', to: 'bd', kind: 'reads', data: { operation: 'write', entities: ['pagos'] } },
    },
    tours: {
      f: {
        id: 'f',
        name: 'Pago',
        kind: 'flow',
        steps: [
          { id: 's1', edgeId: 'pub' },
          { id: 's2', edgeId: 'old', parallel: true },
          { id: 's3', edgeId: 'del' },
          { id: 's4', edgeId: 'rep', timeout: true },
        ],
      },
    },
  };
}

test('mensajería por etapas, contradicción señalada y recorrido con fan-out y timeout', async ({ page }) => {
  await login(page);
  await openNewFeature(page, 'Pagos');
  await seedCanvas(page, messagingGraph());

  await expect(label(page, 'pub')).toHaveText('publica');
  await expect(label(page, 'ack')).toHaveText('confirma · confirmación');
  await expect(label(page, 'del')).toHaveText('entrega');
  await expect(label(page, 'rep')).toHaveText('responde');
  // Lo anterior se sigue viendo como era.
  await expect(label(page, 'old')).toHaveText('lee');

  // La publicación ofrece la confirmación del broker y muestra la respuesta correlacionada.
  await label(page, 'pub').click();
  await expect(inspector(page).getByRole('button', { name: '+ Añadir confirmación del broker' })).toBeVisible();
  await expect(inspector(page).getByRole('region', { name: 'Retornos' })).toContainText('Respuestas correlacionadas');
  await label(page, 'del').click();
  await expect(inspector(page).getByRole('button', { name: '+ Añadir reconocimiento del consumidor' })).toBeVisible();
  await label(page, 'rep').click();
  await expect(inspector(page).getByLabel('Operación original')).toHaveValue('pub');

  // Contradicción: se señala y se elige, sin deducir.
  await label(page, 'old').click();
  await expect(inspector(page).getByRole('alert')).toContainText('Necesita revisión');
  await capture(page, '4-revision');
  await inspector(page).getByRole('button', { name: 'Escribir', exact: true }).click();
  await expect(inspector(page).getByRole('alert')).toHaveCount(0);
  await clearSelection(page);
  await expect(label(page, 'old')).toHaveText('escribe');

  // Recorrido: el paso 2 ocurre a la vez que el 1 y el 4 termina en timeout.
  await clearSelection(page);
  await inspector(page).getByRole('tab', { name: /Recorridos/ }).click();
  await inspector(page).getByRole('button', { name: 'Pago' }).click();
  const steps = inspector(page).getByRole('list', { name: 'Pasos' });
  await expect(steps.getByRole('listitem', { name: 'Paso 2' })).toContainText('a la vez');
  await expect(steps.getByRole('listitem', { name: 'Paso 2' })).not.toContainText('Salto');
  await expect(steps.getByRole('listitem', { name: 'Paso 4' })).toContainText('timeout');
  await inspector(page).getByRole('button', { name: '▶ Reproducir recorrido' }).click();
  const player = page.getByRole('region', { name: 'Reproducción del recorrido' });
  await player.getByRole('button', { name: '⏸ Pausar' }).click();
  await expect(player).toContainText('a la vez: Servicio de pagos → BD Pagos');
  await expect(page.locator('[data-testid="rf__edge-pub"]')).toHaveClass(/flow-edge-active/);
  await expect(page.locator('[data-testid="rf__edge-old"]')).toHaveClass(/flow-edge-active/);
  await player.getByRole('button', { name: 'Paso siguiente' }).click();
  await player.getByRole('button', { name: 'Paso siguiente' }).click();
  await expect(player).toContainText('quien espera termina por timeout');
  await expect(node(page, 'Antifraude')).toHaveClass(/flow-timeout/, { timeout: 10_000 });
  await capture(page, '5-timeout');
});
