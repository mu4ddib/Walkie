import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiscoveryReviewItem } from '../api/client';
import { APP_ID, ITEMS, SNAPSHOT_ID, SOURCE, evidenceOf, item, sourcesEntry } from '../test/discoveryFixtures';
import { installFakeApi } from '../test/fakeApi';
import type { DiscoverySeed } from '../test/fakeDiscovery';
import { renderRoute } from '../test/render';

vi.mock('react-oidc-context', () => ({ useAuth: () => ({ user: { access_token: 'token-de-prueba' } }) }));
vi.mock('../canvas/Canvas', () => ({ Canvas: () => <div>lienzo</div> }));

const app = { id: APP_ID, name: 'Tienda de ejemplo', createdAt: '2026-01-01T00:00:00Z', featureCount: 0 };
const POST = 'api:POST /api/pedidos';
const path = `/apps/${APP_ID}/sources/${SNAPSHOT_ID}`;
const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function seed(items: DiscoveryReviewItem[] = ITEMS, overrides: Partial<DiscoverySeed> = {}): DiscoverySeed {
  return {
    sources: { [APP_ID]: [sourcesEntry()] },
    reviews: { [SNAPSHOT_ID]: { sourceId: SOURCE.id, items } },
    evidence: Object.fromEntries(items.map((i) => [`${SNAPSHOT_ID}|${i.key}`, evidenceOf(i.key)])),
    contracts: { [POST]: { http: { method: 'POST', path: '/api/pedidos' } } },
    ...overrides,
  };
}

async function openReview(discovery: DiscoverySeed = seed()) {
  const api = installFakeApi({ apps: [app], discovery });
  renderRoute(path);
  await screen.findByRole('list', { name: 'Hallazgos' });
  return api;
}

const row = (name: RegExp) => within(screen.getByRole('list', { name: 'Hallazgos' })).getByRole('button', { name });
const inspector = () => screen.getByRole('complementary', { name: 'Detalle del hallazgo' });

afterEach(() => vi.unstubAllGlobals());

