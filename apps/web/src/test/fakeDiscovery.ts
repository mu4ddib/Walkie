import type {
  DiscoveryApplyResult,
  DiscoveryEvidence,
  DiscoveryOperation,
  DiscoveryReviewItem,
  DiscoverySnapshot,
  DiscoverySources,
  DiscoveryStatus,
  DiscoveryTarget,
  DiscoveryUpload,
} from '../api/client';

/** Lo que `installFakeApi({ discovery })` responde de Walkie Live (sin él, todo Discovery responde 404, como apagado). */
export interface DiscoverySeed {
  /** Fuentes por app (`GET /api/apps/{appId}/sources`). */
  sources?: Record<string, DiscoverySources['sources']>;
  /** Hallazgos por análisis (`GET /api/snapshots/{id}/review`): la fake filtra, pagina y cuenta como la API. */
  reviews?: Record<string, { sourceId: string; items: DiscoveryReviewItem[] }>;
  /** Evidencia por `${snapshotId}|${entityKey}`; la que falte responde 404. */
  evidence?: Record<string, DiscoveryEvidence>;
  /**
   * Lo que trae el próximo paquete subido. Con `duplicate`, el análisis ya existe (`existing`); si no, al guardar se
   * crea `snapshot` y su fuente aparece en la lista.
   */
  upload?: { summary: DiscoveryUpload['summary']; snapshot: DiscoverySnapshot; duplicate?: 'pack' | 'content' };
}

type Json = (status: number, body: unknown) => Response;

/**
 * La parte Discovery de la API falsa (spec walkie-live, tarea 5). Responde como `Walkie.Modules.Discovery`: 404 si la
 * feature está apagada (sin `seed`), 409 si `bindingVersion` no es el actual, la misma respuesta para el mismo
 * `applyId`, y la decisión cambia el estado del hallazgo. Las respuestas se guardan en `applies` para inspeccionarlas.
 */
