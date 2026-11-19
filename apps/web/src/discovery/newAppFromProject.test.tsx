import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_ID, OLD_SNAPSHOT_ID, SNAPSHOT_ID, SOURCE, item, snapshot, sourcesEntry, uploadSummary } from '../test/discoveryFixtures';
import { installFakeApi } from '../test/fakeApi';
import type { DiscoverySeed } from '../test/fakeDiscovery';
import { renderRoute } from '../test/render';

vi.mock('react-oidc-context', () => ({ useAuth: () => ({ user: { access_token: 'token-de-prueba' } }) }));
vi.mock('../canvas/Canvas', () => ({ Canvas: () => <div>lienzo</div> }));

const existing = { id: 'app-0', name: 'Otra app', createdAt: '2026-01-01T00:00:00Z', featureCount: 0 };
const pack = (name = 'tienda.walkiepack') => new File([new Uint8Array(4)], name, { type: 'application/zip' });

function seed(overrides: Partial<DiscoverySeed> = {}): DiscoverySeed {
  return {
    sources: {},
    reviews: { [SNAPSHOT_ID]: { sourceId: SOURCE.id, items: [item({ key: 'api:GET /api/pedidos', needsReview: true })] } },
    upload: { summary: uploadSummary(), snapshot: snapshot() },
    ...overrides,
  };
}

const imports = (api: ReturnType<typeof installFakeApi>) =>
  api.fetchMock.mock.calls
    .filter(([u, init]) => String(u).includes('/api/sources/import') && init?.method === 'POST')
    .map(([u, init]) => ({
      dryRun: String(u).includes('dryRun=true'),
      name: (init!.body as FormData).get('name'),
      importId: (init!.body as FormData).get('importId'),
    }));

async function openDialog(discovery = seed()) {
  const api = installFakeApi({ apps: [existing], discovery });
  const user = userEvent.setup();
  renderRoute('/apps');
  await user.click(await screen.findByRole('button', { name: 'Crear app desde proyecto local' }));
  const dialog = screen.getByRole('dialog', { name: 'Crear app desde proyecto local' });
  return { api, user, dialog };
}

afterEach(() => vi.unstubAllGlobals());

