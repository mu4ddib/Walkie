import { vi } from 'vitest';
import { ASSET_TYPES, SHARE_DAYS, type App, type Asset, type CatalogItem, type Feature, type Share, type SharedFeature } from '../api/client';
import type { WalkieCanvasGraphV0 } from '../schema/walkie-graph';

/**
 * API falsa en memoria para pruebas de componentes: reemplaza `fetch` y responde
 * como `apps/api` (201/200/400/404 con ProblemDetails). Devuelve el estado para inspeccionarlo.
 */
export function installFakeApi(
  seed: {
    apps?: App[];
    features?: Feature[];
    canvases?: Record<string, WalkieCanvasGraphV0>;
    catalog?: CatalogItem[];
    shares?: Share[];
    /** Lo que responde `GET /api/public/shares/{token}` por token (los demás tokens: 404). */
    shared?: Record<string, SharedFeature>;
  } = {},
) {
  const apps = [...(seed.apps ?? [])];
  const catalog = [...(seed.catalog ?? [])];
  const assets = new Map<string, { asset: Asset; file: File }>();
  const features = (seed.features ?? []).map((f) => ({ ...f }));
  const canvases: Record<string, WalkieCanvasGraphV0> = { ...seed.canvases };
  /** Enlaces de solo lectura activos (los revocados salen de la lista, como en la API). */
  const shares = [...(seed.shares ?? [])];
  /** Si se define, el próximo PUT del lienzo responde este estado (ej. 400). */
  const next_: { putStatus?: number; uploadStatus?: number; exportStatus?: number } = {};
  let next = 1;
  const id = () => `00000000-0000-7000-8000-${String(next++).padStart(12, '0')}`;

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const notFound = () => json(404, { title: 'Not Found', status: 404 });
  const invalidName = (name: unknown) =>
    typeof name !== 'string' || name.trim().length === 0
      ? json(400, { title: 'Error de validación', errors: { Name: ['El nombre es obligatorio.'] } })
      : null;

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as { name?: string }) : {};
    const parts = url.pathname.split('/').filter(Boolean); // ['api','apps',id?,'features'?]

    // /api/health — la API responde; así el aviso compacto de "sin conexión" no aparece.
    if (parts[1] === 'health') return json(200, { status: 'ok', schemaVersion: 0 });

    // /api/public/shares/{token}[/assets/{assetId}] — sin sesión; 404 si el token no está o la imagen no es de una pantalla.
    if (parts[1] === 'public' && parts[2] === 'shares') {
      const view = seed.shared?.[parts[3]!];
      if (!view) return notFound();
      if (parts[4] !== 'assets') return json(200, view);
      const used = Object.values(view.graph.nodes).some((n) => n.type === 'screen' && n.assetId === parts[5]);
      return used ? new Response('imagen', { status: 200, headers: { 'Content-Type': 'image/png' } }) : notFound();
    }

    // /api/features/{featureId}/export — un zip de mentira con el nombre en Content-Disposition, como la API.
    if (parts[1] === 'features' && parts[3] === 'export') {
      const feature = features.find((f) => f.id === parts[2]);
      if (!feature) return notFound();
      if (next_.exportStatus) {
        const status = next_.exportStatus;
        delete next_.exportStatus;
        return json(status, { title: 'Error', status });
      }
      // Contexto para IA (spec exportar-e-importar): Markdown o JSON con su nombre, como la API.
      const format = url.searchParams.get('format');
      if (format === 'ai') {
        return new Response(`# Contexto para IA: ${feature.name}\n\nUn texto de prueba.\n`, {
          status: 200,
          headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': 'attachment; filename=contexto-ia.md' },
        });
      }
      if (format === 'ai-json') {
        return new Response(JSON.stringify({ format: 'walkie-ai-context', feature: { name: feature.name } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename=feature.context.json' },
        });
      }
      return new Response('zip', {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename=export.zip; filename*=UTF-8''${encodeURIComponent(feature.name)}.zip`,
        },
      });
    }

    // /api/features/{featureId}/shares y /api/shares/{shareId} — como la API: 400 por duración, 404, 204 al revocar.
    if (parts[1] === 'features' && parts[3] === 'shares') {
      const featureId = parts[2]!;
      if (!features.some((f) => f.id === featureId)) return notFound();
      if (method === 'GET') {
        return json(
          200,
          shares.filter((s) => s.featureId === featureId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        );
      }
      const { expiresInDays } = JSON.parse(String(init?.body)) as { expiresInDays: number };
      if (!(SHARE_DAYS as readonly number[]).includes(expiresInDays)) {
        return json(400, { title: 'Error de validación', errors: { ExpiresInDays: ['La duración debe ser de 7, 30 o 90 días.'] } });
      }
      const created = Date.UTC(2026, 10, 8, 12, shares.length);
      const share: Share = {
        id: id(),
        featureId,
        createdByName: 'Ana Prueba',
        createdAt: new Date(created).toISOString(),
        expiresAt: new Date(created + expiresInDays * 86_400_000).toISOString(),
      };
      shares.push(share);
      return json(201, { ...share, token: `token${share.id.replaceAll('-', '')}`.padEnd(43, 'x').slice(0, 43) });
    }
    if (parts[0] === 'api' && parts[1] === 'shares') {
      const index = shares.findIndex((s) => s.id === parts[2]);
      if (index < 0) return notFound();
      shares.splice(index, 1);
      return new Response(null, { status: 204 });
    }

    // /api/features/{featureId} — renombrar: 400 sin nombre, 404, la feature con su nueva fecha.
    if (parts[1] === 'features' && parts.length === 3 && method === 'PUT') {
      const feature = features.find((f) => f.id === parts[2]);
      if (!feature) return notFound();
      const changes = body as { name?: string; description?: string | null };
      const error = invalidName(changes.name);
      if (error) return error;
      Object.assign(feature, {
        name: changes.name!.trim(),
        description: changes.description?.trim() ?? '',
        updatedAt: new Date(Date.UTC(2026, 10, 8)).toISOString(),
      });
      return json(200, feature);
    }

    // /api/features/{featureId}/canvas — como la API: 404, grafo vacío v0, 409 por versión, version + 1.
    if (parts[1] === 'features' && parts[3] === 'canvas') {
      const featureId = parts[2]!;
      if (!features.some((f) => f.id === featureId)) return notFound();
      const current = canvases[featureId] ?? { schemaVersion: 0, version: 0, nodes: {}, edges: {}, layout: {} };
      if (method === 'GET') return json(200, current);
      if (next_.putStatus === 400) {
        delete next_.putStatus;
        return json(400, {
          title: 'El grafo no es válido.',
          errors: { '/edges/e1/to': ['La conexión apunta a un nodo que no existe.'] },
        });
      }
      const graph = JSON.parse(String(init?.body)) as WalkieCanvasGraphV0;
      if (graph.version !== current.version) {
        return json(409, { title: 'El lienzo cambió desde que lo cargaste.', currentVersion: current.version });
      }
      canvases[featureId] = { ...graph, version: current.version + 1 };
      return json(200, canvases[featureId]);
    }

    // /api/catalog/{itemId}[/usages] — como la API: 404, 409 por versión o por uso, 204 al borrar.
    if (parts[0] === 'api' && parts[1] === 'catalog') {
      const index = catalog.findIndex((i) => i.id === parts[2]);
      const item = catalog[index];
      if (!item) return notFound();
      const usedBy = features.filter((f) =>
        Object.values(canvases[f.id]?.nodes ?? {}).some((n) => n.type === 'ref' && n.catalogId === item.id),
      );
      if (parts[3] === 'usages') return json(200, usedBy);
      if (method === 'GET') return json(200, item);
      if (method === 'DELETE') {
        if (usedBy.length > 0) return json(409, { title: 'El elemento se usa en otros lienzos.', features: usedBy });
        catalog.splice(index, 1);
        return new Response(null, { status: 204 });
      }
      const changes = JSON.parse(String(init?.body)) as Omit<CatalogItem, 'id' | 'appId' | 'type'>;
      if (changes.version !== item.version) {
        return json(409, { title: 'El elemento cambió desde que lo cargaste.', currentVersion: item.version });
      }
      catalog[index] = { id: item.id, appId: item.appId, type: item.type, ...changes, version: item.version + 1 };
      return json(200, catalog[index]);
    }

    // /api/assets/{assetId} — los bytes subidos.
    if (parts[0] === 'api' && parts[1] === 'assets') {
      const stored = assets.get(parts[2]!);
      // Bytes fijos: el Response de Node no lee los File de jsdom.
      return stored
        ? new Response('imagen', { status: 200, headers: { 'Content-Type': stored.asset.contentType } })
        : notFound();
    }

    if (parts[0] !== 'api' || parts[1] !== 'apps') return notFound();
    const appId = parts[2];

    const withCount = (a: App) => ({ ...a, featureCount: features.filter((f) => f.appId === a.id).length });

    if (!appId) {
      if (method === 'GET') return json(200, apps.map(withCount));
      const error = invalidName(body.name);
      if (error) return error;
      const app: App = { id: id(), name: body.name!.trim(), createdAt: new Date(0).toISOString(), featureCount: 0 };
      apps.push(app);
      return json(201, app);
    }

    const app = apps.find((a) => a.id === appId);
    if (!app) return notFound();
    // /api/apps/{appId}/assets — como la API: tipo por el archivo (aquí, su `type`), 400 o 201.
    if (parts[3] === 'assets') {
      const file = (init?.body as FormData).get('file') as File | null;
      if (next_.uploadStatus === 400 || !file || !(ASSET_TYPES as readonly string[]).includes(file.type)) {
        delete next_.uploadStatus;
        return json(400, {
          title: 'La imagen no es válida.',
          errors: { file: ['Solo se aceptan imágenes PNG, JPEG o WebP.'] },
        });
      }
      const asset: Asset = {
        id: id(),
        appId,
        contentType: file.type as Asset['contentType'],
        size: file.size,
        width: 1,
        height: 1,
      };
      assets.set(asset.id, { asset, file });
      return json(201, asset);
    }
    if (parts[3] === 'catalog') {
      if (method === 'GET')
        return json(
          200,
          catalog.filter((i) => i.appId === appId),
        );
      const input = JSON.parse(String(init?.body)) as Omit<CatalogItem, 'id' | 'appId' | 'version'>;
      if (!input.title?.trim()) {
        return json(400, { title: 'Error de validación', errors: { Title: ['El título es obligatorio.'] } });
      }
      const item: CatalogItem = { ...input, id: id(), appId, version: 1 };
      catalog.push(item);
      return json(201, item);
    }
    // /api/apps/{appId}/canvas-previews — los lienzos guardados de la app, con los ref resueltos al tipo del catálogo.
    if (parts[3] === 'canvas-previews') {
      return json(
        200,
        features
          .filter((f) => f.appId === appId && canvases[f.id])
          .map((f) => {
            const graph = canvases[f.id]!;
            return {
              featureId: f.id,
              updatedAt: new Date(Date.UTC(2026, 10, 8)).toISOString(),
              nodes: Object.values(graph.nodes)
                .filter((n) => graph.layout[n.id])
                .map((n) => ({
                  id: n.id,
                  type: n.type === 'ref' ? (catalog.find((i) => i.id === n.catalogId)?.type ?? 'ref') : n.type,
                  ...graph.layout[n.id]!,
                })),
              edges: Object.values(graph.edges).map((e) => ({ from: e.from, to: e.to })),
            };
          }),
      );
    }
    if (parts[3] !== 'features') return json(200, withCount(app));
    if (method === 'GET')
      return json(
        200,
        features.filter((f) => f.appId === appId),
      );
    const error = invalidName(body.name);
    if (error) return error;
    const now = new Date(0).toISOString();
    const description = (body as { description?: string | null }).description?.trim() ?? '';
    const feature: Feature = { id: id(), appId, name: body.name!.trim(), description, createdAt: now, updatedAt: now };
    features.push(feature);
    return json(201, feature);
  });

  vi.stubGlobal('fetch', fetchMock);
  return { apps, features, canvases, catalog, assets, shares, next: next_, fetchMock };
}