export function fakeDiscovery(seed: DiscoverySeed | undefined, json: Json) {
  const sources = Object.fromEntries(Object.entries(seed?.sources ?? {}).map(([k, v]) => [k, [...v]]));
  const reviews = Object.fromEntries(
    Object.entries(seed?.reviews ?? {}).map(([k, v]) => [k, { ...v, items: v.items.map((i) => structuredClone(i)) }]),
  );
  const applies: { snapshotId: string; dryRun: boolean; body: { applyId: string; operations: DiscoveryOperation[] } }[] = [];
  const done = new Map<string, DiscoveryApplyResult>();
  const next: { uploadErrors?: { status: number; errors?: Record<string, string[]> }; applyStatus?: number } = {};
  const notFound = () => json(404, { title: 'Not Found', status: 404 });

  function handle(parts: string[], url: URL, method: string, init?: RequestInit): Response | null {
    // /api/apps/{appId}/sources[/snapshots]
    if (parts[1] === 'apps' && parts[3] === 'sources') {
      if (!seed) return notFound();
      const appId = parts[2]!;
      if (parts.length === 4 && method === 'GET') return json(200, { appId, sources: sources[appId] ?? [] });
      if (parts[4] === 'snapshots' && method === 'POST') {
        if (next.uploadErrors) {
          const { status, errors } = next.uploadErrors;
          delete next.uploadErrors;
          return json(status, { title: status === 413 ? 'Paquete demasiado grande' : 'Paquete inválido', status, errors });
        }
        if (!seed.upload) return json(400, { title: 'Paquete inválido', status: 400, errors: { 'manifest.json': ['Falta.'] } });
        const { summary, snapshot, duplicate } = seed.upload;
        const dryRun = url.searchParams.get('dryRun') === 'true';
        if (dryRun) return json(200, { dryRun, status: 'preview', summary, ...(duplicate ? { duplicate, snapshot } : {}) });
        if (duplicate) return json(200, { dryRun, status: 'existing', duplicate, snapshot, summary });
        const list = (sources[appId] ??= []);
        if (!list.some((s) => s.source.id === snapshot.source.id)) {
          list.push({ source: snapshot.source, createdAt: snapshot.importedAt, updatedAt: snapshot.importedAt, snapshotCount: 1, latestSnapshot: snapshot });
        }
        return json(201, { dryRun, status: 'created', snapshot, summary });
      }
      return notFound();
    }
    if (parts[1] !== 'snapshots') return null;
    if (!seed) return notFound();
    const snapshotId = parts[2]!;
    const review = reviews[snapshotId];
    if (!review) return notFound();

    if (parts[3] === 'review' && method === 'GET') {
      const kind = url.searchParams.get('kind');
      const status = url.searchParams.get('status');
      const index = Number(url.searchParams.get('page') ?? 0);
      const size = Number(url.searchParams.get('pageSize') ?? 50);
      const counts = Object.fromEntries(
        (['new', 'matched', 'linked', 'created', 'rejected', 'changed', 'missing'] as DiscoveryStatus[]).map((s) => [
          s,
          review.items.filter((i) => i.status === s && (!kind || i.kind === kind)).length,
        ]),
      );
      const filtered = review.items.filter((i) => (!kind || i.kind === kind) && (!status || i.status === status));
      return json(200, {
        snapshotId,
        sourceId: review.sourceId,
        counts,
        page: { index, size, total: filtered.length },
        items: filtered.slice(index * size, (index + 1) * size),
      });
    }

    if (parts[3] === 'evidence' && method === 'GET') {
      const key = url.searchParams.get('entityKey');
      if (!key) return json(400, { title: 'Falta entityKey', status: 400 });
      const found = seed.evidence?.[`${snapshotId}|${key}`];
      return found ? json(200, found) : notFound();
    }

    if (parts[3] === 'apply' && method === 'POST') {
      const dryRun = url.searchParams.get('dryRun') === 'true';
      const body = JSON.parse(String(init?.body)) as { applyId: string; operations: DiscoveryOperation[] };
      applies.push({ snapshotId, dryRun, body });
      if (next.applyStatus) {
        const status = next.applyStatus;
        delete next.applyStatus;
        return json(status, { title: status === 409 ? 'La decisión cambió' : 'Error', status });
      }
      if (!dryRun && done.has(body.applyId)) return json(200, done.get(body.applyId));
      const result: DiscoveryApplyResult = {
        applyId: body.applyId,
        dryRun,
        status: dryRun ? 'planned' : 'completed',
        created: [],
        linked: [],
        rejected: [],
        reset: [],
        unchanged: [],
        warnings: [],
      };
      for (const op of body.operations) {
        const item = review.items.find((i) => i.key === op.entityKey);
        if (!item) return json(400, { title: 'Hallazgo desconocido', status: 400 });
        if ((item.binding?.version ?? 0) !== op.bindingVersion) return json(409, { title: 'La decisión cambió', status: 409 });
        if (op.op === 'link') {
          const target: DiscoveryTarget = { kind: op.target!.kind!, id: op.target!.id!, title: titleOf(op.target!.kind!, op.target!.id!, item) };
          result.linked.push({ entityKey: item.key, target });
          if (!dryRun) decide(item, 'linked', snapshotId, body.applyId, target);
        } else if (op.op === 'reject') {
          result.rejected.push(item.key);
          if (!dryRun) decide(item, 'rejected', snapshotId, body.applyId, undefined, op.note);
        } else if (op.op === 'reset') {
          result.reset.push(item.key);
          if (!dryRun) {
            delete item.binding;
            item.status = 'new';
          }
        }
      }
      if (!dryRun) done.set(body.applyId, result);
      return json(200, result);
    }
    return notFound();
  }

  function titleOf(kind: string, id: string, item: DiscoveryReviewItem) {
    const known = [...(item.candidates ?? []).map((c) => c.target), ...(item.match ? [item.match.target] : [])];
    return known.find((t) => t.kind === kind && t.id === id)?.title ?? id;
  }

  function decide(
    item: DiscoveryReviewItem,
    decision: 'linked' | 'rejected',
    snapshotId: string,
    applyId: string,
    target?: DiscoveryTarget,
    note?: string,
  ) {
    item.status = decision;
    delete item.match;
    delete item.candidates;
    item.binding = {
      sourceId: reviews[snapshotId]!.sourceId,
      entityKey: item.key,
      decision,
      ...(target ? { target } : {}),
      ...(note ? { note } : {}),
      entityFingerprint: item.fingerprint,
      snapshotId,
      applyId,
      decidedBy: 'usuario-demo',
      decidedAt: '2026-11-14T12:30:00Z',
      version: (item.binding?.version ?? 0) + 1,
    } as DiscoveryReviewItem['binding'];
  }

  return { handle, sources, reviews, applies, next };
}