describe('Crear app desde proyecto local (galería de apps)', () => {
  it('con Discovery apagado (404) no ofrece la opción y las otras siguen', async () => {
    installFakeApi({ apps: [existing] });
    renderRoute('/apps');
    expect(await screen.findByRole('button', { name: 'Importar app' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Otra app')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Crear app desde proyecto local' })).not.toBeInTheDocument();
  });

  it('guía con la CLI, revisa el paquete sin crear nada y propone un nombre editable', async () => {
    const { api, user, dialog } = await openDialog();
    expect(dialog).toHaveTextContent('walkie scan .');
    expect(dialog).toHaveTextContent('Importar app'); // explica que no es un .walkie

    await user.upload(within(dialog).getByLabelText('Archivo .walkiepack'), pack());
    const name = await within(dialog).findByLabelText('Nombre de la app');
    expect(name).toHaveValue(SOURCE.name);
    expect(dialog).toHaveTextContent('No se crean features, catálogo ni lienzos');
    expect(imports(api)).toEqual([{ dryRun: true, name: null, importId: null }]);
    expect(api.apps).toHaveLength(1);
  });

  it('rechaza otro archivo antes de subirlo', async () => {
    const { api, user, dialog } = await openDialog();
    void user;
    fireEvent.change(within(dialog).getByLabelText('Archivo .walkiepack'), { target: { files: [new File(['x'], 'app.walkie')] } });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/walkiepack/);
    expect(imports(api)).toEqual([]);
  });

  it('crea con el nombre elegido y abre la revisión de su primer análisis', async () => {
    const { api, user, dialog } = await openDialog();
    await user.upload(within(dialog).getByLabelText('Archivo .walkiepack'), pack());
    const name = await within(dialog).findByLabelText('Nombre de la app');
    await user.clear(name);
    await user.type(name, 'Tienda local');
    await user.click(within(dialog).getByRole('button', { name: 'Crear app' }));

    expect(await screen.findByRole('heading', { name: 'Revisión del análisis' })).toBeInTheDocument();
    const created = api.apps.find((a) => a.name === 'Tienda local')!;
    expect(created).toBeDefined();
    const reviewed = api.fetchMock.mock.calls.map(([u]) => String(u)).find((u) => u.includes(`/api/snapshots/${SNAPSHOT_ID}/review`));
    expect(reviewed).toBeDefined();
    expect(await screen.findByRole('link', { name: 'Tienda local' })).toHaveAttribute('href', `/apps/${created.id}`);
    const [, commit] = imports(api);
    expect(commit).toMatchObject({ dryRun: false, name: 'Tienda local' });
    expect(commit!.importId).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.getByRole('note')).toHaveTextContent('Es el primer análisis');
  });

  it('tras un error de red reintenta con el mismo importId y no crea dos apps', async () => {
    const { api, user, dialog } = await openDialog();
    await user.upload(within(dialog).getByLabelText('Archivo .walkiepack'), pack());
    await within(dialog).findByLabelText('Nombre de la app');
    api.discovery.next.importNetworkError = true;
    await user.click(within(dialog).getByRole('button', { name: 'Crear app' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('no se creará otra app');

    await user.click(within(dialog).getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('heading', { name: 'Revisión del análisis' })).toBeInTheDocument();
    const commits = imports(api).filter((c) => !c.dryRun);
    expect(commits).toHaveLength(2);
    expect(commits[0]!.importId).toBe(commits[1]!.importId);
    expect(api.apps.filter((a) => a.name === SOURCE.name)).toHaveLength(1);
  });

  it('un nombre tomado (409) pide otro y otro nombre es otra creación', async () => {
    const { api, user, dialog } = await openDialog();
    await user.upload(within(dialog).getByLabelText('Archivo .walkiepack'), pack());
    const name = await within(dialog).findByLabelText('Nombre de la app');
    api.discovery.next.importStatus = 409;
    await user.click(within(dialog).getByRole('button', { name: 'Crear app' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Ya hay una app con ese nombre');
    expect(within(dialog).getByRole('button', { name: 'Crear app' })).toBeDisabled();

    await user.type(name, ' 2');
    await user.click(within(dialog).getByRole('button', { name: 'Crear app' }));
    expect(await screen.findByRole('heading', { name: 'Revisión del análisis' })).toBeInTheDocument();
    const commits = imports(api).filter((c) => !c.dryRun);
    expect(commits[1]!.name).toBe(`${SOURCE.name} 2`);
    expect(commits[0]!.importId).not.toBe(commits[1]!.importId);
  });
});

describe('Reanálisis: comparación con el análisis anterior', () => {
  const previous = { id: OLD_SNAPSHOT_ID, generatedAt: '2026-03-01T10:00:00Z', importedAt: '2026-03-01T10:05:00Z', completeness: 'complete' as const, vcs: { kind: 'git' as const, commit: 'abc1234def' } };
  const items = [
    item({ key: 'api:GET /api/nueva', status: 'new', change: 'added', needsReview: true }),
    item({ key: 'api:GET /api/pedidos/{}', status: 'changed', change: 'modified', needsReview: true }),
    item({ key: 'api:GET /api/igual', status: 'linked', change: 'unchanged', needsReview: false }),
    item({ key: 'screen:/carrito', kind: 'screen', status: 'unverified', needsReview: false, coverage: 'El análisis no corrió react-router.' }),
  ];
  const discovery = seed({
    sources: { [APP_ID]: [sourcesEntry(snapshot({ completeness: 'partial' }), 2)] },
    reviews: { [SNAPSHOT_ID]: { sourceId: SOURCE.id, items, previous, comparison: { added: 1, modified: 1, unchanged: 1, needsReview: 2 } } },
  });
  const app = { id: APP_ID, name: 'Tienda', createdAt: '2026-01-01T00:00:00Z', featureCount: 0 };

  it('dice con qué análisis compara, la diferencia de cobertura y filtra por cambio y por revisión', async () => {
    const api = installFakeApi({ apps: [app], discovery });
    const user = userEvent.setup();
    renderRoute(`/apps/${APP_ID}/sources/${SNAPSHOT_ID}`);

    const section = await screen.findByRole('region', { name: 'Comparación con el análisis anterior' });
    expect(section).toHaveTextContent('abc1234');
    expect(section).toHaveTextContent('Diferencia de cobertura');
    expect(within(section).getByRole('link', { name: 'análisis anterior' })).toHaveAttribute('href', `/apps/${APP_ID}/sources/${OLD_SNAPSHOT_ID}`);

    const list = screen.getByRole('list', { name: 'Hallazgos' });
    expect(within(list).getByRole('button', { name: /api\/nueva/ })).toHaveTextContent('Nuevo en este análisis');
    expect(within(list).getByRole('button', { name: /api\/nueva/ })).toHaveTextContent('Requiere revisión');
    expect(within(list).getByRole('button', { name: /carrito/ })).toHaveTextContent('Sin cobertura');

    await user.click(within(section).getByRole('button', { name: /Cambió desde el anterior/ }));
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Hallazgos' })).getAllByRole('button')).toHaveLength(1));
    const reviews = () => api.fetchMock.mock.calls.map(([u]) => String(u)).filter((u) => u.includes('/review'));
    expect(reviews().at(-1)).toContain('change=modified');

    await user.click(within(section).getByRole('button', { name: /Cambió desde el anterior/ }));
    await user.click(within(section).getByRole('button', { name: /Requiere revisión/ }));
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Hallazgos' })).getAllByRole('button')).toHaveLength(2));
    const last = reviews().at(-1)!;
    expect(last).toContain('needsReview=true');
    expect(last).not.toContain('change=');
  });

  it('explica por qué no concluye que algo desapareció', async () => {
    installFakeApi({ apps: [app], discovery });
    const user = userEvent.setup();
    renderRoute(`/apps/${APP_ID}/sources/${SNAPSHOT_ID}`);
    await user.click(await screen.findByRole('button', { name: /carrito/ }));
    expect(await screen.findByRole('complementary', { name: 'Detalle del hallazgo' })).toHaveTextContent('El análisis no corrió react-router.');
  });

  it('«Cargar análisis nuevo» desde la fuente abre la carga del proyecto', async () => {
    installFakeApi({ apps: [app], discovery });
    const user = userEvent.setup();
    renderRoute(`/apps/${APP_ID}`);
    await user.click(await screen.findByRole('button', { name: `Cargar análisis nuevo de ${SOURCE.name}` }));
    expect(screen.getByRole('dialog', { name: 'Importar proyecto local' })).toBeInTheDocument();
  });
});
