import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArchitectureLink, DiscoveryArchitecture, DiscoveryReviewItem } from '../../api/client';
import { APP_ID, SNAPSHOT_ID, SOURCE, evidenceOf, item, sourcesEntry } from '../../test/discoveryFixtures';
import { installFakeApi } from '../../test/fakeApi';
import type { DiscoverySeed } from '../../test/fakeDiscovery';
import { renderRoute } from '../../test/render';
import type { CanvasDraft } from '../initialCanvas';
import type { ArchitectureSelection } from './ArchitectureCanvas';
import { DEFAULT_FILTERS, linkCount, linkCounts, linkText, orderChain, overviewLayout, shortKey, stepParts, visibleLinks } from './architectureModel';
import { initialChoice, proposalOperations } from './proposalModel';

vi.mock('react-oidc-context', () => ({ useAuth: () => ({ user: { access_token: 'token-de-prueba' } }) }));
vi.mock('../../canvas/Canvas', () => ({ Canvas: () => <div>lienzo</div> }));
// React Flow no corre en jsdom: un lienzo mínimo con un botón por caja y por vínculo, que elige como el real.
vi.mock('./ArchitectureCanvas', () => ({
  ArchitectureCanvas: (props: {
    mode: 'overview' | 'detail';
    groups: { key: string; title: string }[];
    links?: ArchitectureLink[];
    detail?: { entities: { key: string; title: string }[] };
    onSelect: (s: ArchitectureSelection) => void;
    onOpen: (key: string) => void;
  }) => (
    <div data-testid={`lienzo-${props.mode}`}>
      {props.mode === 'overview'
        ? props.groups.map((g) => (
            <button key={g.key} type="button" onClick={() => props.onSelect({ kind: 'group', key: g.key })} onDoubleClick={() => props.onOpen(g.key)}>
              caja {g.title}
            </button>
          ))
        : props.detail!.entities.map((e) => (
            <button key={e.key} type="button" onClick={() => props.onSelect({ kind: 'entity', key: e.key, title: e.title })}>
              caja {e.title}
            </button>
          ))}
      {props.links?.map((l) => (
        <button key={`${l.from}|${l.to}|${l.kind}`} type="button" onClick={() => props.onSelect({ kind: 'link', link: l })}>
          flecha {l.from} {l.kind} {l.to}
        </button>
      ))}
    </div>
  ),
}));

const app = { id: APP_ID, name: 'Tienda de ejemplo', createdAt: '2026-01-01T00:00:00Z', featureCount: 0 };

type Counts = ArchitectureLink['byBasis']['observed'];
/** Un vínculo con sus categorías disjuntas; los totales salen de ellas, como en la API. */
function link(kind: ArchitectureLink['kind'], semantic: ArchitectureLink['semantic'], observed: Counts, inferred: Counts): ArchitectureLink {
  const sum = (c: Counts) => c.high + c.medium + c.low;
  return {
    from: 'a',
    to: 'b',
    kind,
    semantic,
    total: sum(observed) + sum(inferred),
    observed: sum(observed),
    inferred: sum(inferred),
    low: observed.low + inferred.low,
    byBasis: { observed, inferred },
  };
}
const FEATURE = 'feature:web:Pedidos';
const LIST = 'screen:web:/pedidos';
const DETAIL = 'screen:web:/pedidos/{}';
const GET_LIST = 'api:GET /api/pedidos';
const GET_ONE = 'api:GET /api/pedidos/{}';
const PUT_ONE = 'api:PUT /api/pedidos/{}';
const HEALTH = 'api:GET /api/salud';
const HAND_MADE = { kind: 'catalogItem' as const, id: '0198f0c0-1111-7000-8000-000000000001', title: 'Pedidos (a mano)' };
const CALL = `calls|${LIST}|${GET_LIST}`;
/** Se llama igual que una API hecha a mano, pero su contrato es otro: coincide solo por título. */
const TWIN = 'api:POST /api/pedidos/{}/notas';
const SAME_NAME = { kind: 'catalogItem' as const, id: '0198f0c0-1111-7000-8000-000000000009', title: 'Notas del pedido' };

