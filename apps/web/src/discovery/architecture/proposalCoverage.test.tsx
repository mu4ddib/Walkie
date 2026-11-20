import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiscoveryArchitecture, DiscoveryReviewItem } from '../../api/client';
import { APP_ID, SNAPSHOT_ID, SOURCE, item, sourcesEntry } from '../../test/discoveryFixtures';
import { installFakeApi } from '../../test/fakeApi';
import type { DiscoverySeed } from '../../test/fakeDiscovery';
import { renderRoute } from '../../test/render';
import type { CanvasDraft } from '../initialCanvas';
import { memberCoverage } from './proposalModel';

vi.mock('react-oidc-context', () => ({ useAuth: () => ({ user: { access_token: 'token-de-prueba' } }) }));
vi.mock('../../canvas/Canvas', () => ({ Canvas: () => <div>lienzo</div> }));
vi.mock('./ArchitectureCanvas', () => ({ ArchitectureCanvas: () => <div data-testid="lienzo" /> }));

/**
 * El conjunto revisado es el conjunto que se crea (cierre del PR B): propuestas de 499, 500 y 501 miembros, y los casos en
 * que algo de la revisión cambió o no llegó. Nunca se incorpora en silencio un miembro que la persona no vio.
 */
const app = { id: APP_ID, name: 'Tienda de ejemplo', createdAt: '2026-01-01T00:00:00Z', featureCount: 0 };
const FEATURE = 'feature:web:Pedidos';
const LIST = 'screen:web:/pedidos';
const DETAIL = 'screen:web:/pedidos/{}';
const apiKey = (i: number) => `api:GET /api/pedidos/r${String(i).padStart(3, '0')}`;

/** Una propuesta con `members` miembros (2 pantallas y el resto APIs) y `total` en el análisis. */
function seed(members: number, options: { total?: number; tweak?: (items: DiscoveryReviewItem[]) => void; drop?: string } = {}): DiscoverySeed {
  const keys = [LIST, DETAIL, ...Array.from({ length: members - 2 }, (_, i) => apiKey(i))];
  const items: DiscoveryReviewItem[] = [
    item({ key: FEATURE, kind: 'feature', title: 'Pedidos', basis: 'inferred', confidence: 'medium' }),
    item({ key: LIST, kind: 'screen', title: 'Pedidos' }),
    item({ key: DETAIL, kind: 'screen', title: 'Pedido' }),
    ...keys.slice(2).map((key, i) => item({ key, title: `GET /api/pedidos/r${i}` })),
  ];
  options.tweak?.(items);
  const architecture: DiscoveryArchitecture = {
    snapshotId: SNAPSHOT_ID,
    completeness: 'complete',
    totals: { entities: items.length, relations: 0 },
    groups: [{ key: 'frontend:web', kind: 'frontend', title: 'tienda-web', counts: { screen: 2 }, internal: {}, limitations: 0, incomplete: 0 }],
    links: [],
    proposals: [
      {
        key: FEATURE,
        title: 'Pedidos',
        group: 'frontend:web',
        confidence: 'medium',
        strength: 'evidence',
        screens: 2,
        apis: members - 2,
        navigation: 1,
        requests: members - 2,
        unresolved: 0,
        members: keys.slice(0, 500),
        memberCount: options.total ?? members,
      },
    ],
    limitations: [],
  };
  const draft: CanvasDraft = {
    nodes: [
      { key: LIST, type: 'screen', title: 'Pedidos', route: '/pedidos' },
      { key: DETAIL, type: 'screen', title: 'Pedido', route: '/pedidos/:id' },
    ],
    edges: [{ key: 'navigates:a', from: LIST, to: DETAIL, kind: 'navigation', operation: 'navigation' }],
    interfaces: [],
    omitted: [],
  };
  return {
    sources: { [APP_ID]: [sourcesEntry()] },
    reviews: { [SNAPSHOT_ID]: { sourceId: SOURCE.id, items: items.filter((i) => i.key !== options.drop) } },
    drafts: { [FEATURE]: draft },
    architecture: { [SNAPSHOT_ID]: architecture },
  };
}

async function openReview(discovery: DiscoverySeed) {
  const api = installFakeApi({ apps: [app], discovery });
  renderRoute(`/apps/${APP_ID}/sources/${SNAPSHOT_ID}/architecture`);
  await userEvent.click(await screen.findByRole('button', { name: 'Revisar' }));
  const review = await screen.findByRole('complementary', { name: 'Revisar la propuesta Pedidos' });
  return { api, review };
}

