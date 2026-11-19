import type {
  CatalogItem,
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
  /** Contrato de los hallazgos a crear por clave (lo que la API sacaría del paquete); sin él, solo tipo y título. */
  contracts?: Record<string, Partial<CatalogItem>>;
  /** Borrador del lienzo inicial de cada módulo o feature por clave (tarea 9): lo que la API armaría del análisis. */
  drafts?: Record<string, NonNullable<DiscoveryApplyResult['created'][number]['canvas']>>;
}

const CREATABLE = ['api', 'service', 'database', 'resource'];

type Json = (status: number, body: unknown) => Response;

/**
 * La parte Discovery de la API falsa (spec walkie-live, tarea 5). Responde como `Walkie.Modules.Discovery`: 404 si la
 * feature está apagada (sin `seed`), 409 si `bindingVersion` no es el actual, la misma respuesta para el mismo
 * `applyId`, y la decisión cambia el estado del hallazgo. Las respuestas se guardan en `applies` para inspeccionarlas.
 * `create` (tarea 6) agrega el elemento al catálogo de la fake (`catalog`) con el id del cliente; `next.compensate`
 * hace que la próxima aplicación real termine `compensated` sin crear nada. `GET /api/apps/{appId}/bindings` responde
 * la procedencia a partir de los vínculos.
 */
export function fakeDiscovery(seed: DiscoverySeed | undefined, json: Json, catalog: CatalogItem[] = []) {
  const sources = Object.fromEntries(Object.entries(seed?.sources ?? {}).map(([k, v]) => [k, [...v]]));
  const reviews = Object.fromEntries(
    Object.entries(seed?.reviews ?? {}).map(([k, v]) => [k, { ...v, items: v.items.map((i) => structuredClone(i)) }]),
  );
  const applies: { snapshotId: string; dryRun: boolean; body: { applyId: string; operations: DiscoveryOperation[] } }[] = [];
  const done = new Map<string, DiscoveryApplyResult>();
  const next: { uploadErrors?: { status: number; errors?: Record<string, string[]> }; applyStatus?: number; compensate?: boolean } = {};
  const appOf = (sourceId: string) =>
    Object.entries(sources).find(([, list]) => list.some((s) => s.source.id === sourceId))?.[0] ?? 'app-1';
  const notFound = () => json(404, { title: 'Not Found', status: 404 });

  function handle(parts: string[], url: URL, method: string, init?: RequestInit): Response | null {
    // /api/apps/{appId}/bindings?target=catalogItem:{id} — procedencia (tarea 6).
    if (parts[1] === 'apps' && parts[3] === 'bindings' && method === 'GET') {
      if (!seed) return notFound();
      return provenance(parts[2]!, url.searchParams.get('target') ?? '');
    }
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
      if (!dryRun && next.compensate) {
        delete next.compensate;
        const compensated: DiscoveryApplyResult = {
          applyId: body.applyId,
          dryRun,
          status: 'compensated',
          created: [],
          linked: [],
          rejected: [],
          reset: [],
          unchanged: [],
          warnings: [{ code: 'compensated', message: 'No se pudo terminar la aplicación: se deshizo lo que había creado.' }],
        };
        done.set(body.applyId, compensated);
        return json(200, compensated);
      }
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
        if (op.op === 'create' && (item.kind === 'feature' || item.kind === 'module')) {
          // Tarea 9: un módulo o una feature con su lienzo inicial. Al aplicar exige los ids y posiciones de cada clave.
          const draft = seed.drafts?.[item.key];
          if (!draft) return json(400, { title: 'Error de validación', status: 400, errors: { '/operations/0/entityKey': ['Sin borrador.'] } });
          if (item.binding) return json(409, { title: 'Ya tiene una decisión', status: 409 });
          const keys = draft.nodes.map((n) => n.key).sort();
          if (!dryRun && (!op.canvas || Object.keys(op.canvas.nodes).sort().join() !== keys.join() || Object.keys(op.canvas.layout).sort().join() !== keys.join())) {
            return json(400, { title: 'Error de validación', status: 400, errors: { '/operations/0/canvas': ['Falta el lienzo inicial o no coincide.'] } });
          }
          const alsoCreated = new Set(body.operations.filter((o) => o.op === 'create').map((o) => o.entityKey));
          const canvas = { ...draft, omitted: draft.omitted.filter((o) => !alsoCreated.has(o.key)) };
          const target: DiscoveryTarget = { kind: item.kind, id: op.id!, title: op.name ?? item.title };
          result.created.push({ entityKey: item.key, target, includes: keys, canvas });
          result.warnings.push({ code: 'inferred', message: 'Walkie dedujo esta feature de las rutas: revisa el nombre y lo que agrupa.', entityKey: item.key });
          for (const o of canvas.omitted.filter((x) => x.code === 'ambiguous-api')) {
            result.warnings.push({ code: 'ambiguous-api', message: o.message, entityKey: item.key });
          }
          if (!dryRun) decide(item, 'created', snapshotId, body.applyId, target);
        } else if (op.op === 'create') {
          if (!CREATABLE.includes(item.kind)) return json(400, { title: 'Error de validación', status: 400, errors: { '/operations/0/op': ['Todavía no.'] } });
          if (item.binding) return json(409, { title: 'Ya tiene una decisión', status: 409 });
          const appId = appOf(review.sourceId);
          const created: CatalogItem = {
            id: op.id!,
            appId,
            type: item.kind as CatalogItem['type'],
            title: item.title,
            version: 1,
            ...seed.contracts?.[item.key],
          };
          const target: DiscoveryTarget = { kind: 'catalogItem', id: op.id!, title: item.title };
          result.created.push({ entityKey: item.key, target, item: created });
          result.warnings.push({ code: 'to-complete', message: 'Sin evidencia para descripción: quedan vacíos.', entityKey: item.key });
          if (item.basis === 'inferred') {
            result.warnings.push({ code: 'inferred', message: 'Walkie lo dedujo, no lo vio directamente en el código.', entityKey: item.key });
          }
          if (!dryRun) {
            decide(item, 'created', snapshotId, body.applyId, target);
            if (!catalog.some((c) => c.id === created.id)) catalog.push(created);
          }
        } else if (op.op === 'link') {
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
    decision: 'linked' | 'rejected' | 'created',
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

  /** Los vínculos activos que apuntan a `target`, con la evidencia sembrada de su análisis. */
  function provenance(appId: string, target: string) {
    const [kind, id] = target.split(':');
    if (!kind || !id) return json(400, { title: 'Error de validación', status: 400, errors: { target: ['Usa target=catalogItem:{id}.'] } });
    const origins = Object.entries(reviews).flatMap(([snapshotId, review]) =>
      review.items
        .filter((i) => i.binding?.target?.kind === kind && i.binding.target.id === id)
        .map((i) => {
          const found = seed?.evidence?.[`${snapshotId}|${i.key}`];
          const source = Object.values(sources).flat().find((s) => s.source.id === review.sourceId);
          return {
            source: source?.source ?? { id: review.sourceId, name: 'fuente' },
            binding: i.binding!,
            entity: { key: i.key, kind: i.kind, title: i.title, basis: i.basis, confidence: i.confidence },
            evidence: found?.evidence ?? [],
            evidenceTotal: found?.evidence.length ?? 0,
            latest: { snapshotId: source?.latestSnapshot.id ?? snapshotId, status: 'same' },
          };
        }),
    );
    const exists = kind !== 'catalogItem' || catalog.some((c) => c.id === id);
    return json(200, { appId, target: { kind, id }, targetExists: exists, bindings: origins });
  }

  return { handle, sources, reviews, applies, next };
}