const architecture: DiscoveryArchitecture = {
  snapshotId: SNAPSHOT_ID,
  completeness: 'partial',
  totals: { entities: 9, relations: 12 },
  groups: [
    { key: 'frontend:web', kind: 'frontend', title: 'tienda-web', counts: { screen: 2, feature: 1 }, internal: { navigation: 1 }, limitations: 1, incomplete: 1 },
    { key: 'service:Tienda.Api', kind: 'service', title: 'Tienda.Api', counts: { api: 4, service: 1 }, internal: {}, limitations: 0, incomplete: 0 },
  ],
  links: [
    {
      from: 'frontend:web',
      to: 'service:Tienda.Api',
      kind: 'calls',
      semantic: 'execution',
      total: 3,
      observed: 0,
      inferred: 3,
      low: 0,
      byBasis: { observed: { high: 0, medium: 0, low: 0 }, inferred: { high: 0, medium: 3, low: 0 } },
    },
  ],
  proposals: [
    {
      key: FEATURE,
      title: 'Pedidos',
      app: 'web',
      group: 'frontend:web',
      confidence: 'medium',
      strength: 'evidence',
      screens: 2,
      apis: 4,
      navigation: 1,
      requests: 4,
      unresolved: 1,
      members: [GET_LIST, GET_ONE, HEALTH, PUT_ONE, LIST, DETAIL, TWIN],
      memberCount: 7,
    },
  ],
  limitations: [
    { code: 'http-wrapper-unresolved', message: 'Una URL armada en tiempo de ejecución.', path: 'web/src/http.ts', detector: 'frontend-http', group: 'frontend:web', incomplete: true },
  ],
};

const items: DiscoveryReviewItem[] = [
  item({ key: FEATURE, kind: 'feature', title: 'Pedidos', basis: 'inferred', confidence: 'medium' }),
  item({ key: LIST, kind: 'screen', title: 'Pedidos' }),
  item({ key: DETAIL, kind: 'screen', title: 'Pedido' }),
  item({ key: GET_LIST, title: 'GET /api/pedidos', status: 'matched', match: { target: HAND_MADE, reason: 'signature' }, proposal: { op: 'link', target: HAND_MADE } }),
  item({ key: GET_ONE, title: 'GET /api/pedidos/{id}' }),
  item({ key: PUT_ONE, title: 'PUT /api/pedidos/{id}', basis: 'inferred', confidence: 'medium' }),
  item({
    key: HEALTH,
    title: 'GET /api/salud',
    status: 'matched',
    candidates: [
      { target: { kind: 'catalogItem', id: 'cat-a', title: 'Salud A' }, reason: 'title' },
      { target: { kind: 'catalogItem', id: 'cat-b', title: 'Salud B' }, reason: 'title' },
    ],
  }),
  item({ key: TWIN, title: 'Notas del pedido', status: 'matched', match: { target: SAME_NAME, reason: 'title' }, proposal: { op: 'create' } }),
  item({ key: 'api:GET /api/otra', title: 'GET /api/otra' }),
];

const draft: CanvasDraft = {
  nodes: [
    { key: LIST, type: 'screen', title: 'Pedidos', route: '/pedidos' },
    { key: DETAIL, type: 'screen', title: 'Pedido', route: '/pedidos/:id' },
    { key: GET_LIST, type: 'ref', title: 'Pedidos (a mano)', catalogId: HAND_MADE.id },
  ],
  edges: [
    { key: 'navigates:a', from: LIST, to: DETAIL, kind: 'navigation', operation: 'navigation' },
    { key: 'calls:a', from: LIST, to: GET_LIST, kind: 'request', operation: 'http.request' },
  ],
  interfaces: [],
  omitted: [{ key: HEALTH, code: 'api-undecided', message: 'GET /api/salud todavía no está en el catálogo.' }],
};

