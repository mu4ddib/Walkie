import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CatalogItem } from '../api/client';
import {
  APP_ID,
  CATALOG_TARGET,
  ITEMS,
  OLD_SNAPSHOT_ID,
  SNAPSHOT_ID,
  SOURCE,
  evidenceOf,
  item,
  snapshot,
  sourcesEntry,
  uploadSummary,
} from '../test/discoveryFixtures';
import { installFakeApi } from '../test/fakeApi';
import type { DiscoverySeed } from '../test/fakeDiscovery';
import { renderRoute } from '../test/render';
import type { WalkieCanvasGraphV0 } from '../schema/walkie-graph';
import { REVIEW_PAGE_SIZE } from './DiscoveryReviewPage';
import type { CanvasDraft } from './initialCanvas';

vi.mock('react-oidc-context', () => ({ useAuth: () => ({ user: { access_token: 'token-de-prueba' } }) }));
vi.mock('../canvas/Canvas', () => ({ Canvas: () => <div>lienzo</div> }));

const app = { id: APP_ID, name: 'Tienda de ejemplo', createdAt: '2026-01-01T00:00:00Z', featureCount: 0 };
const catalog: CatalogItem[] = [
  { id: 'cat-1', appId: APP_ID, type: 'api', title: 'Consultar pedido', version: 1 },
  { id: 'cat-9', appId: APP_ID, type: 'api', title: 'Crear pedido', version: 1 },
  { id: 'cat-2', appId: APP_ID, type: 'database', title: 'Base tienda', version: 1 },
];

function seed(overrides: Partial<DiscoverySeed> = {}): DiscoverySeed {
  return {
    sources: { [APP_ID]: [sourcesEntry()] },
    reviews: { [SNAPSHOT_ID]: { sourceId: SOURCE.id, items: ITEMS } },
    evidence: Object.fromEntries(ITEMS.map((i) => [`${SNAPSHOT_ID}|${i.key}`, evidenceOf(i.key)])),
    ...overrides,
  };
}

const pack = (name = 'architecture.walkiepack', size = 4) => new File([new Uint8Array(size)], name, { type: 'application/zip' });
const calls = (api: ReturnType<typeof installFakeApi>) => api.fetchMock.mock.calls.map(([u, init]) => `${init?.method ?? 'GET'} ${String(u)}`);

afterEach(() => vi.unstubAllGlobals());

