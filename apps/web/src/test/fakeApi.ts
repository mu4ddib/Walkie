import { vi } from 'vitest';
import type { App, Feature } from '../api/client';

/**
 * API falsa en memoria para pruebas de componentes: reemplaza `fetch` y responde
 * como `apps/api` (201/200/400/404 con ProblemDetails). Devuelve el estado para inspeccionarlo.
 */
export function installFakeApi(seed: { apps?: App[]; features?: Feature[] } = {}) {
  const apps = [...(seed.apps ?? [])];
  const features = [...(seed.features ?? [])];
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
  return { apps, features, fetchMock };
}
