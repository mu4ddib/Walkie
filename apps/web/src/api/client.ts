import type { WalkieCanvasGraphV0 } from '../schema/walkie-graph';
import type { WalkieCatalogItemV0 } from '../schema/walkie-catalog-item';
import type { WalkieAssetV0 } from '../schema/walkie-asset';
import type { WalkieShareV0 } from '../schema/walkie-share';
import type { WalkieSharedFeatureV0 } from '../schema/walkie-shared-feature';
import type { Layout, WalkieAppMapV0 } from '../schema/walkie-app-map';
import type { WalkieImportSummaryV0 } from '../schema/walkie-import-summary';

/** Mapa de una app (`GET /api/apps/{appId}/map`, spec mapa-de-la-app). */
export type AppMap = WalkieAppMapV0;
/** Distribución guardada del mapa (`$defs/layout`). */
export type MapLayout = Layout;

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
  /** Cantidad de features (tarjetas de la galería). */
  featureCount: number;
}

export interface Feature {
  id: string;
  appId: string;
  name: string;
  /** Para qué sirve; vacía si no se ha escrito. */
  description: string;
  createdAt: string;
  /** Último cambio de nombre o descripción (el del lienzo viene en su vista previa). */
  updatedAt: string;
}

/** Lo que se envía al renombrar una feature. */
export interface FeatureChanges {
  name: string;
  description: string;
}

/** Vista previa del último lienzo guardado (`GET /api/apps/{appId}/canvas-previews`); un `ref` trae el tipo de su elemento. */
export interface CanvasPreview {
  featureId: string;
  updatedAt: string;
  nodes: { id: string; type: string; x: number; y: number; w?: number | null; h?: number | null }[];
  edges: { from: string; to: string }[];
}

/** Elemento del catálogo (`packages/schema/walkie-catalog-item.schema.json`). */
export type CatalogItem = WalkieCatalogItemV0;
export type CatalogItemType = CatalogItem['type'];
/** Lo que se envía al crear: sin id, app ni versión. */
export type NewCatalogItem = Pick<CatalogItem, 'type' | 'title' | 'description' | 'http' | 'database' | 'resource' | 'runtime'>;
/** Lo que se envía al editar: el tipo no cambia; `version` es la que se cargó. */
export type CatalogItemChanges = Pick<
  CatalogItem,
  'title' | 'description' | 'http' | 'database' | 'resource' | 'runtime' | 'version'
>;

/** Imagen subida a una app (`packages/schema/walkie-asset.schema.json`, ADR-0004). */
export type Asset = WalkieAssetV0;

/** Formatos y tamaño que acepta la API (spec imagenes-portal, decisión 2). */
export const ASSET_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const ASSET_MAX_SIZE = 5 * 1024 * 1024;

/** Enlace de solo lectura (`packages/schema/walkie-share.schema.json`, ADR-0005). `token` solo llega al crearlo. */
export type Share = WalkieShareV0;

/** Lo que ve quien abre un enlace (`walkie-shared-feature.schema.json`). */
export type SharedFeature = WalkieSharedFeatureV0;

/** Duraciones que acepta la API, en días (spec enlace-solo-lectura, criterio 1). */
export const SHARE_DAYS = [7, 30, 90] as const;
export type ShareDays = (typeof SHARE_DAYS)[number];

/** URL que se comparte: la arma la web, porque la API no conoce su dominio. */
export function shareUrl(token: string): string {
  return `${window.location.origin}/s/${token}`;
}

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

