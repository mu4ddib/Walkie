import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiscoveryReviewItem } from '../api/client';
import { APP_ID, SNAPSHOT_ID, SOURCE, evidenceOf, item, sourcesEntry } from '../test/discoveryFixtures';
import { installFakeApi } from '../test/fakeApi';
import type { DiscoverySeed } from '../test/fakeDiscovery';
import { renderRoute } from '../test/render';
import type { CanvasDraft } from './initialCanvas';

vi.mock('react-oidc-context', () => ({ useAuth: () => ({ user: { access_token: 'token-de-prueba' } }) }));
vi.mock('../canvas/Canvas', () => ({ Canvas: () => <div>lienzo</div> }));

const app = { id: APP_ID, name: 'Tienda de ejemplo', createdAt: '2026-01-01T00:00:00Z', featureCount: 0 };
const FEATURE = 'feature:tienda:Pedidos';
const MODULE = 'module:Pedidos';
const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const featureDraft: CanvasDraft = {
  nodes: [
    { key: 'screen:tienda:/pedidos', type: 'screen', title: 'Pedidos', route: '/pedidos' },
    { key: 'screen:tienda:/pedidos/{}', type: 'screen', title: 'Pedido', route: '/pedidos/:id' },
    { key: 'api:GET /api/pedidos', type: 'ref', title: 'Lista de pedidos', catalogId: '0198f0c0-1111-7000-8000-000000000001' },
  ],
  edges: [
    { key: 'navigates:a', from: 'screen:tienda:/pedidos', to: 'screen:tienda:/pedidos/{}', kind: 'navigation', operation: 'navigation' },
    { key: 'calls:a', from: 'screen:tienda:/pedidos', to: 'api:GET /api/pedidos', kind: 'request', operation: 'http.request' },
  ],
  interfaces: [],
  omitted: [
    { key: 'api:GET /api/salud', code: 'ambiguous-api', message: 'GET /api/salud lo publican Compras.Api, Ventas.Api: el análisis no sabe a cuál llaman.' },
    { key: 'api:GET /api/pedidos/{}', code: 'api-undecided', message: 'GET /api/pedidos/{} todavía no está en el catálogo.' },
  ],
};

const moduleDraft: CanvasDraft = {
  nodes: [{ key: 'api:GET /api/pedidos', type: 'ref', title: 'Lista de pedidos', catalogId: '0198f0c0-1111-7000-8000-000000000001' }],
  edges: [],
  interfaces: [{ key: 'api:GET /api/pedidos', name: 'Lista de pedidos', kind: 'provides', node: 'api:GET /api/pedidos' }],
  omitted: [],
};

const items: DiscoveryReviewItem[] = [
  item({ key: FEATURE, kind: 'feature', title: 'Pedidos', basis: 'inferred', confidence: 'low', proposal: { op: 'create' } }),
  item({ key: MODULE, kind: 'module', title: 'Pedidos', basis: 'inferred', confidence: 'medium', proposal: { op: 'create' } }),
  item({ key: 'api:GET /api/pedidos/{}', kind: 'api', title: 'GET /api/pedidos/{}' }),
];

function seed(): DiscoverySeed {
  return {
    sources: { [APP_ID]: [sourcesEntry()] },
    reviews: { [SNAPSHOT_ID]: { sourceId: SOURCE.id, items } },
    evidence: Object.fromEntries(items.map((i) => [`${SNAPSHOT_ID}|${i.key}`, evidenceOf(i.key)])),
    drafts: { [FEATURE]: featureDraft, [MODULE]: moduleDraft },
  };
}

async function openReview() {
  const api = installFakeApi({ apps: [app], discovery: seed() });
  renderRoute(`/apps/${APP_ID}/sources/${SNAPSHOT_ID}`);
  await screen.findByRole('list', { name: 'Hallazgos' });
  return api;
}

const row = (name: RegExp) => within(screen.getByRole('list', { name: 'Hallazgos' })).getByRole('button', { name });
const inspector = () => screen.getByRole('complementary', { name: 'Detalle del hallazgo' });

afterEach(() => vi.unstubAllGlobals());

