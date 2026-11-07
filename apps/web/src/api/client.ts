import type { WalkieCanvasGraphV0 } from '../schema/walkie-graph';
import type { WalkieCatalogItemV0 } from '../schema/walkie-catalog-item';

const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:5080';

export interface Health {
  status: string;
  schemaVersion: number;
}

export interface Me {
  id: string;
  name: string;
  email?: string | null;
}

export interface App {
  id: string;
  name: string;
  createdAt: string;
}

export interface Feature {
  id: string;
  appId: string;
  name: string;
  createdAt: string;
}

/** Elemento del catálogo (`packages/schema/walkie-catalog-item.schema.json`). */
export type CatalogItem = WalkieCatalogItemV0;
export type CatalogItemType = CatalogItem['type'];
/** Lo que se envía al crear: sin id, app ni versión. */
export type NewCatalogItem = Pick<CatalogItem, 'type' | 'title' | 'description' | 'http'>;
/** Lo que se envía al editar: el tipo no cambia; `version` es la que se cargó. */
export type CatalogItemChanges = Pick<CatalogItem, 'title' | 'description' | 'http' | 'version'>;

/** Cuerpo `ProblemDetails` (RFC 9457) que devuelve la API en los errores. */
export interface Problem {
  title?: string;
  detail?: string;
  errors?: Record<string, string[]>;
  [extension: string]: unknown;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly problem?: Problem,
  ) {
    super(problem?.title ?? `API respondió ${status}`);
  }

  /** Primer mensaje de validación, o el título del problema. */
  get userMessage(): string {
    const first = this.problem?.errors && Object.values(this.problem.errors)[0]?.[0];
    return first ?? this.message;
  }
}

async function request<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, headers, ...rest } = init;
  const res = await fetch(`${baseUrl}${path}`, {
    ...rest,
    headers: {
      ...(rest.body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    const problem = (await res.json().catch(() => undefined)) as Problem | undefined;
    throw new ApiError(res.status, problem);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function getHealth(signal?: AbortSignal): Promise<Health> {
  return request('/api/health', { signal });
}

export function getMe(token: string, signal?: AbortSignal): Promise<Me> {
  return request('/api/me', { token, signal });
}

export function listApps(token: string, signal?: AbortSignal): Promise<App[]> {
  return request('/api/apps', { token, signal });
}

export function getApp(token: string, appId: string, signal?: AbortSignal): Promise<App> {
  return request(`/api/apps/${encodeURIComponent(appId)}`, { token, signal });
}

export function createApp(token: string, name: string): Promise<App> {
  return request('/api/apps', { token, method: 'POST', body: JSON.stringify({ name }) });
}

export function listFeatures(token: string, appId: string, signal?: AbortSignal): Promise<Feature[]> {
  return request(`/api/apps/${encodeURIComponent(appId)}/features`, { token, signal });
}

export function createFeature(token: string, appId: string, name: string): Promise<Feature> {
  return request(`/api/apps/${encodeURIComponent(appId)}/features`, {
    token,
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export function getCanvas(token: string, featureId: string, signal?: AbortSignal): Promise<WalkieCanvasGraphV0> {
  return request(`/api/features/${encodeURIComponent(featureId)}/canvas`, { token, signal });
}

/** Guarda el grafo; la API responde el grafo con `version` + 1, o 409 / 400 como `ApiError`. */
export function saveCanvas(token: string, featureId: string, graph: WalkieCanvasGraphV0): Promise<WalkieCanvasGraphV0> {
  return request(`/api/features/${encodeURIComponent(featureId)}/canvas`, {
    token,
    method: 'PUT',
    body: JSON.stringify(graph),
  });
}

export function listCatalog(token: string, appId: string, signal?: AbortSignal): Promise<CatalogItem[]> {
  return request(`/api/apps/${encodeURIComponent(appId)}/catalog`, { token, signal });
}

export function createCatalogItem(token: string, appId: string, item: NewCatalogItem): Promise<CatalogItem> {
  return request(`/api/apps/${encodeURIComponent(appId)}/catalog`, {
    token,
    method: 'POST',
    body: JSON.stringify(item),
  });
}

export function getCatalogItem(token: string, itemId: string, signal?: AbortSignal): Promise<CatalogItem> {
  return request(`/api/catalog/${encodeURIComponent(itemId)}`, { token, signal });
}

/** Guarda si `version` coincide; si no, 409 con `currentVersion` como `ApiError`. */
export function updateCatalogItem(token: string, itemId: string, changes: CatalogItemChanges): Promise<CatalogItem> {
  return request(`/api/catalog/${encodeURIComponent(itemId)}`, {
    token,
    method: 'PUT',
    body: JSON.stringify(changes),
  });
}

/** 204; si algún lienzo lo usa, 409 con `features` como `ApiError`. */
export function deleteCatalogItem(token: string, itemId: string): Promise<void> {
  return request(`/api/catalog/${encodeURIComponent(itemId)}`, { token, method: 'DELETE' });
}

/** Features cuyo lienzo tiene un `ref` al elemento. */
export function listCatalogUsages(token: string, itemId: string, signal?: AbortSignal): Promise<Feature[]> {
  return request(`/api/catalog/${encodeURIComponent(itemId)}/usages`, { token, signal });
}