function seed(): DiscoverySeed {
  return {
    sources: { [APP_ID]: [sourcesEntry()] },
    reviews: { [SNAPSHOT_ID]: { sourceId: SOURCE.id, items } },
    evidence: Object.fromEntries(items.map((i) => [`${SNAPSHOT_ID}|${i.key}`, { ...evidenceOf(i.key), relations: i.key === LIST ? [{ key: CALL, kind: 'calls', from: LIST, to: GET_LIST, basis: 'inferred', confidence: 'medium', evidence: ['e1'] }] : [] }])),
    drafts: { [FEATURE]: draft },
    architecture: { [SNAPSHOT_ID]: architecture },
    groups: {
      [`${SNAPSHOT_ID}|frontend:web`]: {
        key: 'frontend:web',
        page: 0,
        pageSize: 500,
        total: 3,
        entities: [
          { key: FEATURE, kind: 'feature', title: 'Pedidos', basis: 'inferred', confidence: 'medium', group: 'frontend:web' },
          { key: LIST, kind: 'screen', title: 'Pedidos', basis: 'observed', confidence: 'high', group: 'frontend:web', route: '/pedidos' },
          { key: DETAIL, kind: 'screen', title: 'Pedido', basis: 'observed', confidence: 'high', group: 'frontend:web', route: '/pedidos/:id' },
        ],
        relations: [{ key: CALL, kind: 'calls', from: LIST, to: GET_LIST, basis: 'inferred', confidence: 'medium', semantic: 'execution' }],
        neighbors: [{ key: GET_LIST, kind: 'api', title: 'GET /api/pedidos', basis: 'observed', confidence: 'high', group: 'service:Tienda.Api' }],
      },
    },
    relationEvidence: {
      [`${SNAPSHOT_ID}|${CALL}`]: {
        snapshotId: SNAPSHOT_ID,
        relation: { key: CALL, kind: 'calls', from: LIST, to: GET_LIST, basis: 'inferred', confidence: 'medium', evidence: ['e1', 'e2'] },
        evidence: [
          { id: 'e1', path: 'web/src/paginas.tsx', lines: { start: 3, end: 3 }, detector: 'frontend-http', confidence: 'medium', note: 'PedidosPage llama a listarPedidos' },
          { id: 'e2', path: 'web/src/http.ts', lines: { start: 2, end: 2 }, detector: 'frontend-http', confidence: 'medium', note: 'request arma GET /api/pedidos' },
        ],
      },
    },
  } as DiscoverySeed;
}

const open = () => {
  const api = installFakeApi({ apps: [app], discovery: seed() });
  renderRoute(`/apps/${APP_ID}/sources/${SNAPSHOT_ID}/architecture`);
  return api;
};