describe('Walkie Live en la página de la app', () => {
  it('con Discovery apagado (404) no muestra la sección ni el botón', async () => {
    installFakeApi({ apps: [app] });
    renderRoute(`/apps/${APP_ID}`);

    expect(await screen.findByRole('button', { name: 'Importar feature' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Cargando…')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Importar proyecto local' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Proyectos locales' })).not.toBeInTheDocument();
  });

  it('sin análisis muestra el estado vacío con el comando', async () => {
    installFakeApi({ apps: [app], discovery: seed({ sources: {} }) });
    renderRoute(`/apps/${APP_ID}`);

    const section = (await screen.findByRole('heading', { name: 'Proyectos locales' })).closest('section')!;
    expect(section).toHaveTextContent('Aún no hay análisis de proyectos locales');
    expect(within(section).getByText('walkie scan .')).toBeInTheDocument();
  });

  it('lista cada fuente con su último análisis y el enlace a la revisión', async () => {
    installFakeApi({ apps: [app], discovery: seed() });
    renderRoute(`/apps/${APP_ID}`);

    const section = (await screen.findByRole('heading', { name: 'Proyectos locales' })).closest('section')!;
    expect(section).toHaveTextContent('tienda-demo');
    expect(section).toHaveTextContent('● Completo');
    expect(section).toHaveTextContent('3f1c2a9');
    expect(section).toHaveTextContent('3 hallazgos · 1 análisis');
    expect(within(section).getByRole('link', { name: 'Revisar' })).toHaveAttribute('href', `/apps/${APP_ID}/sources/${SNAPSHOT_ID}`);
    // «Importar feature» (.walkie) sigue siendo otra cosa.
    expect(screen.getAllByRole('button', { name: 'Importar proyecto local' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Importar feature' })).toBeInTheDocument();
  });
});

describe('«Importar proyecto local»', () => {
  async function openDialog(discovery: DiscoverySeed) {
    const api = installFakeApi({ apps: [app], discovery });
    renderRoute(`/apps/${APP_ID}`);
    await screen.findByRole('heading', { name: 'Proyectos locales' });
    await userEvent.click(screen.getAllByRole('button', { name: 'Importar proyecto local' })[0]!);
    return { api, dialog: screen.getByRole('dialog', { name: 'Importar proyecto local' }) };
  }

  it('explica la CLI (comando copiable, instalación real y privacidad) sin subir nada', async () => {
    const { api, dialog } = await openDialog(seed());
    const user = userEvent.setup();

    expect(within(dialog).getByText('walkie scan .')).toBeInTheDocument();
    expect(dialog).toHaveTextContent('architecture.walkiepack');
    expect(dialog).toHaveTextContent('dotnet tool install --global Walkie.Cli');
    expect(dialog).not.toHaveTextContent('npx');
    expect(dialog).toHaveTextContent('no compila, no instala dependencias ni ejecuta nada del proyecto');
    expect(within(dialog).getByRole('button', { name: 'Guardar análisis' })).toBeDisabled();

    await user.click(within(dialog).getByRole('button', { name: 'Copiar walkie scan .' }));
    expect(await navigator.clipboard.readText()).toBe('walkie scan .');
    expect(calls(api).some((c) => c.startsWith('POST'))).toBe(false);
  });

  it('valida sin guardar (dryRun), muestra el resumen y al guardar abre la revisión', async () => {
    const { api, dialog } = await openDialog(seed({ sources: {}, upload: { summary: uploadSummary(), snapshot: snapshot() } }));
    await userEvent.upload(within(dialog).getByLabelText('Archivo .walkiepack'), pack());

    const summary = await within(dialog).findByLabelText('Resumen del análisis');
    expect(summary).toHaveTextContent('tienda-demo');
    expect(summary).toHaveTextContent('● Análisis completo');
    expect(summary).toHaveTextContent('walkie-cli 0.1.0');
    expect(summary).toHaveTextContent('ASP.NET Core 10.0');
    expect(summary).toHaveTextContent('2 API · 1 Base de datos');
    expect(calls(api).at(-1)).toMatch(/POST .*\/sources\/snapshots\?dryRun=true$/);
    expect(api.discovery.sources[APP_ID] ?? []).toHaveLength(0);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar análisis' }));

    expect(await screen.findByRole('heading', { name: 'Revisión del análisis' })).toBeInTheDocument();
    expect(calls(api).filter((c) => c.includes('/sources/snapshots')).at(-1)).toMatch(/snapshots$/);
    expect(api.discovery.sources[APP_ID]).toHaveLength(1);
  });

  it('un análisis parcial se distingue con texto y muestra sus limitaciones', async () => {
    const summary = uploadSummary({
      completeness: 'partial',
      detectors: [{ id: 'openapi', version: '0.1.0', status: 'failed', reason: 'YAML inválido', produces: { entities: ['api'], relations: [] } }],
      limitations: [{ code: 'detector-failed', message: 'openapi no terminó.', path: 'docs/openapi.yaml' }],
    } as never);
    const { dialog } = await openDialog(seed({ upload: { summary, snapshot: snapshot() } }));
    await userEvent.upload(within(dialog).getByLabelText('Archivo .walkiepack'), pack());

    const shown = await within(dialog).findByLabelText('Resumen del análisis');
    expect(shown).toHaveTextContent('◐ Análisis parcial');
    expect(shown).toHaveTextContent('no dará por desaparecido nada de lo que no se miró');
    expect(shown).toHaveTextContent('docs/openapi.yaml');
    expect(shown).toHaveTextContent('YAML inválido');
  });

  it('si el análisis ya existe no guarda otro y ofrece abrirlo', async () => {
    const { api, dialog } = await openDialog(seed({ upload: { summary: uploadSummary(), snapshot: snapshot(), duplicate: 'pack' } }));
    await userEvent.upload(within(dialog).getByLabelText('Archivo .walkiepack'), pack());

    expect(await within(dialog).findByText(/Este paquete ya está cargado en la app/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Guardar análisis' })).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abrir revisión' }));

    expect(await screen.findByRole('heading', { name: 'Revisión del análisis' })).toBeInTheDocument();
    expect(calls(api).filter((c) => c.includes('/sources/snapshots'))).toHaveLength(1);
  });

  it('rechaza en el navegador otra extensión o más de 50 MB, sin subir nada', async () => {
    const { api, dialog } = await openDialog(seed());
    const user = userEvent.setup({ applyAccept: false });

    await user.upload(within(dialog).getByLabelText('Archivo .walkiepack'), pack('proyecto.zip'));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Elige un archivo .walkiepack');

    const big = pack();
    Object.defineProperty(big, 'size', { value: 51 * 1024 * 1024 });
    await user.upload(within(dialog).getByLabelText('Archivo .walkiepack'), big);
    expect(within(dialog).getByRole('alert')).toHaveTextContent('pasa de 50 MB');
    expect(calls(api).some((c) => c.includes('/sources/snapshots'))).toBe(false);
  });

  it('muestra los errores del paquete con su ruta (400) y el de tamaño (413)', async () => {
    const { api, dialog } = await openDialog(seed());
    api.discovery.next.uploadErrors = { status: 400, errors: { 'discovery.json/entities/0/key': ['La clave no es normal.'] } };
    await userEvent.upload(within(dialog).getByLabelText('Archivo .walkiepack'), pack());

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('No se puede cargar este paquete');
    expect(alert).toHaveTextContent('discovery.json/entities/0/key');

    api.discovery.next.uploadErrors = { status: 413 };
    await userEvent.upload(within(dialog).getByLabelText('Archivo .walkiepack'), pack('otro.walkiepack'));
    expect(await within(dialog).findByText(/pasa de 50 MB/)).toBeInTheDocument();
  });

  it('un error de red se muestra sin cerrar el diálogo', async () => {
    const { api, dialog } = await openDialog(seed());
    api.fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await userEvent.upload(within(dialog).getByLabelText('Archivo .walkiepack'), pack());

    expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Importar proyecto local' })).toBeInTheDocument();
  });
});

describe('revisión de un análisis', () => {
  const path = `/apps/${APP_ID}/sources/${SNAPSHOT_ID}`;

  async function openReview(discovery = seed(), url = path) {
    const api = installFakeApi({ apps: [app], catalog, discovery });
    renderRoute(url);
    await screen.findByRole('list', { name: 'Hallazgos' });
    return api;
  }
  const row = (name: string | RegExp) => within(screen.getByRole('list', { name: 'Hallazgos' })).getByRole('button', { name });

  it('muestra la cabecera, los siete estados con texto y cada hallazgo', async () => {
    await openReview();

    expect(screen.getByLabelText('Resumen del análisis')).toHaveTextContent('tienda-demo');
    const counts = screen.getByRole('group', { name: 'Hallazgos por estado' });
    for (const label of ['Nuevo', 'Coincide', 'Cambió', 'Ya no aparece', 'Vinculado', 'Creado', 'Descartado']) {
      expect(within(counts).getByRole('button', { name: new RegExp(label) })).toBeInTheDocument();
    }
    expect(within(counts).getByRole('button', { name: /Nuevo/ })).toHaveTextContent('3');
    expect(row(/GET \/api\/pedidos\/\{id\}/)).toHaveTextContent('≈ Consultar pedido (misma firma)');
    expect(row(/tienda/)).toHaveTextContent('2 candidatos posibles: elige uno');
  });

  it('el texto del paquete se muestra como texto, nunca como HTML', async () => {
    await openReview();
    const hostile = row(/onerror/);
    expect(hostile).toHaveTextContent('<img src=x onerror="alert(1)">');
    expect(document.querySelector('.discovery-list img')).toBeNull();
  });

  it('filtra por estado y tipo en la API, con los filtros en la URL', async () => {
    const api = await openReview();

    await userEvent.click(within(screen.getByRole('group', { name: 'Hallazgos por estado' })).getByRole('button', { name: /Coincide/ }));
    await waitFor(() => expect(screen.getByRole('list', { name: 'Hallazgos' }).children).toHaveLength(1));
    expect(calls(api).filter((c) => c.includes('/review?')).at(-1)).toMatch(/status=matched/);

    await userEvent.selectOptions(screen.getByLabelText('Tipo'), 'database');
    await waitFor(() => expect(screen.getByText('Ningún hallazgo con estos filtros')).toBeInTheDocument());
    expect(calls(api).filter((c) => c.includes('/review?')).at(-1)).toMatch(/kind=database&status=matched/);

    await userEvent.click(screen.getByRole('button', { name: 'Quitar filtros' }));
    await waitFor(() => expect(screen.getByRole('list', { name: 'Hallazgos' }).children).toHaveLength(ITEMS.length));
  });

  it('pagina en la API sin traer todo', async () => {
    const many = Array.from({ length: REVIEW_PAGE_SIZE + 5 }, (_, i) => item({ key: `api:GET /api/x${String(i).padStart(3, '0')}` }));
    const api = await openReview(seed({ reviews: { [SNAPSHOT_ID]: { sourceId: SOURCE.id, items: many } } }));

    expect(screen.getByRole('list', { name: 'Hallazgos' }).children).toHaveLength(REVIEW_PAGE_SIZE);
    expect(screen.getByText(`1–${REVIEW_PAGE_SIZE} de ${many.length}`)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente →' }));

    await waitFor(() => expect(screen.getByRole('list', { name: 'Hallazgos' }).children).toHaveLength(5));
    expect(calls(api).filter((c) => c.includes('/review?')).at(-1)).toMatch(/page=1&pageSize=50/);
    expect(screen.getByRole('button', { name: 'Siguiente →' })).toBeDisabled();
  });

  it('se recorre con las flechas', async () => {
    await openReview();
    const first = row(/GET \/api\/pedidos/);
    first.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(row(/tienda/)).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(first).toHaveFocus();
  });

  it('el inspector se desplaza con el teclado y, al cambiar de hallazgo, empieza arriba; dentro del mismo no se mueve', async () => {
    await openReview();
    await userEvent.click(row(/GET \/api\/pedidos/));
    const inspector = screen.getByRole('complementary', { name: 'Detalle del hallazgo' });
    // Una región desplazable alcanzable con Tab (Safari no la enfoca sola): Re Pág, Av Pág, Inicio y Fin la mueven.
    expect(inspector).toHaveAttribute('tabindex', '0');
    // jsdom no tiene layout: el desplazamiento se simula en el propio panel.
    Object.defineProperty(inspector, 'scrollTop', { value: 240, writable: true, configurable: true });

    // Abrir una decisión del mismo hallazgo no mueve el panel.
    await userEvent.click(within(inspector).getByRole('button', { name: 'Descartar…' }));
    expect(inspector.scrollTop).toBe(240);

    // Otro hallazgo: el mismo panel, arriba, con su título a la vista.
    await userEvent.click(row(/tienda/));
    expect(screen.getByRole('complementary', { name: 'Detalle del hallazgo' })).toBe(inspector);
    expect(inspector.scrollTop).toBe(0);
    expect(row(/tienda/)).toHaveAttribute('aria-current', 'true');
  });

  it('apilado (pantalla angosta): elegir lleva al detalle y «Volver a la lista» a su fila; con movimiento reducido, sin animar', async () => {
    const queries: string[] = [];
    vi.stubGlobal('matchMedia', (query: string) => {
      queries.push(query);
      return { matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} };
    });
    const scrolls: ScrollIntoViewOptions[] = [];
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function (options?: boolean | ScrollIntoViewOptions) {
      scrolls.push(options as ScrollIntoViewOptions);
    };
    try {
      await openReview();
      await userEvent.click(row(/GET \/api\/pedidos/));
      const inspector = screen.getByRole('complementary', { name: 'Detalle del hallazgo' });
      await waitFor(() => expect(inspector).toHaveFocus());
      expect(scrolls.at(-1)).toEqual({ block: 'start', behavior: 'auto' });
      expect(queries).toContain('(prefers-reduced-motion: reduce)');

      await userEvent.click(within(inspector).getByRole('button', { name: '← Volver a la lista' }));
      expect(row(/GET \/api\/pedidos/)).toHaveFocus();
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });

  it('en escritorio elegir un hallazgo no mueve la página ni el foco', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    await openReview();
    const first = row(/GET \/api\/pedidos/);
    await userEvent.click(first);
    expect(first).toHaveFocus();
  });

  it('el inspector explica la coincidencia y pide la evidencia de ese hallazgo solo', async () => {
    const api = await openReview();
    await userEvent.click(row(/GET \/api\/pedidos/));

    const inspector = screen.getByRole('complementary', { name: 'Detalle del hallazgo' });
    expect(inspector).toHaveTextContent('Coincide con Consultar pedido');
    expect(inspector).toHaveTextContent('No se vincula hasta que lo confirmes');
    const evidence = await within(inspector).findByRole('region', { name: 'Evidencia' });
    expect(await within(evidence).findByText('src/Tienda.Api/Pedidos/PedidosEndpoints.cs:12-14')).toBeInTheDocument();
    expect(evidence).toHaveTextContent('aspnetcore-endpoints');
    expect(calls(api).filter((c) => c.includes('/evidence?'))).toHaveLength(1);
  });

  it('ambiguo: ningún candidato elegido de antemano; vincular exige elegir uno', async () => {
    const api = await openReview();
    await userEvent.click(row(/tienda/));
    const inspector = screen.getByRole('complementary', { name: 'Detalle del hallazgo' });

    const radios = within(inspector).getAllByRole('radio');
    expect(radios).toHaveLength(2);
    radios.forEach((r) => expect(r).not.toBeChecked());
    expect(within(inspector).getByRole('button', { name: 'Vincular…' })).toBeDisabled();

    await userEvent.click(within(inspector).getByRole('radio', { name: /Base tienda/ }));
    await userEvent.click(within(inspector).getByRole('button', { name: 'Vincular…' }));
    expect(await within(inspector).findByText(/Se vinculará a «Base tienda»/)).toBeInTheDocument();
    const preview = api.discovery.applies.at(-1)!;
    expect(preview.dryRun).toBe(true);
    expect(preview.body.operations).toEqual([
      { op: 'link', entityKey: 'database:postgresql/tienda', target: { kind: 'catalogItem', id: 'cat-2' }, bindingVersion: 0 },
    ]);

    await userEvent.click(within(inspector).getByRole('button', { name: 'Confirmar' }));
    expect(await within(inspector).findByText('Vinculado a «Base tienda».')).toBeInTheDocument();
    const commit = api.discovery.applies.at(-1)!;
    expect(commit.dryRun).toBe(false);
    expect(commit.body.applyId).toBe(preview.body.applyId);
    await waitFor(() => expect(row(/tienda/)).toHaveTextContent('Vinculado'));
  });

  it('vincula a otro elemento compatible (mismo tipo) del catálogo', async () => {
    const api = await openReview();
    await userEvent.click(row(/onerror/));
    const inspector = screen.getByRole('complementary', { name: 'Detalle del hallazgo' });

    const select = within(inspector).getByLabelText('Vincular a un elemento existente');
    const options = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Elige uno…', 'Consultar pedido', 'Crear pedido']);
    await userEvent.selectOptions(select, 'catalogItem:cat-9');
    await userEvent.click(within(inspector).getByRole('button', { name: 'Vincular…' }));
    await within(inspector).findByText(/Se vinculará a/);
    expect(api.discovery.applies.at(-1)!.body.operations[0]).toMatchObject({ op: 'link', target: { id: 'cat-9' } });
  });

  // ---------- Pantallas sueltas (spec walkie-live-documentacion, ADR-0018) ----------

  const PEDIDOS_FEATURE = { id: '0198f0c0-3333-7000-8000-000000000001', appId: APP_ID, name: 'Pedidos', description: '', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
  const SCREEN = 'screen:web:/pedidos';
  const screenDraft: CanvasDraft = {
    nodes: [
      { key: SCREEN, type: 'screen', title: 'Pedidos', route: '/pedidos' },
      { key: 'api:GET /api/pedidos', type: 'ref', title: 'Consultar pedido', catalogId: 'cat-1' },
      { key: `walkie-feature:${PEDIDOS_FEATURE.id}`, type: 'portal', title: 'Pedidos', targetFeatureId: PEDIDOS_FEATURE.id },
    ],
    edges: [
      { key: 'calls|a', from: SCREEN, to: 'api:GET /api/pedidos', kind: 'request', operation: 'http.request' },
      { key: 'navigates|b', from: SCREEN, to: `walkie-feature:${PEDIDOS_FEATURE.id}`, kind: 'navigation', operation: 'navigation' },
    ],
    interfaces: [],
    omitted: [{ key: 'navigates|c', code: 'navigation-undecided', message: 'Navega a /otra, que todavía no está en ninguna feature de Walkie.' }],
  };
  const existingCanvas: WalkieCanvasGraphV0 = {
    schemaVersion: 0,
    version: 4,
    nodes: { n1: { id: 'n1', type: 'screen', title: 'Lista' }, n2: { id: 'n2', type: 'ref', title: 'Consultar pedido', catalogId: 'cat-1' } },
    edges: { e1: { id: 'e1', from: 'n1', to: 'n2', kind: 'request' } },
    layout: { n1: { x: 0, y: 0 }, n2: { x: 0, y: 200 } },
    tours: { t: { id: 't', name: 'Guía', kind: 'guide', steps: [{ id: 's', nodeId: 'n1' }] } },
  };
  const attachDraft: CanvasDraft = {
    ...screenDraft,
    nodes: [screenDraft.nodes[0]!, { ...screenDraft.nodes[1]!, existing: 'n2' }],
    edges: [screenDraft.edges[0]!],
    omitted: [{ key: 'navigates|b', code: 'navigation-same-feature', message: 'Navega a /pedidos/:id, que ya está en esta misma feature.' }],
  };

  async function openScreen(extra: Partial<DiscoverySeed> = {}) {
    const api = installFakeApi({
      apps: [app],
      catalog,
      features: [PEDIDOS_FEATURE],
      canvases: { [PEDIDOS_FEATURE.id]: existingCanvas },
      discovery: seed({ drafts: { [SCREEN]: screenDraft }, attaches: { [SCREEN]: { canvasVersion: 4, existing: { nodes: 2, edges: 1, tours: 1 }, canvas: attachDraft } }, ...extra }),
    });
    renderRoute(path);
    await screen.findByRole('list', { name: 'Hallazgos' });
    await userEvent.click(row(/screen:web:\/pedidos/));
    return { api, inspector: screen.getByRole('complementary', { name: 'Detalle del hallazgo' }) };
  }

  it('una pantalla suelta ofrece crear una feature, incorporarla a una existente o dejarla pendiente; nunca vincularla sola', async () => {
    const { inspector } = await openScreen();
    expect(within(inspector).getByRole('button', { name: 'Crear feature desde esta pantalla…' })).toBeInTheDocument();
    expect(within(inspector).getByRole('combobox', { name: 'Incorporar a una feature existente' })).toBeInTheDocument();
    expect(within(inspector).getByRole('button', { name: 'Incorporar…' })).toBeDisabled(); // la feature la elige la persona
    expect(inspector).toHaveTextContent('O déjala pendiente: no se crea ni se descarta nada');
    expect(within(inspector).queryByRole('button', { name: 'Vincular…' })).not.toBeInTheDocument();
  });

  it('crear una feature desde una pantalla: vista previa con su ruta, su llamada y el portal, y un nombre editable', async () => {
    const { api, inspector } = await openScreen();
    await userEvent.click(within(inspector).getByRole('button', { name: 'Crear feature desde esta pantalla…' }));
    const preview = await within(inspector).findByRole('region', { name: 'Lo que se creará' });
    expect(preview).toHaveTextContent('Pedidos (/pedidos)');
    expect(preview).toHaveTextContent('Consultar pedido');
    expect(preview).toHaveTextContent('Navegación a una pantalla sin feature');
    await userEvent.clear(within(preview).getByLabelText('Nombre'));
    await userEvent.type(within(preview).getByLabelText('Nombre'), 'Inicio');
    await userEvent.click(within(inspector).getByRole('button', { name: 'Confirmar y crear' }));
    expect(await within(inspector).findByRole('status')).toHaveTextContent('Feature creada: «Inicio»');
    const sent = api.discovery.applies.at(-1)!.body.operations.at(-1)!;
    expect(sent).toMatchObject({ op: 'create', entityKey: SCREEN, name: 'Inicio' });
    expect(Object.keys(sent.canvas!.nodes).sort()).toEqual(screenDraft.nodes.map((n) => n.key).sort());
  });

  it('incorporar a una feature existente: dice qué tiene, qué se agrega y qué se reutiliza; solo agrega, con la versión vista', async () => {
    const { api, inspector } = await openScreen();
    await userEvent.selectOptions(within(inspector).getByRole('combobox', { name: 'Incorporar a una feature existente' }), PEDIDOS_FEATURE.id);
    await userEvent.click(within(inspector).getByRole('button', { name: 'Incorporar…' }));
    const preview = await within(inspector).findByRole('region', { name: 'Lo que se agregará' });
    expect(preview).toHaveTextContent('Se incorpora a «Pedidos». Su lienzo tiene 2 cajas, 1 conexión y 1 tour: nada de eso se mueve ni cambia.');
    expect(preview).toHaveTextContent('pantalla «Pedidos» (/pedidos)');
    expect(preview).toHaveTextContent('Consultar pedido (ya está en el lienzo)');
    expect(preview).toHaveTextContent('Navegación dentro de la misma feature');
    await userEvent.click(within(inspector).getByRole('button', { name: 'Confirmar e incorporar' }));
    expect(await within(inspector).findByRole('status')).toHaveTextContent('Incorporada a «Pedidos»');
    expect(within(inspector).getByRole('link', { name: 'Abrir la feature' })).toHaveAttribute('href', `/apps/${APP_ID}/features/${PEDIDOS_FEATURE.id}`);
    const sent = api.discovery.applies.at(-1)!.body.operations.at(-1)!;
    expect(sent).toMatchObject({ op: 'attach', entityKey: SCREEN, canvasVersion: 4, target: { kind: 'feature', id: PEDIDOS_FEATURE.id } });
    // Solo lo nuevo, a la derecha de lo que ya está (nada se encima ni se mueve).
    expect(Object.keys(sent.canvas!.nodes)).toEqual([SCREEN]);
    expect(sent.canvas!.layout[SCREEN]!.x).toBeGreaterThan(184);
  });

  it('si el lienzo cambió desde la vista previa, no se agrega nada y lo dice', async () => {
    const { api, inspector } = await openScreen();
    api.discovery.next.attachConflict = true;
    await userEvent.selectOptions(within(inspector).getByRole('combobox', { name: 'Incorporar a una feature existente' }), PEDIDOS_FEATURE.id);
    await userEvent.click(within(inspector).getByRole('button', { name: 'Incorporar…' }));
    await within(inspector).findByRole('region', { name: 'Lo que se agregará' });
    await userEvent.click(within(inspector).getByRole('button', { name: 'Confirmar e incorporar' }));
    expect(await within(inspector).findByRole('alert')).toHaveTextContent('Nada se agregó');
    expect(within(inspector).getByRole('button', { name: 'Confirmar e incorporar' })).toBeDisabled();
  });

  it('descarta con nota (vista previa y confirmación) y luego restablece', async () => {
    const api = await openReview();
    await userEvent.click(row(/onerror/));
    const inspector = screen.getByRole('complementary', { name: 'Detalle del hallazgo' });

    await userEvent.type(within(inspector).getByLabelText('Nota (opcional)'), 'Es de pruebas');
    await userEvent.click(within(inspector).getByRole('button', { name: 'Descartar…' }));
    expect(await within(inspector).findByText(/Seguirá descartado en los análisis siguientes/)).toBeInTheDocument();
    await userEvent.click(within(inspector).getByRole('button', { name: 'Confirmar' }));
    expect(await within(inspector).findByText('Descartado.')).toBeInTheDocument();
    expect(api.discovery.applies.at(-1)!.body.operations[0]).toMatchObject({ op: 'reject', note: 'Es de pruebas', bindingVersion: 0 });
    await waitFor(() => expect(inspector).toHaveTextContent('Nota: Es de pruebas'));

    await userEvent.click(within(inspector).getByRole('button', { name: 'Tomar otra decisión' }));
    await userEvent.click(within(inspector).getByRole('button', { name: 'Restablecer decisión…' }));
    expect(await within(inspector).findByText(/Se quitará la decisión/)).toBeInTheDocument();
    const reset = api.discovery.applies.at(-1)!;
    expect(reset.body.operations[0]).toMatchObject({ op: 'reset', bindingVersion: 1 });
    expect(reset.body.applyId).not.toBe(api.discovery.applies[0]!.body.applyId);
    await userEvent.click(within(inspector).getByRole('button', { name: 'Confirmar' }));
    expect(await within(inspector).findByText('Decisión restablecida.')).toBeInTheDocument();
  });

  it('una decisión de antes de distinguir la app se muestra en cada contraparte y se restablece aparte', async () => {
    const legacyBinding = {
      sourceId: SOURCE.id,
      entityKey: 'screen:/pedidos',
      decision: 'rejected' as const,
      entityFingerprint: `sha256:${'1'.repeat(64)}`,
      snapshotId: OLD_SNAPSHOT_ID,
      decidedBy: 'persona',
      decidedAt: '2026-11-01T10:00:00Z',
      version: 3,
    };
    const items = [
      item({ key: 'screen:admin:/pedidos', kind: 'screen', title: 'Pedidos (admin)', proposal: { op: 'none' }, legacyBinding }),
      item({ key: 'screen:tienda:/pedidos', kind: 'screen', title: 'Pedidos (tienda)', proposal: { op: 'none' }, legacyBinding }),
    ];
    const api = await openReview(
      seed({
        reviews: { [SNAPSHOT_ID]: { sourceId: SOURCE.id, items } },
        evidence: Object.fromEntries(items.map((i) => [`${SNAPSHOT_ID}|${i.key}`, evidenceOf(i.key)])),
      }),
    );
    await userEvent.click(row(/screen:tienda:\/pedidos/));
    const inspector = screen.getByRole('complementary', { name: 'Detalle del hallazgo' });

    expect(inspector).toHaveTextContent('screen:/pedidos');
    expect(inspector).toHaveTextContent('antes de que Walkie distinguiera la app');
    expect(inspector).toHaveTextContent('no se marca como desaparecida');
    await userEvent.click(within(inspector).getByRole('button', { name: 'Restablecer la decisión vieja…' }));
    await waitFor(() => expect(api.discovery.applies.length).toBeGreaterThan(0));
    expect(api.discovery.applies.at(-1)!.body.operations[0]).toEqual({ op: 'reset', entityKey: 'screen:/pedidos', bindingVersion: 3 });
  });

  it('un 409 avisa, recarga la revisión y no reintenta solo', async () => {
    const api = await openReview();
    await userEvent.click(row(/onerror/));
    const inspector = screen.getByRole('complementary', { name: 'Detalle del hallazgo' });
    await userEvent.click(within(inspector).getByRole('button', { name: 'Descartar…' }));
    await within(inspector).findByText(/Seguirá descartado/);

    const reviewsBefore = calls(api).filter((c) => c.includes('/review?')).length;
    api.discovery.next.applyStatus = 409;
    await userEvent.click(within(inspector).getByRole('button', { name: 'Confirmar' }));

    expect(await within(inspector).findByText(/Alguien decidió sobre este hallazgo/)).toBeInTheDocument();
    await waitFor(() => expect(calls(api).filter((c) => c.includes('/review?')).length).toBeGreaterThan(reviewsBefore));
    expect(within(inspector).getByRole('button', { name: 'Confirmar' })).toBeDisabled();
    expect(api.discovery.applies.filter((a) => !a.dryRun)).toHaveLength(1);
  });

  it('un error de red al confirmar permite reintentar con el mismo applyId', async () => {
    const api = await openReview();
    await userEvent.click(row(/onerror/));
    const inspector = screen.getByRole('complementary', { name: 'Detalle del hallazgo' });
    await userEvent.click(within(inspector).getByRole('button', { name: 'Descartar…' }));
    await within(inspector).findByText(/Seguirá descartado/);

    api.fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await userEvent.click(within(inspector).getByRole('button', { name: 'Confirmar' }));
    expect(await within(inspector).findByText(/no se aplicará dos veces/)).toBeInTheDocument();
    await userEvent.click(within(inspector).getByRole('button', { name: 'Confirmar' }));
    expect(await within(inspector).findByText('Descartado.')).toBeInTheDocument();
    const ids = new Set(api.discovery.applies.map((a) => a.body.applyId));
    expect(ids.size).toBe(1);
  });

  it('un hallazgo que ya no aparece se explica sin hablar de borrar', async () => {
    const missing = item({ key: 'api:DELETE /api/viejo', status: 'missing', proposal: { op: 'none' } });
    await openReview(seed({ reviews: { [SNAPSHOT_ID]: { sourceId: SOURCE.id, items: [missing] } } }));
    await userEvent.click(row(/DELETE/));
    const inspector = screen.getByRole('complementary', { name: 'Detalle del hallazgo' });
    expect(inspector).toHaveTextContent('Ya no aparece');
    expect(inspector).toHaveTextContent('No se borra nada');
    expect(within(inspector).queryByRole('button', { name: /Eliminar|Borrar/ })).not.toBeInTheDocument();
  });

  it('un análisis anterior se ve pero no deja decidir', async () => {
    await openReview(
      seed({ reviews: { [OLD_SNAPSHOT_ID]: { sourceId: SOURCE.id, items: ITEMS } } }),
      `/apps/${APP_ID}/sources/${OLD_SNAPSHOT_ID}`,
    );
    expect(screen.getAllByRole('note').find((n) => n.textContent?.includes('Este no es el'))).toHaveTextContent('Este no es el último análisis');
    expect(screen.getByRole('link', { name: 'el último' })).toHaveAttribute('href', `/apps/${APP_ID}/sources/${SNAPSHOT_ID}`);
    await userEvent.click(row(/onerror/));
    expect(screen.queryByRole('button', { name: 'Descartar…' })).not.toBeInTheDocument();
  });

  it('un análisis inexistente o Discovery apagado muestra un aviso, sin lista', async () => {
    installFakeApi({ apps: [app] });
    renderRoute(path);
    expect(await screen.findByRole('alert')).toHaveTextContent('no existe o Walkie Live no está disponible');
    expect(screen.queryByRole('list', { name: 'Hallazgos' })).not.toBeInTheDocument();
  });

  it('vincular una coincidencia lleva su elemento elegido, nunca sin confirmar', async () => {
    const api = await openReview();
    await userEvent.click(row(/GET \/api\/pedidos/));
    const inspector = screen.getByRole('complementary', { name: 'Detalle del hallazgo' });
    expect(api.discovery.applies).toHaveLength(0);
    await userEvent.click(within(inspector).getByRole('button', { name: 'Vincular…' }));
    await within(inspector).findByText(/Se vinculará a «Consultar pedido»/);
    expect(api.discovery.applies.at(-1)!.body.operations[0]).toMatchObject({ target: { id: CATALOG_TARGET.id } });
    await userEvent.click(within(inspector).getByRole('button', { name: 'Cancelar' }));
    expect(api.discovery.applies.filter((a) => !a.dryRun)).toHaveLength(0);
  });
});