describe('crear módulos y features desde la revisión (tarea 9)', () => {
  it('la vista previa muestra pantallas, llamadas y lo que no entra, y al confirmar manda ids y posiciones', async () => {
    const api = await openReview();
    await userEvent.click(row(/feature:tienda:Pedidos/));
    await userEvent.click(within(inspector()).getByRole('button', { name: 'Crear feature…' }));

    const preview = await within(inspector()).findByRole('region', { name: 'Lo que se creará' });
    expect(preview).toHaveTextContent('Pedidos (/pedidos), Pedido (/pedidos/:id)');
    expect(preview).toHaveTextContent('Lista de pedidos');
    expect(preview).toHaveTextContent('1 de navegación y 1 solicitud HTTP');
    const omitted = within(preview).getByRole('list', { name: 'Lo que no entra' });
    expect(omitted).toHaveTextContent('Ambigua');
    expect(omitted).toHaveTextContent('Compras.Api, Ventas.Api');
    expect(within(preview).getByRole('list', { name: 'Avisos' })).toHaveTextContent('lo publican Compras.Api');
    expect(api.discovery.applies.at(-1)!.dryRun).toBe(true);
    expect(api.discovery.applies.at(-1)!.body.operations[0]!.canvas).toBeUndefined();

    await userEvent.click(within(inspector()).getByRole('button', { name: 'Confirmar y crear' }));

    expect(await within(inspector()).findByRole('status')).toHaveTextContent('Feature creada: «Pedidos», con su lienzo inicial.');
    const committed = api.discovery.applies.at(-1)!.body.operations[0]!;
    expect(committed.canvas).toBeDefined();
    expect(Object.keys(committed.canvas!.nodes).sort()).toEqual(featureDraft.nodes.map((n) => n.key).sort());
    Object.values(committed.canvas!.nodes).forEach((id) => expect(id).toMatch(V7));
    expect(Object.keys(committed.canvas!.layout)).toHaveLength(3);
    expect(within(inspector()).getByRole('link', { name: 'Abrir la feature' })).toHaveAttribute(
      'href',
      `/apps/${APP_ID}/features/${committed.id}`,
    );
    await waitFor(() => expect(row(/feature:tienda:Pedidos/)).toHaveTextContent('Creado'));
  });

  it('puede crear en la misma solicitud las APIs que faltan, antes que la feature', async () => {
    const api = await openReview();
    await userEvent.click(row(/feature:tienda:Pedidos/));
    await userEvent.click(within(inspector()).getByRole('button', { name: 'Crear feature…' }));
    await within(inspector()).findByRole('region', { name: 'Lo que se creará' });

    await userEvent.click(within(inspector()).getByRole('checkbox', { name: /Crear también en el catálogo las APIs que faltan \(1\)/ }));

    await waitFor(() => expect(api.discovery.applies.at(-1)!.body.operations).toHaveLength(2));
    const ops = api.discovery.applies.at(-1)!.body.operations;
    expect(ops[0]).toMatchObject({ op: 'create', entityKey: 'api:GET /api/pedidos/{}' });
    expect(ops[1]).toMatchObject({ op: 'create', entityKey: FEATURE });
    const omitted = await within(inspector()).findByRole('list', { name: 'Lo que no entra' });
    await waitFor(() => expect(omitted).not.toHaveTextContent('todavía no está en el catálogo'));
  });

  it('un módulo muestra sus interfaces y se puede renombrar antes de crearlo', async () => {
    const api = await openReview();
    await userEvent.click(row(/module:Pedidos/));
    await userEvent.click(within(inspector()).getByRole('button', { name: 'Crear módulo…' }));
    const preview = await within(inspector()).findByRole('region', { name: 'Lo que se creará' });
    expect(preview).toHaveTextContent('Lista de pedidos (ofrece Lista de pedidos)');

    const name = within(preview).getByLabelText('Nombre');
    await userEvent.clear(name);
    await userEvent.type(name, 'Pedidos compartidos');
    await userEvent.click(within(inspector()).getByRole('button', { name: 'Confirmar y crear' }));

    expect(await within(inspector()).findByRole('status')).toHaveTextContent('Módulo creado: «Pedidos compartidos»');
    const op = api.discovery.applies.at(-1)!.body.operations[0]!;
    expect(op.name).toBe('Pedidos compartidos');
    expect(Object.keys(op.canvas!.interfaces ?? {})).toEqual(['api:GET /api/pedidos']);
    expect(within(inspector()).getByRole('link', { name: 'Abrir el módulo' })).toHaveAttribute('href', `/apps/${APP_ID}/modules/${op.id}`);
  });
});
