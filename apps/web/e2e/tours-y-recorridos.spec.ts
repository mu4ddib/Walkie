import { expect, test, type Page } from '@playwright/test';
import { login, openNewFeature, seedCanvas } from './helpers';

/**
 * Feature tours-y-recorridos (docs/features/tours-y-recorridos/spec.md) con API, Keycloak y Postgres reales: tours y
 * recorridos en pestañas separadas, cada uno con su editor, y el inspector sin desborde horizontal. Datos ficticios.
 */

/** Login con decisión entre Google y Microsoft, una API y nombres largos (como en el lienzo que reportó el problema). */
const graph = {
  schemaVersion: 0,
  nodes: {
    login: { id: 'login', type: 'screen', title: 'Login page' },
    google: { id: 'google', type: 'screen', title: 'autenticación de google con cuenta corporativa' },
    api: { id: 'api', type: 'api', title: 'API de autenticación y registro de usuarios' },
  },
  edges: {
    e1: { id: 'e1', from: 'login', to: 'api', kind: 'request', label: 'iniciar sesión con proveedor externo' },
    e2: { id: 'e2', from: 'api', to: 'google', kind: 'response', replyTo: 'e1' },
  },
  layout: { login: { x: 0, y: 0 }, api: { x: 320, y: 0 }, google: { x: 640, y: 0 } },
  tours: {
    // Lienzo anterior: sin `kind`; uno solo con nodos y otro con conexiones.
    t1: { id: 't1', name: 'iniciar sesion', steps: [{ nodeId: 'login', note: 'Aquí empieza' }, { nodeId: 'api' }] },
    f1: { id: 'f1', name: 'Alta con Google', steps: [{ edgeId: 'e1' }, { edgeId: 'e2' }] },
  },
};

/** Con `WALKIE_CAPTURES=<carpeta>`, guarda capturas para revisar el resultado visual. */
async function capture(page: Page, name: string) {
  const dir = process.env.WALKIE_CAPTURES;
  if (dir) await page.screenshot({ path: `${dir}/tours-y-recorridos-${name}.png` });
}

/** ¿Algo del inspector es más ancho que él? Devuelve lo que se sale (vacío si nada). */
async function overflow(page: Page) {
  return page.locator('.inspector .properties-panel').evaluate((panel) => {
    const box = panel.getBoundingClientRect();
    const out: string[] = [];
    if (panel.scrollWidth > panel.clientWidth + 1) out.push(`scroll ${panel.scrollWidth} > ${panel.clientWidth}`);
    for (const el of panel.querySelectorAll<HTMLElement>('*')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.right > box.right + 1 || r.left < box.left - 1)) out.push(`${el.tagName}.${el.className}`);
    }
    return out;
  });
}

test('tours y recorridos separados, cada uno con su editor', async ({ page }) => {
  await login(page);
  await openNewFeature(page, 'Inicio de sesión');
  await seedCanvas(page, graph);
  const inspector = page.getByRole('complementary', { name: 'Propiedades' });
  const tours = inspector.getByRole('tab', { name: /^Tours/ });
  const flows = inspector.getByRole('tab', { name: /^Recorridos/ });

  // Cada lista en su pestaña, con su cantidad y qué es.
  await expect(tours).toHaveText('Tours 1');
  await expect(flows).toHaveText('Recorridos 1');
  await expect(tours).toHaveAttribute('aria-selected', 'true');
  await expect(inspector.getByText('El guía presenta nodos uno a uno, con una nota en cada paso.')).toBeVisible();
  await expect(inspector.getByRole('button', { name: 'iniciar sesion' })).toBeVisible();
  await expect(inspector.getByRole('button', { name: 'Alta con Google' })).toBeHidden();
  await capture(page, 'pestanas');

  // El editor de un tour solo ofrece nodos.
  await inspector.getByRole('button', { name: 'iniciar sesion' }).click();
  await expect(inspector.getByLabel('Nodo del paso nuevo')).toBeVisible();
  await expect(inspector.getByLabel('Conexión del paso nuevo')).toHaveCount(0);
  await expect(inspector.getByRole('button', { name: 'Ver tour' })).toBeVisible();
  await inspector.getByRole('button', { name: '← Volver a tours' }).click();

  // Recorridos: uno nuevo nace vacío en su pestaña y su editor solo ofrece conexiones.
  await flows.click();
  await expect(inspector.getByText('Reproducen conexiones en orden, de la solicitud a la respuesta.')).toBeVisible();
  await inspector.getByLabel('Nombre del recorrido nuevo').fill('Error de proveedor');
  await inspector.getByRole('button', { name: 'Nuevo recorrido' }).click();
  await expect(inspector.getByLabel('Nombre del recorrido')).toHaveValue('Error de proveedor');
  await expect(inspector.getByLabel('Conexión del paso nuevo')).toBeVisible();
  await expect(inspector.getByLabel('Nodo del paso nuevo')).toHaveCount(0);
  await inspector.getByRole('button', { name: 'Agregar conexión' }).click();
  await expect(inspector.getByRole('listitem', { name: 'Paso 1' })).toBeVisible();

  // Seleccionar una caja y volver: el inspector vuelve a la misma pestaña y al mismo editor.
  await page.locator('.react-flow__node').filter({ hasText: 'Login page' }).click();
  await expect(inspector.getByLabel('Título')).toBeVisible();
  const pane = (await page.locator('.react-flow__pane').boundingBox())!;
  await page.mouse.click(pane.x + pane.width * 0.4, pane.y + 12);
  await expect(flows).toHaveAttribute('aria-selected', 'true');
  await expect(inspector.getByLabel('Nombre del recorrido')).toHaveValue('Error de proveedor');
  await inspector.getByRole('button', { name: '← Volver a recorridos' }).click();
  await expect(flows).toHaveText('Recorridos 2');
  await expect(tours).toHaveText('Tours 1');
});

for (const width of [1440, 1024, 768]) {
  test(`el inspector no se desborda a ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await login(page);
    await openNewFeature(page, 'Inicio de sesión');
    await seedCanvas(page, graph);
    const inspector = page.getByRole('complementary', { name: 'Propiedades' });

    // Editor del recorrido: listas desplegables y botones con los textos más largos.
    await inspector.getByRole('tab', { name: /^Recorridos/ }).click();
    await inspector.getByRole('button', { name: 'Alta con Google' }).click();
    await expect(inspector.getByLabel('Conexión del paso nuevo')).toBeVisible();
    expect(await overflow(page)).toEqual([]);
    await capture(page, `recorrido-${width}`);

    // Inspector de la conexión y de la API (contrato), también largos.
    await page.locator('.kind-edge-label[data-edge-id="e1"]').click();
    await expect(inspector.getByRole('heading', { name: 'Conexión' })).toBeVisible();
    expect(await overflow(page)).toEqual([]);
  });
}
