import type {
  CatalogItem,
  DiscoveryArchitecture,
  DiscoveryArchitectureGroup,
  DiscoveryRelationEvidence,
  DiscoveryApplyResult,
  DiscoveryEvidence,
  DiscoveryOperation,
  DiscoveryReview,
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
  reviews?: Record<
    string,
    { sourceId: string; items: DiscoveryReviewItem[]; previous?: DiscoveryReview['previous']; comparison?: DiscoveryReview['comparison'] }
  >;
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
  /** Arquitectura por análisis (spec walkie-live-arquitectura); sin ella, 404. */
  architecture?: Record<string, DiscoveryArchitecture>;
  /** Detalle de un grupo por `${snapshotId}|${groupKey}` (la fake no pagina: devuelve lo sembrado). */
  groups?: Record<string, DiscoveryArchitectureGroup>;
  /** Evidencia de una relación por `${snapshotId}|${relationKey}`; la que falte responde 404. */
  relationEvidence?: Record<string, DiscoveryRelationEvidence>;
  /** Incorporar una pantalla a una feature (ADR-0018), por clave: lo que la API diría de su lienzo actual y lo que se agrega. */
  attaches?: Record<string, Omit<NonNullable<DiscoveryApplyResult['attached']>[number], 'entityKey' | 'target'>>;
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
export function fakeDiscovery(
  seed: DiscoverySeed | undefined,
  json: Json,
  catalog: CatalogItem[] = [],
  createApp: (name: string) => string = () => 'app-nueva',
) {
  const sources = Object.fromEntries(Object.entries(seed?.sources ?? {}).map(([k, v]) => [k, [...v]]));
  const reviews = Object.fromEntries(
    Object.entries(seed?.reviews ?? {}).map(([k, v]) => [k, { ...v, items: v.items.map((i) => structuredClone(i)) }]),
  );
  const applies: { snapshotId: string; dryRun: boolean; body: { applyId: string; operations: DiscoveryOperation[] } }[] = [];
  const done = new Map<string, DiscoveryApplyResult>();
  const next: {
    uploadErrors?: { status: number; errors?: Record<string, string[]> };
    applyStatus?: number;
    compensate?: boolean;
    /** El próximo attach confirmado responde 409: el lienzo cambió desde la vista previa. */
    attachConflict?: boolean;
    /** El próximo `POST /api/sources/import` sin dryRun responde este estado (ej. 409 por nombre, 500 sin terminar). */
    importStatus?: number;
    /** El próximo `POST /api/sources/import` sin dryRun falla por red después de crear (la respuesta no llega). */
    importNetworkError?: boolean;
  } = {};
  /** Creaciones de apps desde un proyecto local por importId (tarea 10): un reintento devuelve la misma. */
  const imports = new Map<string, { appId: string; name: string }>();
  const importRequests: { dryRun: boolean; name: string | null; importId: string | null }[] = [];
  const appOf = (sourceId: string) =>
    Object.entries(sources).find(([, list]) => list.some((s) => s.source.id === sourceId))?.[0] ?? 'app-1';
  const notFound = () => json(404, { title: 'Not Found', status: 404 });

  function handle(parts: string[], url: URL, method: string, init?: RequestInit): Response | null {
    // /api/discovery — si Walkie Live está encendido (tarea 10).
    if (parts[1] === 'discovery' && parts.length === 2 && method === 'GET') {
      return seed ? json(200, { enabled: true, formatVersion: 1, maxPackBytes: 50 * 1024 * 1024 }) : notFound();
    }
    // /api/sources/import — crear una app desde un proyecto local (tarea 10).
    if (parts[1] === 'sources' && parts[2] === 'import' && method === 'POST') {
      if (!seed) return notFound();
      const dryRun = url.searchParams.get('dryRun') === 'true';
      const form = init?.body as FormData;
      const name = (form.get('name') as string | null) ?? null;
      const importId = (form.get('importId') as string | null) ?? null;
      importRequests.push({ dryRun, name, importId });
      if (next.uploadErrors && dryRun) {
        const { status, errors } = next.uploadErrors;
        delete next.uploadErrors;
        return json(status, { title: 'Paquete inválido', status, errors });
      }
      if (!seed.upload) return json(400, { title: 'Paquete inválido', status: 400, errors: { 'manifest.json': ['Falta.'] } });
      const { summary, snapshot } = seed.upload;
      const proposed = summary.source.name;
      if (dryRun) {
        return json(200, { dryRun, status: 'preview', app: { name: name ?? proposed, nameTaken: false }, summary: { ...summary, appId: undefined }, warnings: [] });
      }
      if (next.importStatus) {
        const status = next.importStatus;
        delete next.importStatus;
        return json(status, { title: status === 409 ? 'Ya hay una app con ese nombre: elige otro.' : 'No se pudo crear la app: quedó pendiente.', status });
      }
      const known = importId ? imports.get(importId) : undefined;
      const created = known ?? { appId: createApp(name!), name: name! };
      if (importId) imports.set(importId, created);
      const body = {
        importId,
        dryRun,
        status: known ? 'existing' : 'created',
        app: { id: created.appId, name: created.name, nameTaken: false },
        snapshot: { ...snapshot, appId: created.appId },
        summary: { ...summary, appId: created.appId },
        warnings: [],
      };
      if (next.importNetworkError) {
        delete next.importNetworkError;
        return Promise.reject(new TypeError('Failed to fetch')) as unknown as Response;
      }
      return json(known ? 200 : 201, body);
    }
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

    if (parts[3] === 'architecture' && method === 'GET') {
      if (parts[4] === 'group') {
        const found = seed.groups?.[`${snapshotId}|${url.searchParams.get('key') ?? ''}`];
        if (!found) return notFound();
        // Pagina los hallazgos como la API (los vecinos y relaciones sembrados van en todas las páginas).
        const index = Number(url.searchParams.get('page') ?? 0);
        const size = Number(url.searchParams.get('pageSize') ?? 200);
        return json(200, { ...found, page: index, pageSize: size, total: found.entities.length, entities: found.entities.slice(index * size, (index + 1) * size) });
      }
      const found = seed.architecture?.[snapshotId];
      return found ? json(200, found) : notFound();
    }

    if (parts[3] === 'relation-evidence' && method === 'GET') {
      const key = url.searchParams.get('key');
      if (!key) return json(400, { title: 'Falta key', status: 400 });
      const found = seed.relationEvidence?.[`${snapshotId}|${key}`];
      return found ? json(200, found) : notFound();
    }

    if (parts[3] === 'review' && method === 'GET') {
      const keys = url.searchParams.getAll('key');
      const kind = url.searchParams.get('kind');
      const status = url.searchParams.get('status');
      const index = Number(url.searchParams.get('page') ?? 0);
      const size = Number(url.searchParams.get('pageSize') ?? 50);
      const change = url.searchParams.get('change');
      const needsReview = url.searchParams.get('needsReview') === 'true';
      const counts = Object.fromEntries(
        (['new', 'matched', 'linked', 'created', 'rejected', 'changed', 'missing', 'unverified'] as DiscoveryStatus[]).map((s) => [
          s,
          review.items.filter((i) => i.status === s && (!kind || i.kind === kind)).length,
        ]),
      );
      const filtered = review.items.filter(
        (i) =>
          (!kind || i.kind === kind) &&
          (!status || i.status === status) &&
          (!change || i.change === change) &&
          (!needsReview || i.needsReview) &&
          (keys.length === 0 || keys.includes(i.key)),
      );
      return json(200, {
        snapshotId,
        sourceId: review.sourceId,
        counts,
        page: { index, size, total: filtered.length },
        items: filtered.slice(index * size, (index + 1) * size),
        ...(review.previous ? { previous: review.previous, previousSnapshotId: review.previous.id } : {}),
        ...(review.comparison ? { comparison: review.comparison } : {}),
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
        if (op.op === 'attach') {
          // ADR-0018: incorporar una pantalla a una feature existente, con la versión del lienzo que se vio.
          const attach = seed.attaches?.[item.key];
          if (!attach || item.kind !== 'screen') return json(400, { title: 'Error de validación', status: 400, errors: { '/operations/0/op': ['Solo una pantalla.'] } });
          if (!dryRun && next.attachConflict) {
            delete next.attachConflict;
            return json(409, { title: 'El lienzo de la feature cambió desde la vista previa: no se agregó nada.', status: 409 });
          }
          const added = attach.canvas.nodes.filter((n) => !n.existing).map((n) => n.key).sort();
          if (!dryRun && (op.canvasVersion !== attach.canvasVersion || !op.canvas || Object.keys(op.canvas.nodes).sort().join() !== added.join())) {
            return json(400, { title: 'Error de validación', status: 400, errors: { '/operations/0/canvas': ['Falta la versión o lo que se agrega.'] } });
          }
          const target: DiscoveryTarget = { kind: 'feature', id: op.target!.id!, title: op.target!.title ?? attach.canvas.nodes.find((n) => n.type === 'screen')?.title };
          result.attached = [...(result.attached ?? []), { entityKey: item.key, target, ...attach }];
          if (!dryRun) decide(item, 'linked', snapshotId, body.applyId, target);
          continue;
        }
        if (op.op === 'create' && (item.kind === 'feature' || item.kind === 'module' || item.kind === 'screen')) {
          // Tarea 9: un módulo o una feature con su lienzo inicial. Al aplicar exige los ids y posiciones de cada clave.
          const draft = seed.drafts?.[item.key];
          if (!draft) return json(400, { title: 'Error de validación', status: 400, errors: { '/operations/0/entityKey': ['Sin borrador.'] } });
          if (item.binding) return json(409, { title: 'Ya tiene una decisión', status: 409 });
          const keys = draft.nodes.map((n) => n.key).sort();
          if (!dryRun && (!op.canvas || Object.keys(op.canvas.nodes).sort().join() !== keys.join() || Object.keys(op.canvas.layout).sort().join() !== keys.join())) {
            return json(400, { title: 'Error de validación', status: 400, errors: { '/operations/0/canvas': ['Falta el lienzo inicial o no coincide.'] } });
          }
          // Lo que se crea o se vincula en la misma solicitud ya cuenta como decidido para el lienzo (como la API).
          const alsoCreated = new Set(body.operations.filter((o) => o.op === 'create' || o.op === 'link').map((o) => o.entityKey));
          const canvas = { ...draft, omitted: draft.omitted.filter((o) => !alsoCreated.has(o.key)) };
          const target: DiscoveryTarget = { kind: item.kind === 'screen' ? 'feature' : item.kind, id: op.id!, title: op.name ?? item.title };
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