describe('revisión por conjuntos: el conjunto revisado es el que se crea', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.useRealTimers());

  it.each([499, 500])('con %i miembros los revisa todos y deja crear', async (members) => {
    const { api, review } = await openReview(seed(members));
    expect(await within(review).findByRole('heading', { name: `APIs que llaman (${members - 2})` })).toBeInTheDocument();
    expect(within(review).queryByRole('alert')).not.toBeInTheDocument();
    await userEvent.click(within(review).getByRole('button', { name: 'Ver qué se creará' }));
    await within(review).findByRole('region', { name: 'Lo que se creará' });
    await userEvent.click(within(review).getByRole('button', { name: 'Confirmar y crear' }));
    await within(review).findByRole('link', { name: 'Abrir el lienzo' });
    const real = api.discovery.applies.find((a) => !a.dryRun)!;
    // Una creación por API revisada, más la feature: ninguna de más.
    expect(real.body.operations.filter((o) => o.entityKey.startsWith('api:'))).toHaveLength(members - 2);
    expect(real.body.operations.at(-1)!.entityKey).toBe(FEATURE);
  });

  it('con 501 miembros no deja crear de una vez y lleva a la revisión individual', async () => {
    const { api, review } = await openReview(seed(501));
    expect(await within(review).findByRole('alert')).toHaveTextContent('501 miembros y aquí se ven 500');
    expect(within(review).queryByRole('button', { name: 'Ver qué se creará' })).not.toBeInTheDocument();
    expect(api.discovery.applies).toHaveLength(0);
  });

  it('con 500 miembros y una API descartada, la descartada queda fuera y lo dice', async () => {
    const { api, review } = await openReview(
      seed(500, { tweak: (items) => Object.assign(items.find((i) => i.key === apiKey(7))!, { status: 'rejected' }) }),
    );
    await within(review).findByRole('heading', { name: 'APIs que llaman (498)' });
    expect(review).toHaveTextContent('Entran 2 pantallas y 497 APIs (0 ya en Walkie, 0 a vincular, 497 nuevas); 1 queda fuera.');
    await userEvent.click(within(review).getByRole('button', { name: 'Ver qué se creará' }));
    await within(review).findByRole('region', { name: 'Lo que se creará' });
    await userEvent.click(within(review).getByRole('button', { name: 'Confirmar y crear' }));
    await within(review).findByRole('link', { name: 'Abrir el lienzo' });
    const real = api.discovery.applies.find((a) => !a.dryRun)!;
    expect(real.body.operations.some((o) => o.entityKey === apiKey(7))).toBe(false);
  });

  it('con 500 miembros y una coincidencia solo por título, espera la elección', async () => {
    const target = { kind: 'catalogItem' as const, id: 'cat-9', title: 'GET /api/pedidos/r3' };
    const { api, review } = await openReview(
      seed(500, {
        tweak: (items) =>
          Object.assign(items.find((i) => i.key === apiKey(3))!, { status: 'matched', match: { target, reason: 'title' }, proposal: { op: 'create' } }),
      }),
    );
    await within(review).findByRole('heading', { name: 'APIs que llaman (498)' });
    expect(within(review).getByRole('status')).toHaveTextContent('Elige qué hacer con 1 API');
    expect(within(review).getByRole('button', { name: 'Ver qué se creará' })).toBeDisabled();
    expect(within(review).getByRole('radio', { name: 'Vincular a «GET /api/pedidos/r3»' })).not.toBeChecked();
    expect(api.discovery.applies).toHaveLength(0);
  });

  it('si algo cambió entre la vista previa y la confirmación, no crea nada y pide revisar de nuevo', async () => {
    const { api, review } = await openReview(seed(10));
    await within(review).findByRole('heading', { name: 'APIs que llaman (8)' });
    await userEvent.click(within(review).getByRole('button', { name: 'Ver qué se creará' }));
    await within(review).findByRole('region', { name: 'Lo que se creará' });
    api.discovery.next.applyStatus = 409; // otra persona decidió sobre un miembro (su versión cambió)
    await userEvent.click(within(review).getByRole('button', { name: 'Confirmar y crear' }));
    expect(await within(review).findByRole('alert')).toHaveTextContent('Algo de este conjunto cambió');
    expect(within(review).getByRole('button', { name: 'Confirmar y crear' })).toBeDisabled();
    expect(within(review).queryByRole('link', { name: 'Abrir el lienzo' })).not.toBeInTheDocument();
  });

  it('si un miembro no llegó en la respuesta, no deja crear', async () => {
    const { api, review } = await openReview(seed(500, { drop: apiKey(42) }));
    const alert = await within(review).findByRole('alert');
    expect(alert).toHaveTextContent('Un miembro de la propuesta no llegó a esta revisión');
    expect(alert).toHaveTextContent(apiKey(42));
    expect(within(review).queryByRole('button', { name: 'Ver qué se creará' })).not.toBeInTheDocument();
    expect(api.discovery.applies).toHaveLength(0);
  });

  it('si los miembros no se pudieron cargar (red), no deja crear y ofrece reintentar', async () => {
    const discovery = seed(20);
    const api = installFakeApi({ apps: [app], discovery });
    const fake = window.fetch;
    // Los miembros (la consulta con muchas claves) fallan siempre por red; la propuesta sola responde.
    window.fetch = (input, init) =>
      String(input).includes('/review?') && (String(input).match(/[?&]key=/g) ?? []).length > 1 ? Promise.reject(new TypeError('Failed to fetch')) : fake(input, init);
    renderRoute(`/apps/${APP_ID}/sources/${SNAPSHOT_ID}/architecture`);
    await userEvent.click(await screen.findByRole('button', { name: 'Revisar' }));
    const review = await screen.findByRole('complementary', { name: 'Revisar la propuesta Pedidos' });
    await waitFor(() => expect(within(review).getByRole('alert')).toHaveTextContent('No se pudieron cargar todos los miembros'), { timeout: 8000 });
    expect(within(review).queryByRole('button', { name: 'Ver qué se creará' })).not.toBeInTheDocument();
    expect(within(review).getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    expect(api.discovery.applies).toHaveLength(0);
  }, 15000);
});

describe('memberCoverage', () => {
  const members = (n: number) => Array.from({ length: n }, (_, i) => `k${i}`);
  it('completo solo si llegó cada miembro pedido y la lista no está truncada', () => {
    const all = members(500);
    expect(memberCoverage({ members: all, memberCount: 500 }, all.map((key) => ({ key })))).toEqual({ complete: true });
    expect(memberCoverage({ members: all, memberCount: 501 }, all.map((key) => ({ key })))).toEqual({ complete: false, reason: 'truncated', missing: [] });
    expect(memberCoverage({ members: all, memberCount: 500 }, all.slice(1).map((key) => ({ key })))).toEqual({
      complete: false,
      reason: 'missing',
      missing: ['k0'],
    });
  });
});
