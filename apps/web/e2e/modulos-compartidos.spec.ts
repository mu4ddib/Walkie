import { expect, test, type Page } from '@playwright/test';
import { dropNode, login, openNewFeature, saveStatus, seedCanvas } from './helpers';

/**
 * Feature modulos-compartidos (docs/features/modulos-compartidos/spec.md) con API, Keycloak y Postgres reales. Los
 * datos de partida se siembran por la API con el token de la sesión; lo que se verifica se hace en la interfaz.
 * Datos ficticios.
 */

const API = process.env.VITE_API_URL ?? 'http://localhost:5080';

/** Con `WALKIE_CAPTURES=<carpeta>`, guarda capturas para revisar el resultado visual. */
async function capture(page: Page, name: string) {
  const dir = process.env.WALKIE_CAPTURES;
  if (dir) await page.screenshot({ path: `${dir}/modulos-${name}.png` });
}

/** Llama a la API con el token de la sesión de la página. */
async function api<T = unknown>(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  return page.evaluate(
    async ({ api, method, path, body }) => {
      const key = Object.keys(sessionStorage).find((k) => k.startsWith('oidc.user:'))!;
      const token = (JSON.parse(sessionStorage.getItem(key)!) as { access_token: string }).access_token;
      const res = await fetch(`${api}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, json: res.status === 204 ? null : await res.json() };
    },
    { api: API, method, path, body },
  ) as Promise<{ status: number; json: T }>;
}

function appAndFeature(page: Page) {
  const match = /apps\/([^/]+)\/features\/([^/?#]+)/.exec(page.url())!;
  return { appId: match[1]!, featureId: match[2]! };
}

/** El módulo «Usuarios»: tres APIs expuestas como interfaces, un servicio y su base, y un recorrido interno. */
function usersModule() {
  return {
    schemaVersion: 0,
    version: 0,
    nodes: {
      get: { id: 'get', type: 'api', title: 'Obtener usuario', http: { method: 'GET', path: '/usuarios/{id}' } },
      post: { id: 'post', type: 'api', title: 'Crear usuario', http: { method: 'POST', path: '/usuarios' } },
      put: { id: 'put', type: 'api', title: 'Actualizar perfil', http: { method: 'PUT', path: '/usuarios/{id}/perfil' } },
      svc: { id: 'svc', type: 'service', title: 'Servicio de usuarios' },
      db: { id: 'db', type: 'database', title: 'BD usuarios' },
    },
    edges: {
      e1: { id: 'e1', from: 'post', to: 'svc', kind: 'request' },
      e2: { id: 'e2', from: 'svc', to: 'db', kind: 'writes' },
    },
    layout: {
      get: { x: 0, y: 0 },
      post: { x: 0, y: 160 },
      put: { x: 0, y: 320 },
      svc: { x: 320, y: 160 },
      db: { x: 640, y: 160 },
    },
    tours: { inner: { id: 'inner', name: 'Alta por dentro', kind: 'flow', steps: [{ id: 'i1', edgeId: 'e1' }, { id: 'i2', edgeId: 'e2' }] } },
    interfaces: {
      iget: { id: 'iget', name: 'Consultar usuario', kind: 'provides', nodeId: 'get' },
      ipost: { id: 'ipost', name: 'Crear usuario', kind: 'provides', nodeId: 'post', tourId: 'inner' },
      iput: { id: 'iput', name: 'Actualizar perfil', kind: 'provides', nodeId: 'put' },
    },
  };
}

/** Una feature con una pantalla que llama al módulo por la interfaz dada. */
function featureUsing(moduleId: string, iface: { id: string; name: string }, screen: string) {
  return {
    schemaVersion: 0,
    version: 0,
    nodes: {
      s: { id: 's', type: 'screen', title: screen },
      m: { id: 'm', type: 'module', title: 'Usuarios', moduleId },
    },
    edges: { r: { id: 'r', from: 's', to: 'm', kind: 'request', toInterface: iface } },
    layout: { s: { x: 0, y: 0 }, m: { x: 360, y: 0, w: 264 } },
  };
}

const moduleBox = (page: Page) => page.locator('.module-node');

test('un módulo Usuarios reutilizado desde tres features, cada una con su interfaz, con navegación y renombre', async ({ page }) => {
  await login(page);
  await openNewFeature(page, 'Registro');
  const { appId, featureId: registro } = appAndFeature(page);

  // Módulo y dos features más, por la API.
  const created = await api<{ id: string }>(page, 'POST', `/api/apps/${appId}/modules`, { name: 'Usuarios', description: 'Cuentas y perfiles' });
  expect(created.status).toBe(201);
  const moduleId = created.json.id;
  expect((await api(page, 'PUT', `/api/features/${moduleId}/canvas`, usersModule())).status).toBe(200);
  for (const [name, iface, screen] of [
    ['Login', { id: 'iget', name: 'Consultar usuario' }, 'Ingreso'],
    ['Perfil', { id: 'iput', name: 'Actualizar perfil' }, 'Mi perfil'],
  ] as const) {
    const feature = await api<{ id: string }>(page, 'POST', `/api/apps/${appId}/features`, { name });
    expect((await api(page, 'PUT', `/api/features/${feature.json.id}/canvas`, featureUsing(moduleId, iface, screen))).status).toBe(200);
  }
  await page.reload();
  await expect(page.locator('.react-flow')).toBeVisible();

  // Registro: el módulo se agrega desde el catálogo (pestaña «Módulos», con búsqueda).
  await page.getByRole('button', { name: 'Catálogo', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Catálogo' });
  await panel.getByRole('tab', { name: /Módulos/ }).click();
  await capture(page, '1-catalogo');
  await panel.getByLabel('Buscar módulos').fill('usu');
  await panel.getByRole('button', { name: /Usuarios/ }).click();
  await panel.getByRole('button', { name: 'Cerrar panel' }).click();
  await expect(moduleBox(page)).toHaveCount(1);
  await expect(moduleBox(page)).toContainText('Cuentas y perfiles');
  await expect(moduleBox(page)).toContainText('3 interfaces · ninguna usada aquí');

  // Una pantalla que se conecta a la interfaz de alta con el selector (búsqueda y teclado).
  await dropNode(page, 'Pantalla', 140, 160);
  const screen = page.locator('.react-flow__node').filter({ has: page.locator('.pixel-node[data-type="screen"]') });
  await expect(screen).toHaveCount(1);
  const from = (await screen.locator('.react-flow__handle-right').boundingBox())!;
  const to = (await moduleBox(page).locator('.react-flow__handle-left').boundingBox())!;
  await page.mouse.move(from.x + 4, from.y + 4);
  await page.mouse.down();
  await page.mouse.move(to.x + 4, to.y + 4, { steps: 12 });
  await page.mouse.up();
  const picker = page.getByRole('dialog', { name: 'Conectar con Usuarios' });
  await expect(picker).toBeVisible();
  await capture(page, '2-selector');
  await picker.getByLabel('Buscar interfaces').fill('POST');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(picker).toBeHidden();
  await expect(page.locator('.kind-edge-label')).toContainText('POST /usuarios');
  await expect(moduleBox(page).getByRole('list', { name: 'Interfaces usadas en este lienzo' })).toContainText('Crear usuario');

  // El inspector dice a qué interfaz llega y permite cambiarla.
  const inspector = page.getByRole('complementary', { name: 'Propiedades' });
  await expect(inspector.getByLabel('Llega a Usuarios')).toHaveValue('ipost');
  await capture(page, '3-conexion');
  await page.getByRole('button', { name: /^Guardar(?! como)/ }).click();
  await expect(saveStatus(page)).toHaveText('Guardado');

  // Abrir el módulo y volver conservando la vista y la selección.
  await page.locator('.react-flow__pane').click({ position: { x: 600, y: 500 } });
  await page.keyboard.press('0');
  await page.waitForTimeout(600);
  await moduleBox(page).click({ position: { x: 40, y: 10 } });
  const viewBefore = await page.locator('.react-flow__viewport').getAttribute('style');
  await moduleBox(page).getByRole('button', { name: 'Abrir módulo' }).click();
  const banner = page.getByRole('region', { name: 'Módulo compartido' });
  await expect(banner).toContainText('Usuarios');
  await expect(banner).toContainText('usada en 3 lienzos');
  await banner.getByRole('button', { name: /Ver usos/ }).click();
  await expect(page.getByRole('dialog', { name: 'Usos del módulo' }).getByRole('listitem')).toHaveCount(3);
  await capture(page, '4-modulo');
  await page.keyboard.press('Escape');

  // Renombrar la interfaz desde su caja interna (las conexiones van por id).
  await page.locator('.react-flow__node').filter({ hasText: 'Crear usuario' }).first().click();
  await inspector.getByLabel('Nombre de la interfaz').fill('Alta de usuario');
  await inspector.getByLabel('Nombre de la interfaz').blur();
  await page.getByRole('button', { name: /^Guardar(?! como)/ }).click();
  await expect(saveStatus(page)).toHaveText('Guardado');

  await banner.getByRole('button', { name: 'Volver a Registro' }).click();
  await expect(page).toHaveURL(new RegExp(`/features/${registro}`));
  await expect(moduleBox(page)).toBeVisible();
  await expect(moduleBox(page)).toHaveAttribute('data-selected', 'true');
  await expect(moduleBox(page)).toContainText('Alta de usuario');
  await expect(page.locator('.kind-edge-label')).toContainText('POST /usuarios');
  expect(await page.locator('.react-flow__viewport').getAttribute('style')).toBe(viewBefore);

  // Las otras features muestran solo la interfaz que usan.
  await page.goto(`/apps/${appId}`);
  await page.getByRole('link', { name: 'Login' }).click();
  await expect(moduleBox(page)).toContainText('Consultar usuario');
  await expect(moduleBox(page)).not.toContainText('Alta de usuario');
  await expect(page.locator('.kind-edge-label')).toContainText('GET /usuarios/{id}');

  // Recargar conserva todo.
  await page.reload();
  await expect(moduleBox(page)).toContainText('Consultar usuario');
});

test('eliminar una interfaz usada reasigna sus conexiones; duplicar la caja sigue apuntando al módulo', async ({ page }) => {
  await login(page);
  await openNewFeature(page, 'Perfil');
  const { appId, featureId } = appAndFeature(page);
  const created = await api<{ id: string }>(page, 'POST', `/api/apps/${appId}/modules`, { name: 'Usuarios' });
  const moduleId = created.json.id;
  await api(page, 'PUT', `/api/features/${moduleId}/canvas`, usersModule());
  await seedCanvas(page, featureUsing(moduleId, { id: 'iput', name: 'Actualizar perfil' }, 'Mi perfil'));

  // Duplicar la caja: la copia apunta al mismo módulo.
  await moduleBox(page).click({ position: { x: 40, y: 10 } });
  await page.keyboard.press('Control+d');
  await expect(moduleBox(page)).toHaveCount(2);
  await expect(moduleBox(page).nth(1)).toContainText('Usuarios');
  await page.keyboard.press('Control+z');
  await expect(moduleBox(page)).toHaveCount(1);

  // En el módulo: quitar «Actualizar perfil» y reasignar su conexión a «Consultar usuario».
  await moduleBox(page).getByRole('button', { name: 'Abrir módulo' }).click();
  await expect(page.getByRole('region', { name: 'Módulo compartido' })).toBeVisible();
  await page.locator('.react-flow__node').filter({ hasText: 'Actualizar perfil' }).first().click();
  const inspector = page.getByRole('complementary', { name: 'Propiedades' });
  await inspector.getByRole('button', { name: 'Quitar interfaz…' }).click();
  await expect(inspector.getByText('1 conexión la usa')).toBeVisible();
  await inspector.getByLabel('Qué hacer con esas conexiones').selectOption({ label: 'Reasignarlas a «Consultar usuario»' });
  await inspector.getByRole('button', { name: 'Quitar interfaz' }).click();
  await page.getByRole('button', { name: /^Guardar(?! como)/ }).click();
  await expect(saveStatus(page)).toHaveText('Guardado');

  await page.getByRole('button', { name: 'Volver a Perfil' }).click();
  await expect(page).toHaveURL(new RegExp(`/features/${featureId}`));
  await expect(moduleBox(page)).toContainText('Consultar usuario');
  await expect(page.locator('.kind-edge-label')).toContainText('GET /usuarios/{id}');
});

test('convertir un grupo con subgrupos en módulo, con la base de fuera como dependencia, y deshacer', async ({ page }) => {
  await login(page);
  await openNewFeature(page, 'Alta');
  await seedCanvas(page, {
    schemaVersion: 0,
    groupNesting: 'explicit',
    nodes: {
      screen: { id: 'screen', type: 'screen', title: 'Formulario de alta' },
      api: { id: 'api', type: 'api', title: 'POST usuarios', http: { method: 'POST', path: '/usuarios' }, groupId: 'backend' },
      svc: { id: 'svc', type: 'service', title: 'Servicio de cuentas', groupId: 'datos' },
      db: { id: 'db', type: 'database', title: 'Clientes' },
    },
    edges: {
      req: { id: 'req', from: 'screen', to: 'api', kind: 'request' },
      res: { id: 'res', from: 'api', to: 'screen', kind: 'response', status: 201, replyTo: 'req' },
      call: { id: 'call', from: 'api', to: 'svc', kind: 'request' },
      read: { id: 'read', from: 'svc', to: 'db', kind: 'reads' },
    },
    layout: {
      screen: { x: -360, y: 80 },
      backend: { x: 0, y: 0, w: 720, h: 400 },
      datos: { x: 320, y: 80, w: 360, h: 260 },
      api: { x: 40, y: 120 },
      svc: { x: 360, y: 160 },
      db: { x: 960, y: 160 },
    },
    groups: {
      backend: { id: 'backend', title: 'Backend', kind: 'backend' },
      datos: { id: 'datos', title: 'Datos', kind: 'data', parentId: 'backend' },
    },
    tours: {
      flow: { id: 'flow', name: 'Alta completa', kind: 'flow', steps: [{ id: 'f1', edgeId: 'req' }, { id: 'f2', edgeId: 'call' }, { id: 'f3', edgeId: 'read' }, { id: 'f4', edgeId: 'res' }] },
    },
  });

  await page.locator('.group-node').filter({ hasText: 'Backend' }).locator('.group-node-header').first().click();
  const inspector = page.getByRole('complementary', { name: 'Propiedades' });
  await inspector.getByRole('button', { name: 'Convertir en módulo…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Convertir en módulo' });
  await expect(dialog.getByLabel('Nombre del módulo')).toHaveValue('Backend');
  await dialog.getByLabel('Nombre del módulo').fill('Cuentas');
  await dialog.getByRole('button', { name: 'Siguiente' }).click();
  // Elementos: el subgrupo y sus cajas.
  await expect(dialog.getByRole('region', { name: 'Elementos incluidos' })).toContainText('Datos');
  await expect(dialog.getByRole('region', { name: 'Elementos incluidos' })).toContainText('Servicio de cuentas');
  await dialog.getByRole('button', { name: 'Siguiente' }).click();
  // Conexiones: la base de fuera queda como dependencia externa (resolución explícita).
  const choice = dialog.getByRole('radiogroup', { name: 'Qué hacer con Clientes' });
  await expect(choice.getByLabel('Dependencia externa')).toBeChecked();
  await dialog.getByRole('button', { name: 'Siguiente' }).click();
  // Interfaces y tours.
  await expect(dialog.getByLabel('Nombre de la interfaz de POST usuarios')).toHaveValue('POST usuarios');
  await expect(dialog.getByLabel('Nombre de la interfaz de Servicio de cuentas')).toHaveValue('Clientes');
  await expect(dialog).toContainText('«Alta completa»: 1 paso pasa al recorrido interno');
  await capture(page, '5-convertir');
  await dialog.getByRole('button', { name: 'Siguiente' }).click();
  await dialog.getByRole('button', { name: 'Convertir en módulo' }).click();
  await expect(dialog).toBeHidden();

  // La caja del módulo reemplaza el grupo; las conexiones externas siguen (solicitud, respuesta y dependencia).
  await expect(moduleBox(page)).toHaveCount(1);
  await expect(page.locator('.group-node')).toHaveCount(0);
  await expect(moduleBox(page)).toContainText('Cuentas');
  await expect(moduleBox(page)).toContainText('POST usuarios');
  await expect(moduleBox(page)).toContainText('Clientes');
  await expect(page.locator('.react-flow__edge')).toHaveCount(3);
  await expect(saveStatus(page)).not.toHaveText('Sin guardar');
  await capture(page, '6-convertido');

  // Deshacer devuelve el grupo; rehacer vuelve a lo guardado.
  await page.locator('.react-flow__pane').click({ position: { x: 600, y: 500 } });
  await page.keyboard.press('Control+z');
  await expect(page.locator('.group-node')).toHaveCount(2);
  await expect(moduleBox(page)).toHaveCount(0);
  await page.keyboard.press('Control+y');
  await expect(moduleBox(page)).toHaveCount(1);

  // Recargar: guardado. Dentro del módulo, el subgrupo, la conexión interna y el recorrido interno.
  await page.reload();
  await expect(moduleBox(page)).toHaveCount(1);
  await moduleBox(page).getByRole('button', { name: 'Abrir módulo' }).click();
  await expect(page.getByRole('region', { name: 'Módulo compartido' })).toContainText('Cuentas');
  await expect(page.locator('.group-node')).toHaveCount(2);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Interfaces del módulo' })).toContainText('Clientes');
});


test('un recorrido externo entra al recorrido interno de la interfaz y vuelve al mismo paso', async ({ page }) => {
  await login(page);
  await openNewFeature(page, 'Registro');
  const { appId, featureId } = appAndFeature(page);
  const created = await api<{ id: string }>(page, 'POST', `/api/apps/${appId}/modules`, { name: 'Usuarios' });
  const moduleId = created.json.id;
  await api(page, 'PUT', `/api/features/${moduleId}/canvas`, usersModule());
  const graph = featureUsing(moduleId, { id: 'ipost', name: 'Crear usuario' }, 'Formulario');
  await seedCanvas(page, {
    ...graph,
    nodes: { ...graph.nodes, ok: { id: 'ok', type: 'screen', title: 'Bienvenida' } },
    edges: { ...graph.edges, back: { id: 'back', from: 'm', to: 'ok', kind: 'response', status: 201, replyTo: 'r', fromInterface: { id: 'ipost', name: 'Crear usuario' } } },
    layout: { ...graph.layout, ok: { x: 0, y: 240 } },
    tours: { alta: { id: 'alta', name: 'Alta', kind: 'flow', steps: [{ id: 'a1', edgeId: 'r' }, { id: 'a2', edgeId: 'back' }] } },
  });

  await page.getByRole('tab', { name: /Recorridos/ }).click();
  await page.getByRole('button', { name: 'Reproducir recorrido' }).first().click();
  const player = page.getByRole('region', { name: 'Reproducción del recorrido' });
  await expect(player).toContainText('Paso 1 de 2');
  await player.getByRole('button', { name: /Pausar/ }).click();
  await expect(player).toContainText('Paso 1 de 2');
  await player.getByRole('button', { name: /Ver dentro del módulo/ }).click();

  // Dentro: el recorrido interno se reproduce y la franja ofrece volver.
  const banner = page.getByRole('region', { name: 'Módulo compartido' });
  await expect(banner).toContainText('Reproduciendo el recorrido interno');
  await expect(page.getByRole('region', { name: 'Reproducción del recorrido' })).toContainText('Alta por dentro');
  await banner.getByRole('button', { name: 'Volver a Registro' }).click();

  // Fuera: el mismo recorrido, en el mismo paso.
  await expect(page).toHaveURL(new RegExp(`/features/${featureId}`));
  await expect(page.getByRole('region', { name: 'Reproducción del recorrido' })).toContainText('Paso 1 de 2');
  await expect(page.getByRole('region', { name: 'Reproducción del recorrido' })).toContainText('Alta');
});
