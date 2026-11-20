import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ArchitectureLink, DiscoveryArchitecture, DiscoveryReviewItem } from '../../api/client';
import { APP_ID, SNAPSHOT_ID, SOURCE, evidenceOf, item, sourcesEntry } from '../../test/discoveryFixtures';
import { installFakeApi } from '../../test/fakeApi';
import type { DiscoverySeed } from '../../test/fakeDiscovery';
import { renderRoute } from '../../test/render';
import type { CanvasDraft } from '../initialCanvas';
import type { ArchitectureSelection } from './ArchitectureCanvas';
import { DEFAULT_FILTERS, linkText, overviewLayout, shortKey, visibleLinks } from './architectureModel';
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
const FEATURE = 'feature:web:Pedidos';
const LIST = 'screen:web:/pedidos';
const DETAIL = 'screen:web:/pedidos/{}';
const GET_LIST = 'api:GET /api/pedidos';
const GET_ONE = 'api:GET /api/pedidos/{}';
const PUT_ONE = 'api:PUT /api/pedidos/{}';
const HEALTH = 'api:GET /api/salud';
const HAND_MADE = { kind: 'catalogItem' as const, id: '0198f0c0-1111-7000-8000-000000000001', title: 'Pedidos (a mano)' };
const CALL = `calls|${LIST}|${GET_LIST}`;

const architecture: DiscoveryArchitecture = {
  snapshotId: SNAPSHOT_ID,
  completeness: 'partial',
  totals: { entities: 9, relations: 12 },
  groups: [
    { key: 'frontend:web', kind: 'frontend', title: 'tienda-web', counts: { screen: 2, feature: 1 }, internal: { navigation: 1 }, limitations: 1, incomplete: 1 },
    { key: 'service:Tienda.Api', kind: 'service', title: 'Tienda.Api', counts: { api: 4, service: 1 }, internal: {}, limitations: 0, incomplete: 0 },
  ],
  links: [{ from: 'frontend:web', to: 'service:Tienda.Api', kind: 'calls', semantic: 'execution', total: 3, observed: 0, inferred: 3, low: 0 }],
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
      members: [GET_LIST, GET_ONE, HEALTH, PUT_ONE, LIST, DETAIL],
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
    // Dejar fuera la de editar.
    const put = within(review).getByRole('group', { name: 'Qué hacer con PUT /api/pedidos/{id}' });
    await userEvent.click(within(put).getByRole('radio', { name: 'Dejar fuera del lienzo' }));

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
    expect(real!.body.operations.map((o) => `${o.op} ${o.entityKey}`)).toEqual([`link ${GET_LIST}`, `create ${GET_ONE}`, `create ${FEATURE}`]);
    const feature = real!.body.operations.at(-1)!;
    expect(feature.canvas && Object.keys(feature.canvas.nodes).sort()).toEqual([GET_LIST, LIST, DETAIL].sort());
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
      { from: 'a', to: 'b', kind: 'calls', semantic: 'execution', total: 3, observed: 0, inferred: 3, low: 3 },
      { from: 'a', to: 'b', kind: 'navigates', semantic: 'navigation', total: 2, observed: 2, inferred: 0, low: 0 },
      { from: 'a', to: 'c', kind: 'contains', semantic: 'containment', total: 1, observed: 1, inferred: 0, low: 0 },
    ];
    expect(visibleLinks(links, DEFAULT_FILTERS).map((l) => l.kind)).toEqual(['calls', 'navigates']);
    expect(visibleLinks(links, { ...DEFAULT_FILTERS, showLow: false }).map((l) => l.kind)).toEqual(['navigates']);
    expect(visibleLinks(links, { ...DEFAULT_FILTERS, onlyObserved: true }).map((l) => l.kind)).toEqual(['navigates']);
    expect(linkText(links[0]!)).toBe('llama a ×3');
    expect(shortKey('screen:web:/pedidos/{}')).toBe('/pedidos/{}');
    expect(shortKey('api:GET /api/x')).toBe('GET /api/x');
    expect(shortKey('feature:web:Pedidos')).toBe('Pedidos');
  });

  it('ubica los grupos en columnas por responsabilidad, de forma determinista', () => {
    const positions = overviewLayout(architecture.groups);
    expect(positions['frontend:web']!.x).toBeLessThan(positions['service:Tienda.Api']!.x);
    expect(overviewLayout(architecture.groups)).toEqual(positions);
  });

  it('elección inicial conservadora y operaciones en orden', () => {
    const [, , , list, one, , health] = items;
    expect(initialChoice(list!)).toEqual({ op: 'link', target: `catalogItem:${HAND_MADE.id}` });
    expect(initialChoice(health!)).toEqual({ op: 'omit' });
    expect(initialChoice({ ...one!, status: 'created' })).toEqual({ op: 'keep' });
    expect(initialChoice({ ...one!, status: 'rejected' })).toEqual({ op: 'omit' });
    const ops = proposalOperations(architecture.proposals[0]!, [list!, one!], { [list!.key]: initialChoice(list!), [one!.key]: { op: 'create', id: 'id-1' } }, { id: 'f-1' });
    expect(ops.map((o) => o.op)).toEqual(['link', 'create', 'create']);
    expect(ops[0]).toMatchObject({ target: { kind: 'catalogItem', id: HAND_MADE.id } });
  });
});
