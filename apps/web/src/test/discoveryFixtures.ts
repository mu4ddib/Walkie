import type { DiscoveryEvidence, DiscoveryReviewItem, DiscoverySnapshot, DiscoveryUpload } from '../api/client';

/** Datos de prueba de Walkie Live (ficticios: una «tienda» de ejemplo, sin datos de clientes). */
export const APP_ID = 'app-1';
export const SOURCE = { id: '0198f0c0-aaaa-7000-8000-000000000001', name: 'tienda-demo' };
export const SNAPSHOT_ID = '0198f0c0-2222-7000-8000-000000000201';
export const OLD_SNAPSHOT_ID = '0198f0c0-2222-7000-8000-000000000200';

export function snapshot(overrides: Partial<DiscoverySnapshot> = {}): DiscoverySnapshot {
  return {
    id: SNAPSHOT_ID,
    appId: APP_ID,
    source: SOURCE,
    formatVersion: 0,
    analyzer: { name: 'walkie-cli', version: '0.1.0' },
    vcs: { kind: 'git', commit: '3f1c2a9b7d4e5f60718293a4b5c6d7e8f9012345', branch: 'main', dirty: false },
    generatedAt: '2026-11-14T12:00:00Z',
    importedAt: '2026-11-14T12:05:00Z',
    importedBy: 'usuario-demo',
    completeness: 'complete',
    detectors: [
      { id: 'aspnetcore-endpoints', version: '0.1.0', status: 'ran', produces: { entities: ['api'], relations: ['exposes'] } },
      { id: 'compose', version: '0.1.0', status: 'ran', produces: { entities: ['service', 'database'], relations: [] } },
    ],
    technologies: [{ id: 'aspnetcore', name: 'ASP.NET Core', version: '10.0', evidence: ['ev-1'] }],
    limitations: [],
    stats: { files: 12, entities: 3, relations: 1, evidence: 4 },
    packSha256: '9b2f0c6e1d4a3b5c7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9012345678ab',
    contentFingerprint: 'sha256:199a63de5c776a090afbe433e238b7b16e221d66835211a817fa2975bdfad99a',
    ...overrides,
  } as DiscoverySnapshot;
}

export function uploadSummary(overrides: Partial<DiscoveryUpload['summary']> = {}): DiscoveryUpload['summary'] {
  const { id: _id, importedAt: _at, importedBy: _by, ...rest } = snapshot();
  void _id;
  void _at;
  void _by;
  return { ...rest, sourceExists: false, entities: { api: 2, database: 1 }, ...overrides } as DiscoveryUpload['summary'];
}

export function item(overrides: Partial<DiscoveryReviewItem> & { key: string }): DiscoveryReviewItem {
  return {
    kind: 'api',
    title: overrides.key,
    basis: 'observed',
    confidence: 'high',
    status: 'new',
    fingerprint: `sha256:${'0'.repeat(64)}`,
    evidenceCount: 1,
    proposal: { op: 'create' },
    ...overrides,
  } as DiscoveryReviewItem;
}

export const CATALOG_TARGET = { kind: 'catalogItem' as const, id: 'cat-1', title: 'Consultar pedido' };

export const ITEMS: DiscoveryReviewItem[] = [
  item({
    key: 'api:GET /api/pedidos/{}',
    title: 'GET /api/pedidos/{id}',
    status: 'matched',
    match: { target: CATALOG_TARGET, reason: 'signature' },
    proposal: { op: 'link', target: CATALOG_TARGET },
  }),
  item({
    key: 'database:postgresql/tienda',
    kind: 'database',
    title: 'tienda',
    candidates: [
      { target: { kind: 'catalogItem', id: 'cat-2', title: 'Base tienda' }, reason: 'title' },
      { target: { kind: 'catalogItem', id: 'cat-3', title: 'Tienda (réplica)' }, reason: 'title' },
    ],
  }),
  item({ key: 'api:POST /api/pedidos', title: '<img src=x onerror="alert(1)">', basis: 'inferred', confidence: 'medium' }),
  item({ key: 'screen:web:/pedidos', kind: 'screen', title: 'Pedidos' }),
];

export function evidenceOf(key: string): DiscoveryEvidence {
  return {
    snapshotId: SNAPSHOT_ID,
    foundIn: SNAPSHOT_ID,
    entityKey: key,
    evidence: [
      {
        id: 'ev-1',
        path: 'src/Tienda.Api/Pedidos/PedidosEndpoints.cs',
        lines: { start: 12, end: 14 },
        symbol: 'MapPedidos',
        detector: 'aspnetcore-endpoints',
        confidence: 'high',
      },
    ],
    relations: [{ key: 'exposes|service:Tienda.Api|' + key, kind: 'exposes', from: 'service:Tienda.Api', to: key }],
  } as DiscoveryEvidence;
}

export function sourcesEntry(latest = snapshot(), snapshotCount = 1) {
  return { source: SOURCE, createdAt: latest.importedAt, updatedAt: latest.importedAt, snapshotCount, latestSnapshot: latest };
}