/** `fetch` a la API con el token; un error HTTP llega como `ApiError`. JSON solo si el cuerpo es texto. */
async function send(path: string, init: RequestInit & { token?: string } = {}): Promise<Response> {
  const { token, headers, ...rest } = init;
  const res = await fetch(`${baseUrl}${path}`, {
    ...rest,
    headers: {
      ...(typeof rest.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    const problem = (await res.json().catch(() => undefined)) as Problem | undefined;
    throw new ApiError(res.status, problem);
  }
  return res;
}

async function request<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const res = await send(path, init);
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

export function updateFeature(token: string, featureId: string, changes: FeatureChanges): Promise<Feature> {
  return request(`/api/features/${encodeURIComponent(featureId)}`, {
    token,
    method: 'PUT',
    body: JSON.stringify(changes),
  });
}

export function listCanvasPreviews(token: string, appId: string, signal?: AbortSignal): Promise<CanvasPreview[]> {
  return request(`/api/apps/${encodeURIComponent(appId)}/canvas-previews`, { token, signal });
}

export function getAppMap(token: string, appId: string, signal?: AbortSignal): Promise<AppMap> {
  return request(`/api/apps/${encodeURIComponent(appId)}/map`, { token, signal });
}

/** Guarda la distribución del mapa; responde la distribución con `version` + 1, o 409 / 400 como `ApiError`. */
export function saveMapLayout(token: string, appId: string, layout: MapLayout): Promise<MapLayout> {
  return request(`/api/apps/${encodeURIComponent(appId)}/map/layout`, {
    token,
    method: 'PUT',
    body: JSON.stringify(layout),
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

/** Sube una imagen (multipart, campo `file`); la API la reconoce por su contenido. */
export function uploadAsset(token: string, appId: string, file: File): Promise<Asset> {
  const body = new FormData();
  body.append('file', file);
  return request(`/api/apps/${encodeURIComponent(appId)}/assets`, { token, method: 'POST', body });
}

/** Bytes de una imagen. `<img src>` no manda el token, así que se piden con `fetch` (ADR-0004). */
export async function getAssetBlob(token: string, assetId: string, signal?: AbortSignal): Promise<Blob> {
  const res = await send(`/api/assets/${encodeURIComponent(assetId)}`, { token, signal });
  return res.blob();
}

/** Crea un enlace; la respuesta trae el `token` (la única vez que viaja). */
export function createShare(token: string, featureId: string, expiresInDays: ShareDays): Promise<Share> {
  return request(`/api/features/${encodeURIComponent(featureId)}/shares`, {
    token,
    method: 'POST',
    body: JSON.stringify({ expiresInDays }),
  });
}

/** Enlaces activos de la feature (sin token), del más nuevo al más viejo. */
export function listShares(token: string, featureId: string, signal?: AbortSignal): Promise<Share[]> {
  return request(`/api/features/${encodeURIComponent(featureId)}/shares`, { token, signal });
}

/** 204: el enlace deja de funcionar en el acto. */
export function revokeShare(token: string, shareId: string): Promise<void> {
  return request(`/api/shares/${encodeURIComponent(shareId)}`, { token, method: 'DELETE' });
}

/** La feature de un enlace, sin sesión; 404 como `ApiError` si está revocado, caducado o no existe. */
export function getSharedFeature(shareToken: string, signal?: AbortSignal): Promise<SharedFeature> {
  return request(`/api/public/shares/${encodeURIComponent(shareToken)}`, { signal });
}

/** Bytes de una imagen del lienzo compartido, sin sesión. */
export async function getSharedAssetBlob(shareToken: string, assetId: string, signal?: AbortSignal): Promise<Blob> {
  const res = await send(
    `/api/public/shares/${encodeURIComponent(shareToken)}/assets/${encodeURIComponent(assetId)}`,
    { signal },
  );
  return res.blob();
}

/** Archivo descargado de la API: el nombre sale de `Content-Disposition` (la API lo expone por CORS). */
export interface Download {
  fileName: string;
  blob: Blob;
}

/** El `.zip` de la feature (su `.md` e `img/`), con la última versión guardada (spec export-markdown). */
/**
 * Formatos del export (spec exportar-e-importar): `markdown` es el `.zip` de siempre; `ai`, el contexto para IA en
 * Markdown; `ai-json`, el mismo contexto en JSON (`packages/schema/walkie-ai-context.schema.json`), y `walkie`, el
 * archivo para reconstruir la feature (`walkie-package.schema.json`).
 */
export type ExportFormat = 'markdown' | 'ai' | 'ai-json' | 'walkie';

const EXPORT_FALLBACK_NAMES: Record<ExportFormat, string> = {
  markdown: 'feature.zip',
  ai: 'contexto-ia.md',
  'ai-json': 'feature.context.json',
  walkie: 'feature.walkie',
};

export async function exportFeature(token: string, featureId: string, format: ExportFormat = 'markdown'): Promise<Download> {
  const query = format === 'markdown' ? '' : `?format=${format}`;
  const res = await send(`/api/features/${encodeURIComponent(featureId)}/export${query}`, { token });
  return { fileName: fileNameOf(res.headers.get('Content-Disposition')) ?? EXPORT_FALLBACK_NAMES[format], blob: await res.blob() };
}

/**
 * PDF de la feature (spec exportar-e-importar, tarea 4; ADR-0008): la API lo arma con lo guardado y la imagen del
 * lienzo que se le manda (sin ella, el PDF va sin esa página).
 */
export async function exportPdf(token: string, featureId: string, canvas: Blob | null): Promise<Download> {
  const form = new FormData();
  if (canvas) form.append('canvas', canvas, 'lienzo.png');
  const res = await send(`/api/features/${encodeURIComponent(featureId)}/export/pdf`, {
    token,
    method: 'POST',
    body: canvas ? form : undefined,
  });
  return { fileName: fileNameOf(res.headers.get('Content-Disposition')) ?? 'feature.pdf', blob: await res.blob() };
}

/** Formatos de la app: contexto para IA (`ai`, `ai-json`, tarea 2) o el `.walkie` de la app completa (`walkie`, tarea 7). */
export type AppExportFormat = 'ai' | 'ai-json' | 'walkie';

const APP_EXPORT_FALLBACK_NAMES: Record<AppExportFormat, string> = {
  ai: 'app-contexto-ia.md',
  'ai-json': 'app.app-context.json',
  walkie: 'app.walkie',
};

/** Exporta la app completa: contexto para IA (Markdown o JSON) o su archivo `.walkie`. */
export async function exportApp(token: string, appId: string, format: AppExportFormat = 'ai'): Promise<Download> {
  const res = await send(`/api/apps/${encodeURIComponent(appId)}/export?format=${format}`, { token });
  const fallback = APP_EXPORT_FALLBACK_NAMES[format];
  return { fileName: fileNameOf(res.headers.get('Content-Disposition')) ?? fallback, blob: await res.blob() };
}

/** Resumen de importar un `.walkie` (`walkie-import-summary.schema.json`). */
export type ImportSummary = WalkieImportSummaryV0;

/**
 * Importa un archivo `.walkie` (spec exportar-e-importar, tareas 6 y 7; ADR-0009): sus features en la app `appId` o,
 * con `appId` en `null`, como una app nueva. Con `dryRun` solo valida y responde qué crearía; los errores llegan como
 * `ApiError` (400 con la ruta dentro del archivo, 413 si pasa de 50 MB).
 */
export function importPackage(token: string, appId: string | null, file: Blob, dryRun: boolean): Promise<ImportSummary> {
  const form = new FormData();
  form.append('file', file, 'archivo.walkie');
  const path = appId === null ? '/api/apps/import' : `/api/apps/${encodeURIComponent(appId)}/import`;
  return request(`${path}${dryRun ? '?dryRun=true' : ''}`, {
    token,
    method: 'POST',
    body: form,
  });
}

/** `filename*=UTF-8''…` o `filename=…` de un `Content-Disposition`. */
export function fileNameOf(disposition: string | null): string | undefined {
  if (!disposition) return undefined;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  if (encoded) return decodeURIComponent(encoded.trim());
  return /filename="?([^";]+)"?/i.exec(disposition)?.[1]?.trim();
}