describe('crear en el catálogo desde la revisión', () => {
  it('muestra qué se creará con su id, avisos y lo que queda por completar, sin crear nada hasta confirmar', async () => {
    const api = await openReview();
    await userEvent.click(row(/api:POST/));
    await userEvent.click(within(inspector()).getByRole('button', { name: 'Crear en el catálogo…' }));

    const preview = await within(inspector()).findByRole('region', { name: 'Lo que se creará' });
    expect(preview).toHaveTextContent('API');
    expect(preview).toHaveTextContent('POST /api/pedidos');
    expect(within(preview).getByRole('list', { name: 'Avisos' })).toHaveTextContent('Sin evidencia para descripción');
    expect(preview).toHaveTextContent('No se agrega a ningún lienzo');
    const planned = api.discovery.applies.at(-1)!;
    expect(planned.dryRun).toBe(true);
    expect(planned.body.operations[0]).toMatchObject({ op: 'create', entityKey: POST, bindingVersion: 0 });
    const id = planned.body.operations[0]!.id!;
    expect(id).toMatch(V7);
    expect(preview).toHaveTextContent(id);
    expect(api.catalog).toHaveLength(0);

    await userEvent.click(within(inspector()).getByRole('button', { name: 'Confirmar y crear' }));

    expect(await within(inspector()).findByRole('status')).toHaveTextContent(/^Creado en el catálogo: «/);
    const committed = api.discovery.applies.at(-1)!;
    expect(committed.dryRun).toBe(false);
    expect(committed.body.applyId).toBe(planned.body.applyId);
    expect(committed.body.operations[0]!.id).toBe(id);
    expect(api.catalog.map((c) => c.id)).toEqual([id]);
    expect(within(inspector()).getByRole('link', { name: 'Abrir en el catálogo' })).toHaveAttribute('href', `/apps/${APP_ID}/catalog/${id}`);
    await waitFor(() => expect(row(/api:POST/)).toHaveTextContent('Creado'));
  });

  it('un reintento tras un error de red usa el mismo applyId y el mismo id del elemento', async () => {
    const api = await openReview();
    await userEvent.click(row(/api:POST/));
    await userEvent.click(within(inspector()).getByRole('button', { name: 'Crear en el catálogo…' }));
    await within(inspector()).findByRole('region', { name: 'Lo que se creará' });

    api.fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await userEvent.click(within(inspector()).getByRole('button', { name: 'Confirmar y crear' }));
    expect(await within(inspector()).findByText(/no se aplicará dos veces/)).toBeInTheDocument();
    await userEvent.click(within(inspector()).getByRole('button', { name: 'Confirmar y crear' }));

    expect(await within(inspector()).findByRole('status')).toHaveTextContent(/^Creado en el catálogo: «/);
    expect(new Set(api.discovery.applies.map((a) => a.body.applyId)).size).toBe(1);
    expect(new Set(api.discovery.applies.map((a) => a.body.operations[0]!.id)).size).toBe(1);
    expect(api.catalog).toHaveLength(1);
  });

  it('cada decisión nueva de crear genera otro id y otro applyId', async () => {
    const api = await openReview();
    await userEvent.click(row(/api:POST/));
    await userEvent.click(within(inspector()).getByRole('button', { name: 'Crear en el catálogo…' }));
    await within(inspector()).findByRole('region', { name: 'Lo que se creará' });
    await userEvent.click(within(inspector()).getByRole('button', { name: 'Cancelar' }));
    await userEvent.click(within(inspector()).getByRole('button', { name: 'Crear en el catálogo…' }));
    await within(inspector()).findByRole('region', { name: 'Lo que se creará' });

    const [first, second] = api.discovery.applies;
    expect(first!.body.applyId).not.toBe(second!.body.applyId);
    expect(first!.body.operations[0]!.id).not.toBe(second!.body.operations[0]!.id);
  });

  it('un hallazgo inferido lo dice en la vista previa', async () => {
    await openReview(seed([item({ key: POST, title: 'Crear pedido', basis: 'inferred', confidence: 'medium' })]));
    await userEvent.click(row(/api:POST/));
    await userEvent.click(within(inspector()).getByRole('button', { name: 'Crear en el catálogo…' }));

    const warnings = await within(inspector()).findByRole('list', { name: 'Avisos' });
    expect(warnings).toHaveTextContent('Walkie lo dedujo');
  });

  it('con coincidencia se puede vincular o crear aparte; nunca se elige solo', async () => {
    const api = await openReview();
    await userEvent.click(row(/GET \/api\/pedidos/));

    expect(within(inspector()).getByRole('button', { name: 'Vincular…' })).toBeInTheDocument();
    expect(within(inspector()).getByRole('button', { name: 'Crear en el catálogo…' })).toBeInTheDocument();
    expect(inspector()).toHaveTextContent('puedes crearlo aparte');
    expect(api.discovery.applies).toHaveLength(0);
  });

  it('no ofrece crear pantallas, módulos, lo ya decidido ni lo que ya no aparece', async () => {
    const decided = item({ key: 'database:postgresql/tienda', kind: 'database', title: 'tienda', status: 'rejected' });
    decided.binding = {
      sourceId: SOURCE.id,
      entityKey: decided.key,
      decision: 'rejected',
      entityFingerprint: decided.fingerprint,
      snapshotId: SNAPSHOT_ID,
      decidedBy: 'usuario-demo',
      decidedAt: '2026-11-14T12:30:00Z',
      version: 1,
    };
    await openReview(
      seed([
        item({ key: 'screen:/pedidos', kind: 'screen', title: 'Pedidos' }),
        item({ key: 'module:Tienda.Pedidos', kind: 'module', title: 'Pedidos (módulo)', basis: 'inferred', confidence: 'medium' }),
        decided,
        item({ key: 'api:DELETE /api/viejo', status: 'missing', proposal: { op: 'none' } }),
      ]),
    );

    for (const name of [/screen:/, /module:/, /database:/, /DELETE/]) {
      await userEvent.click(row(name));
      expect(within(inspector()).queryByRole('button', { name: /Crear en el catálogo/ })).not.toBeInTheDocument();
    }
    await userEvent.click(row(/module:/));
    expect(inspector()).toHaveTextContent('Crear módulos y features desde un hallazgo llegará más adelante');
  });

  it('si la API compensa, lo dice y no muestra un elemento creado', async () => {
    const api = await openReview();
    api.discovery.next.compensate = true;
    await userEvent.click(row(/api:POST/));
    await userEvent.click(within(inspector()).getByRole('button', { name: 'Crear en el catálogo…' }));
    await within(inspector()).findByRole('region', { name: 'Lo que se creará' });
    await userEvent.click(within(inspector()).getByRole('button', { name: 'Confirmar y crear' }));

    expect(await within(inspector()).findByRole('alert')).toHaveTextContent('se deshizo lo que se había creado');
    expect(within(inspector()).queryByRole('link', { name: 'Abrir en el catálogo' })).not.toBeInTheDocument();
    expect(api.catalog).toHaveLength(0);
  });

  it('un vínculo a un elemento borrado no se presenta como válido', async () => {
    const created = item({ key: POST, title: 'Crear pedido', status: 'created', proposal: { op: 'none' }, targetMissing: true });
    created.binding = {
      sourceId: SOURCE.id,
      entityKey: POST,
      decision: 'created',
      target: { kind: 'catalogItem', id: 'cat-borrado', title: 'Crear pedido' },
      entityFingerprint: created.fingerprint,
      snapshotId: SNAPSHOT_ID,
      decidedBy: 'usuario-demo',
      decidedAt: '2026-11-14T12:30:00Z',
      version: 1,
    };
    await openReview(seed([created]));
    await userEvent.click(row(/api:POST/));

    expect(within(inspector()).getByRole('note')).toHaveTextContent('Ese elemento ya no existe en Walkie');
    expect(within(inspector()).queryByRole('link', { name: 'Abrir en el catálogo' })).not.toBeInTheDocument();
    expect(within(inspector()).getByRole('button', { name: 'Restablecer decisión…' })).toBeInTheDocument();
  });
});