describe('Explorar arquitectura', () => {
  // Los paneles plegados se recuerdan en este navegador: cada prueba empieza con los dos a la vista.
  beforeEach(() => localStorage.clear());

  it('se abre desde la revisión y muestra grupos, cobertura y propuestas sin decidir nada', async () => {
    const api = installFakeApi({ apps: [app], discovery: seed() });
    renderRoute(`/apps/${APP_ID}/sources/${SNAPSHOT_ID}`);
    await userEvent.click(await screen.findByRole('link', { name: 'Explorar arquitectura' }));

    expect(await screen.findByRole('heading', { name: 'Arquitectura descubierta' })).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('Descubierta, no confirmada');
    expect(screen.getByRole('group', { name: 'Filtros de la vista' })).toHaveTextContent('9 hallazgos · 12 relaciones · cobertura parcial (1 sin resolver)');
    const side = screen.getByRole('complementary', { name: 'Grupos y propuestas' });
    expect(within(side).getByRole('button', { name: 'tienda-web' })).toBeInTheDocument();
    expect(within(side).getByText('Pedidos')).toBeInTheDocument();
    expect(api.discovery.applies).toHaveLength(0);
  });

  it('un vínculo muestra sus relaciones y una relación inferida, la cadena entera', async () => {
    open();
    await userEvent.click(await screen.findByRole('button', { name: /flecha frontend:web calls/ }));
    const inspector = screen.getByRole('complementary', { name: 'Detalle de la arquitectura' });
    expect(inspector).toHaveTextContent('3 relaciones: 0 observadas, 3 inferidas');
    await userEvent.click(await within(inspector).findByRole('button', { name: '/pedidos → GET /api/pedidos' }));

    expect(await within(inspector).findByRole('heading', { name: 'Por qué (2 pasos)' })).toBeInTheDocument();
    expect(inspector).toHaveTextContent('Inferida · confianza media');
    expect(inspector).toHaveTextContent('web/src/paginas.tsx:3');
    expect(inspector).toHaveTextContent('request arma GET /api/pedidos');
  });

  it('abrir un grupo lleva su detalle a la URL; un hallazgo muestra su evidencia y las limitaciones del grupo', async () => {
    open();
    const side = await screen.findByRole('complementary', { name: 'Grupos y propuestas' });
    await userEvent.click(within(side).getByRole('button', { name: 'tienda-web' }));
    const inspector = screen.getByRole('complementary', { name: 'Detalle de la arquitectura' });
    expect(within(inspector).getByRole('region', { name: 'Sin resolver' })).toHaveTextContent('http-wrapper-unresolved');

    await userEvent.click(within(side).getByRole('button', { name: 'Abrir tienda-web' }));
    expect(await screen.findByTestId('lienzo-detail')).toBeInTheDocument();
    expect(window.location.search).toBe('');
    await userEvent.click(screen.getByRole('button', { name: 'caja Pedido' }));
    expect(await within(screen.getByRole('complementary', { name: 'Detalle de la arquitectura' })).findByRole('heading', { name: 'Evidencia' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '← Vista general' }));
    expect(await screen.findByTestId('lienzo-overview')).toBeInTheDocument();
  });

  it('revisar una propuesta como conjunto: vincula lo que coincide, no elige entre ambiguas, una sola aplicación', async () => {
    const api = open();
    await userEvent.click(await screen.findByRole('button', { name: 'Revisar' }));
    const review = await screen.findByRole('complementary', { name: 'Revisar la propuesta Pedidos' });
    await within(review).findByRole('heading', { name: 'Pantallas (2)' });
    // Fuera del conjunto: no aparece.
    expect(within(review).queryByText('GET /api/otra')).not.toBeInTheDocument();
    expect(within(review).getByRole('radio', { name: 'Vincular a «Pedidos (a mano)»' })).toBeChecked();
    expect(within(review).getByRole('group', { name: 'Qué hacer con GET /api/salud' })).toHaveTextContent('Varias coinciden');
    expect(within(review).getByRole('radio', { name: 'Vincular a «Salud A»' })).not.toBeChecked();
    // Mismo nombre que una API hecha a mano, otro contrato: nada elegido, y sin elegir no hay vista previa.
    const twin = within(review).getByRole('group', { name: 'Qué hacer con Notas del pedido' });
    expect(twin).toHaveTextContent('Coincide solo por el nombre');
    for (const radio of within(twin).getAllByRole('radio')) expect(radio).not.toBeChecked();
    expect(within(review).getByRole('status')).toHaveTextContent('Elige qué hacer con 2 APIs');
    expect(within(review).getByRole('button', { name: 'Ver qué se creará' })).toBeDisabled();
    await userEvent.click(within(twin).getByRole('radio', { name: 'Crear en el catálogo' }));
    const health = within(review).getByRole('group', { name: 'Qué hacer con GET /api/salud' });
    await userEvent.click(within(health).getByRole('radio', { name: 'Dejar fuera del lienzo' }));
    // Dejar fuera la de editar.
    const put = within(review).getByRole('group', { name: 'Qué hacer con PUT /api/pedidos/{id}' });
    await userEvent.click(within(put).getByRole('radio', { name: 'Dejar fuera del lienzo' }));
    expect(review).toHaveTextContent('Entran 2 pantallas y 3 APIs (0 ya en Walkie, 1 a vincular, 2 nuevas); 2 quedan fuera.');

    await userEvent.click(within(review).getByRole('button', { name: 'Ver qué se creará' }));
    const preview = await within(review).findByRole('region', { name: 'Lo que se creará' });
    expect(preview).toHaveTextContent('2 pantallas, 1 API, 1 de navegación y 1 solicitud HTTP');
    expect(preview).toHaveTextContent('Pedidos (a mano)');
    await userEvent.click(within(review).getByRole('button', { name: 'Confirmar y crear' }));
    expect(await within(review).findByRole('link', { name: 'Abrir el lienzo' })).toBeInTheDocument();

    const [dry, real] = api.discovery.applies;
    expect(dry!.dryRun).toBe(true);
    expect(real!.dryRun).toBe(false);
    expect(real!.body.applyId).toBe(dry!.body.applyId);
    // La de mismo nombre se crea aparte: nunca un vínculo a «Notas del pedido».
    expect(real!.body.operations.map((o) => `${o.op} ${o.entityKey}`)).toEqual([`link ${GET_LIST}`, `create ${GET_ONE}`, `create ${TWIN}`, `create ${FEATURE}`]);
    expect(real!.body.operations.some((o) => o.op === 'link' && o.target?.id === SAME_NAME.id)).toBe(false);
    const feature = real!.body.operations.at(-1)!;
    expect(feature.canvas && Object.keys(feature.canvas.nodes).sort()).toEqual([GET_LIST, LIST, DETAIL].sort());
  });

  it('una propuesta con más miembros de los que se ven no se crea de una vez', async () => {
    const seeded = seed();
    seeded.architecture![SNAPSHOT_ID] = { ...architecture, proposals: [{ ...architecture.proposals[0]!, memberCount: 650 }] };
    installFakeApi({ apps: [app], discovery: seeded });
    renderRoute(`/apps/${APP_ID}/sources/${SNAPSHOT_ID}/architecture`);
    await userEvent.click(await screen.findByRole('button', { name: 'Revisar' }));
    const review = await screen.findByRole('complementary', { name: 'Revisar la propuesta Pedidos' });
    expect(await within(review).findByRole('alert')).toHaveTextContent('650 miembros y aquí se ven 7');
    expect(within(review).getByRole('link', { name: /uno por uno en la revisión/ })).toHaveAttribute('href', `/apps/${APP_ID}/sources/${SNAPSHOT_ID}`);
    expect(within(review).queryByRole('button', { name: 'Ver qué se creará' })).not.toBeInTheDocument();
  });

  it('un grupo de más de 500 hallazgos se recorre por páginas y la selección se conserva', async () => {
    const seeded = seed();
    const base = seeded.groups![`${SNAPSHOT_ID}|frontend:web`]!;
    const many = Array.from({ length: 620 }, (_, i) => ({
      key: `screen:web:/p${String(i).padStart(3, '0')}`,
      kind: 'screen' as const,
      title: `Pantalla ${i}`,
      basis: 'observed' as const,
      confidence: 'high' as const,
      group: 'frontend:web',
    }));
    seeded.groups![`${SNAPSHOT_ID}|frontend:web`] = { ...base, entities: many };
    installFakeApi({ apps: [app], discovery: seeded });
    renderRoute(`/apps/${APP_ID}/sources/${SNAPSHOT_ID}/architecture?grupo=frontend:web`);

    const pager = await screen.findByRole('navigation', { name: 'Páginas del grupo' });
    expect(within(pager).getByRole('status')).toHaveTextContent('1–500 de 620');
    expect(screen.getAllByRole('button', { name: /^caja Pantalla/ })).toHaveLength(500); // nunca los 620 a la vez
    await userEvent.click(screen.getByRole('button', { name: 'caja Pantalla 3' }));
    expect(await screen.findByRole('heading', { name: 'Pantalla 3' })).toBeInTheDocument();

    await userEvent.click(within(pager).getByRole('button', { name: 'Siguiente →' }));
    await waitFor(() => expect(within(pager).getByRole('status')).toHaveTextContent('501–620 de 620'));
    expect(screen.getAllByRole('button', { name: /^caja Pantalla/ })).toHaveLength(120);
    expect(screen.getByRole('heading', { name: 'Pantalla 3' })).toBeInTheDocument(); // la selección sigue
    expect(within(pager).getByRole('button', { name: 'Siguiente →' })).toBeDisabled();
  });

  it('los paneles se pliegan para dar más ancho al grafo', async () => {
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'Ocultar grupos' }));
    expect(screen.queryByRole('complementary', { name: 'Grupos y propuestas' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ocultar detalle' }));
    expect(screen.queryByRole('complementary', { name: 'Detalle de la arquitectura' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Mostrar grupos' }));
    expect(screen.getByRole('complementary', { name: 'Grupos y propuestas' })).toBeInTheDocument();
  });

  it('con «Solo observadas» el vínculo dice cuántas quedan a la vista, no el total', async () => {
    open();
    await userEvent.click(await screen.findByRole('button', { name: /flecha frontend:web calls/ }));
    const inspector = screen.getByRole('complementary', { name: 'Detalle de la arquitectura' });
    expect(inspector).toHaveTextContent('3 relaciones: 0 observadas, 3 inferidas');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Solo observadas' }));
    // Las 3 son inferidas: nada a la vista (que la flecha no se dibuje lo prueba `visibleLinks`).
    expect(inspector).toHaveTextContent('0 relaciones a la vista (de 3; las demás las oculta el filtro)');
  });

  it('un viewer revisa la propuesta sin poder crearla', async () => {
    installFakeApi({ apps: [{ ...app, role: 'viewer' }], discovery: seed() });
    renderRoute(`/apps/${APP_ID}/sources/${SNAPSHOT_ID}/architecture`);
    await userEvent.click(await screen.findByRole('button', { name: 'Revisar' }));
    const review = await screen.findByRole('complementary', { name: 'Revisar la propuesta Pedidos' });
    await waitFor(() => expect(review).toHaveTextContent('Tu rol en esta app es de lectura'));
    expect(within(review).queryByRole('button', { name: 'Ver qué se creará' })).not.toBeInTheDocument();
    for (const radio of within(review).getAllByRole('radio')) expect(radio).toBeDisabled();
  });
});

describe('modelo de la arquitectura', () => {
  it('filtra vínculos por significado, base y confianza; textos cortos', () => {
    const links: ArchitectureLink[] = [
      link('calls', 'execution', { high: 0, medium: 0, low: 0 }, { high: 0, medium: 0, low: 3 }),
      link('navigates', 'navigation', { high: 2, medium: 0, low: 0 }, { high: 0, medium: 0, low: 0 }),
      { ...link('contains', 'containment', { high: 1, medium: 0, low: 0 }, { high: 0, medium: 0, low: 0 }), to: 'c' },
    ];
    expect(visibleLinks(links, DEFAULT_FILTERS).map((l) => l.kind)).toEqual(['calls', 'navigates']);
    expect(visibleLinks(links, { ...DEFAULT_FILTERS, showLow: false }).map((l) => l.kind)).toEqual(['navigates']);
    expect(visibleLinks(links, { ...DEFAULT_FILTERS, onlyObserved: true }).map((l) => l.kind)).toEqual(['navigates']);
    expect(linkText(links[0]!, DEFAULT_FILTERS)).toBe('llama a ×3');
    expect(shortKey('screen:web:/pedidos/{}')).toBe('/pedidos/{}');
    expect(shortKey('api:GET /api/x')).toBe('GET /api/x');
    expect(shortKey('feature:web:Pedidos')).toBe('Pedidos');
  });

  it('cuenta exacto lo que deja ver cada filtro en un vínculo mixto (observadas e inferidas, medias y bajas)', () => {
    // 3 observadas (alta, media, baja) y 5 inferidas (2 medias, 3 bajas): 8 en total.
    const mixed = link('calls', 'execution', { high: 1, medium: 1, low: 1 }, { high: 0, medium: 2, low: 3 });
    const f = (onlyObserved: boolean, showLow: boolean) => ({ ...DEFAULT_FILTERS, onlyObserved, showLow });
    expect(linkCount(mixed, f(false, true))).toBe(8);
    expect(linkCount(mixed, f(true, true))).toBe(3); // solo observadas, con las bajas
    expect(linkCount(mixed, f(false, false))).toBe(4); // sin bajas: 2 observadas + 2 inferidas medias
    expect(linkCount(mixed, f(true, false))).toBe(2); // las dos: observadas altas y medias
    expect(linkCounts(mixed, f(true, false))).toEqual({ total: 2, observed: 2, inferred: 0, low: 0 });
    expect(linkCounts(mixed, f(false, true))).toEqual({ total: 8, observed: 3, inferred: 5, low: 4 });
    expect(linkText(mixed, f(true, false))).toBe('llama a ×2');
    // Lo que el filtro deja en cero no se dibuja: un vínculo solo de inferidas bajas con «Solo observadas».
    const onlyLowInferred = link('calls', 'execution', { high: 0, medium: 0, low: 0 }, { high: 0, medium: 0, low: 2 });
    expect(visibleLinks([onlyLowInferred], f(true, true))).toEqual([]);
    expect(visibleLinks([onlyLowInferred], f(false, false))).toEqual([]);
  });

  it('ordena la evidencia de una llamada de la pantalla a la API, aunque llegue ordenada por id', () => {
    // Lo que guardó la CLI para «/» → GET /api/apps en Walkie (ids ordenados, no la cadena).
    const stored = [
      { id: 'ev-1', symbol: 'GET /api/apps', note: 'Ruta literal sobre una base configurable · en listApps' },
      { id: 'ev-2', symbol: 'fetch', note: 'en send' },
      { id: 'ev-3', symbol: 'llama a listApps', note: 'en useApps' },
      { id: 'ev-4', symbol: 'llama a send', note: 'en request' },
      { id: 'ev-5', symbol: 'llama a useApps', note: 'en HomePage' },
    ];
    const { steps, ordered } = orderChain(stored);
    expect(ordered).toBe(true);
    expect(steps.map((e) => stepParts(e).in)).toEqual(['HomePage', 'useApps', 'listApps', 'request', 'send']);
    expect(stepParts(stored[0]!)).toEqual({ in: 'listApps', note: 'Ruta literal sobre una base configurable' });
    // Un análisis anterior (sin «en …»): queda como llegó y lo dice.
    const old = [{ id: 'a', symbol: 'fetch' }, { id: 'b', symbol: 'llama a x' }];
    expect(orderChain(old)).toEqual({ steps: old, ordered: false });
  });

  it('ubica los grupos en columnas por responsabilidad, de forma determinista', () => {
    const positions = overviewLayout(architecture.groups);
    expect(positions['frontend:web']!.x).toBeLessThan(positions['service:Tienda.Api']!.x);
    expect(overviewLayout(architecture.groups)).toEqual(positions);
  });

  it('elección inicial conservadora y operaciones en orden', () => {
    const [, , , list, one, , health, twin] = items;
    expect(initialChoice(list!)).toEqual({ op: 'link', target: `catalogItem:${HAND_MADE.id}` }); // firma
    expect(initialChoice(health!)).toEqual({ op: 'choose' }); // varias candidatas
    expect(initialChoice(twin!)).toEqual({ op: 'choose' }); // solo por título: nunca vinculada sola
    expect(initialChoice({ ...list!, status: 'linked' })).toEqual({ op: 'keep' });
    expect(initialChoice({ ...one!, status: 'created' })).toEqual({ op: 'keep' });
    expect(initialChoice({ ...one!, status: 'rejected' })).toEqual({ op: 'omit' });
    const ops = proposalOperations(architecture.proposals[0]!, [list!, one!], { [list!.key]: initialChoice(list!), [one!.key]: { op: 'create', id: 'id-1' } }, { id: 'f-1' });
    expect(ops.map((o) => o.op)).toEqual(['link', 'create', 'create']);
    expect(ops[0]).toMatchObject({ target: { kind: 'catalogItem', id: HAND_MADE.id } });
  });
});
