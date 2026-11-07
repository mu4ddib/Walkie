import { vi } from 'vitest';
import type { App, Feature } from '../api/client';
import type { WalkieCanvasGraphV0 } from '../schema/walkie-graph';

/**
 * API falsa en memoria para pruebas de componentes: reemplaza `fetch` y responde
 * como `apps/api` (201/200/400/404 con ProblemDetails). Devuelve el estado para inspeccionarlo.
 */
export function installFakeApi(
  seed: { apps?: App[]; features?: Feature[]; canvases?: Record<string, WalkieCanvasGraphV0> } = {},
) {
  const apps = [...(seed.apps ?? [])];
  const features = [...(seed.features ?? [])];
  const canvases: Record<string, WalkieCanvasGraphV0> = { ...seed.canvases };
  /** Si se define, el próximo PUT del lienzo responde este estado (ej. 400). */
  const next_: { putStatus?: number } = {};
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
    const body = init?.body ? (JSON.parse(String(init.body)) as { name?: string }) : {};
    const parts = url.pathname.split('/').filter(Boolean); // ['api','apps',id?,'features'?]

    // /api/features/{featureId}/canvas — como la API: 404, grafo vacío v0, 409 por versión, version + 1.
    if (parts[1] === 'features' && parts[3] === 'canvas') {
      const featureId = parts[2]!;
      if (!features.some((f) => f.id === featureId)) return notFound();
      const current = canvases[featureId] ?? { schemaVersion: 0, version: 0, nodes: {}, edges: {}, layout: {} };
      if (method === 'GET') return json(200, current);
      if (next_.putStatus === 400) {
        delete next_.putStatus;
        return json(400, { title: 'El grafo no es válido.', errors: { '/edges/e1/to': ['La conexión apunta a un nodo que no existe.'] } });
      }
      const graph = JSON.parse(String(init?.body)) as WalkieCanvasGraphV0;
      if (graph.version !== current.version) {
        return json(409, { title: 'El lienzo cambió desde que lo cargaste.', currentVersion: current.version });
      }
      canvases[featureId] = { ...graph, version: current.version + 1 };
      return json(200, canvases[featureId]);
    }

    if (parts[0] !== 'api' || parts[1] !== 'apps') return notFound();
    const appId = parts[2];

    if (!appId) {
      if (method === 'GET') return json(200, apps);
      const error = invalidName(body.name);
      if (error) return error;
      const app: App = { id: id(), name: body.name!.trim(), createdAt: new Date(0).toISOString() };
      apps.push(app);
      return json(201, app);
    }

    const app = apps.find((a) => a.id === appId);
    if (!app) return notFound();
    if (parts[3] !== 'features') return json(200, app);
    if (method === 'GET') return json(200, features.filter((f) => f.appId === appId));
    const error = invalidName(body.name);
    if (error) return error;
    const feature: Feature = { id: id(), appId, name: body.name!.trim(), createdAt: new Date(0).toISOString() };
    features.push(feature);
    return json(201, feature);
  });

  vi.stubGlobal('fetch', fetchMock);
  return { apps, features, canvases, next: next_, fetchMock };
}