describe('evidencia: ausencia frente a error', () => {
  it('un hallazgo sin evidencia guardada no se muestra como un fallo', async () => {
    await openReview(seed(ITEMS, { evidence: {} }));
    await userEvent.click(row(/api:POST/));

    expect(await within(inspector()).findByText('Este hallazgo no tiene evidencia guardada en este análisis.')).toBeInTheDocument();
    expect(within(inspector()).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('uno que ya no aparece explica que la evidencia anterior no está disponible', async () => {
    await openReview(seed([item({ key: 'api:DELETE /api/viejo', status: 'missing', proposal: { op: 'none' } })], { evidence: {} }));
    await userEvent.click(row(/DELETE/));

    expect(await within(inspector()).findByText(/la evidencia del anterior no está disponible/)).toBeInTheDocument();
  });

  it('un error de red sí es un fallo y se puede reintentar', async () => {
    const api = await openReview();
    const original = api.fetchMock.getMockImplementation()!;
    // Falla el pedido y sus reintentos automáticos (TanStack Query reintenta dos veces lo que no es un 404).
    let failures = 3;
    api.fetchMock.mockImplementation(async (input, init) => {
      if (failures > 0 && String(input).includes('/evidence?')) {
        failures--;
        throw new TypeError('Failed to fetch');
      }
      return original(input, init);
    });
    await userEvent.click(row(/api:POST/));

    const alert = await within(inspector()).findByRole('alert', {}, { timeout: 8000 });
    expect(alert).toHaveTextContent('No se pudo cargar la evidencia.');
    await userEvent.click(within(alert).getByRole('button', { name: 'Reintentar' }));
    expect(await within(inspector()).findByText('src/Tienda.Api/Pedidos/PedidosEndpoints.cs:12-14')).toBeInTheDocument();
  }, 15000);
});

describe('el elemento creado en el catálogo', () => {
  it('se abre en el catálogo de siempre, con su procedencia, y se puede editar', async () => {
    const api = await openReview();
    await userEvent.click(row(/api:POST/));
    await userEvent.click(within(inspector()).getByRole('button', { name: 'Crear en el catálogo…' }));
    await within(inspector()).findByRole('region', { name: 'Lo que se creará' });
    await userEvent.click(within(inspector()).getByRole('button', { name: 'Confirmar y crear' }));
    await userEvent.click(await within(inspector()).findByRole('link', { name: 'Abrir en el catálogo' }));

    const detail = await screen.findByRole('complementary', { name: 'Detalle del elemento' });
    const provenance = await within(detail).findByRole('region', { name: 'De dónde viene' });
    expect(provenance).toHaveTextContent('Creado desde');
    expect(provenance).toHaveTextContent(SOURCE.name);
    expect(provenance).toHaveTextContent('src/Tienda.Api/Pedidos/PedidosEndpoints.cs:12-14');
    expect(within(provenance).getByRole('link', { name: 'Ver en la revisión' })).toHaveAttribute('href', path);
    // El texto del paquete es texto: el título hostil no se vuelve HTML.
    expect(document.querySelector('.discovery-provenance img')).toBeNull();

    // La procedencia no bloquea editar.
    const title = within(detail).getByLabelText('Título');
    await userEvent.clear(title);
    await userEvent.type(title, 'Crear un pedido');
    await userEvent.click(within(detail).getByRole('button', { name: /^Guardar/ }));
    await waitFor(() => expect(api.catalog[0]!.title).toBe('Crear un pedido'));
    expect(api.catalog[0]!.version).toBe(2);
  });

  it('con Discovery apagado el catálogo no muestra procedencia', async () => {
    installFakeApi({ apps: [app], catalog: [{ id: 'cat-1', appId: APP_ID, type: 'api', title: 'Consultar pedido', version: 1 }] });
    renderRoute(`/apps/${APP_ID}/catalog/cat-1`);

    const detail = await screen.findByRole('complementary', { name: 'Detalle del elemento' });
    await within(detail).findByLabelText('Título');
    await waitFor(() => expect(within(detail).queryByRole('region', { name: 'De dónde viene' })).not.toBeInTheDocument());
  });
});
