import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from 'react-oidc-context';
import type { WalkieCanvasGraphV0 } from '../schema/walkie-graph';
import {
  createApp,
  createShare,
  exportApp,
  exportPdf,
  exportFeature,
  getSharedAssetBlob,
  getSharedFeature,
  listShares,
  revokeShare,
  getAssetBlob,
  uploadAsset,
  createCatalogItem,
  createFeature,
  deleteCatalogItem,
  getApp,
  getCanvas,
  getCatalogItem,
  listApps,
  listCatalog,
  listCatalogUsages,
  listFeatures,
  saveCanvas,
  updateCatalogItem,
  updateFeature,
  listCanvasPreviews,
  getAppMap,
  saveMapLayout,
  type AppMap,
  type MapLayout,
  type CatalogItem,
  type FeatureChanges,
  type CatalogItemChanges,
  type NewCatalogItem,
  type ShareDays,
  type ExportFormat,
} from './client';

/** Access token de la sesión actual. `AuthGate` garantiza que existe dentro de la app. */
export function useToken(): string {
  return useAuth().user?.access_token ?? '';
}

export const queryKeys = {
  apps: ['apps'] as const,
  app: (appId: string) => ['apps', appId] as const,
  features: (appId: string) => ['apps', appId, 'features'] as const,
  /** Bajo `canvas` para que guardar un lienzo las marque viejas (ver `useSaveCanvas`). */
  previews: (appId: string) => ['canvas', 'previews', appId] as const,
  /** Bajo `canvas`: guardar un lienzo cambia el mapa de su app. */
  map: (appId: string) => ['canvas', 'map', appId] as const,
  canvas: (featureId: string) => ['canvas', featureId] as const,
  catalog: (appId: string) => ['apps', appId, 'catalog'] as const,
  catalogItem: (itemId: string) => ['catalog', itemId] as const,
  catalogUsages: (itemId: string) => ['catalog', itemId, 'usages'] as const,
  asset: (assetId: string) => ['assets', assetId] as const,
  shares: (featureId: string) => ['canvas', featureId, 'shares'] as const,
  shared: (shareToken: string) => ['shared', shareToken] as const,
  sharedAsset: (shareToken: string, assetId: string) => ['shared', shareToken, 'assets', assetId] as const,
};

export function useApps() {
  const token = useToken();
  return useQuery({ queryKey: queryKeys.apps, queryFn: ({ signal }) => listApps(token, signal) });
}

export function useApp(appId: string) {
  const token = useToken();
  return useQuery({ queryKey: queryKeys.app(appId), queryFn: ({ signal }) => getApp(token, appId, signal) });
}

export function useFeatures(appId: string) {
  const token = useToken();
  return useQuery({
    queryKey: queryKeys.features(appId),
    queryFn: ({ signal }) => listFeatures(token, appId, signal),
  });
}

export function useCreateApp() {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => createApp(token, name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.apps, exact: true }),
  });
}

export function useCreateFeature(appId: string) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => createFeature(token, appId, name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.features(appId) }),
  });
}

export function useUpdateFeature(appId: string) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ featureId, changes }: { featureId: string; changes: FeatureChanges }) =>
      updateFeature(token, featureId, changes),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.features(appId) }),
  });
}

/** Mapa de la app (spec mapa-de-la-app). */
export function useAppMap(appId: string) {
  const token = useToken();
  return useQuery({
    queryKey: queryKeys.map(appId),
    queryFn: ({ signal }) => getAppMap(token, appId, signal),
  });
}

/** Guarda la distribución del mapa; al terminar, el mapa en caché lleva la versión nueva. */
export function useSaveMapLayout(appId: string) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (layout: MapLayout) => saveMapLayout(token, appId, layout),
    onSuccess: (layout) =>
      queryClient.setQueryData<AppMap>(queryKeys.map(appId), (map) => (map ? { ...map, layout } : map)),
  });
}

export function useCanvasPreviews(appId: string) {
  const token = useToken();
  return useQuery({
    queryKey: queryKeys.previews(appId),
    queryFn: ({ signal }) => listCanvasPreviews(token, appId, signal),
  });
}

/**
 * Grafo guardado de la feature. Solo se usa para la carga inicial: después manda el store,
 * así que no se refresca solo (un refetch no debe pisar cambios sin guardar).
 */
export function useCanvas(featureId: string) {
  const token = useToken();
  return useQuery({
    queryKey: queryKeys.canvas(featureId),
    queryFn: ({ signal }) => getCanvas(token, featureId, signal),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

/** Trae la versión del servidor ignorando la caché (para recargar tras un 409). */
export function useFetchCanvas(featureId: string) {
  const token = useToken();
  const queryClient = useQueryClient();
  return () =>
    queryClient.fetchQuery({
      queryKey: queryKeys.canvas(featureId),
      queryFn: ({ signal }) => getCanvas(token, featureId, signal),
      staleTime: 0,
    });
}

export function useSaveCanvas(featureId: string) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (graph: WalkieCanvasGraphV0) => saveCanvas(token, featureId, graph),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.canvas(featureId), saved);
      // Las miniaturas de la galería y el "Se usa en" de los componentes cambian con el lienzo.
      void queryClient.invalidateQueries({ queryKey: ['canvas', 'previews'] });
      void queryClient.invalidateQueries({
        predicate: (q) => q.queryKey[0] === 'catalog' && q.queryKey[2] === 'usages',
      });
    },
  });
}

export function useCatalog(appId: string) {
  const token = useToken();
  return useQuery({ queryKey: queryKeys.catalog(appId), queryFn: ({ signal }) => listCatalog(token, appId, signal) });
}

export function useCatalogItem(itemId: string) {
  const token = useToken();
  return useQuery({
    queryKey: queryKeys.catalogItem(itemId),
    queryFn: ({ signal }) => getCatalogItem(token, itemId, signal),
    // Mientras se edita, un refetch no debe pisar el formulario; se recarga a pedido tras un 409.
    refetchOnWindowFocus: false,
  });
}

export function useCatalogUsages(itemId: string) {
  const token = useToken();
  return useQuery({
    queryKey: queryKeys.catalogUsages(itemId),
    queryFn: ({ signal }) => listCatalogUsages(token, itemId, signal),
  });
}

export function useCreateCatalogItem(appId: string) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (item: NewCatalogItem) => createCatalogItem(token, appId, item),
    onSuccess: (created) => {
      // Se agrega ya a la lista: el lienzo la usa para dibujar el `ref` recién creado sin esperar el refetch.
      queryClient.setQueryData<CatalogItem[]>(queryKeys.catalog(appId), (items) => items && [...items, created]);
      return queryClient.invalidateQueries({ queryKey: queryKeys.catalog(appId) });
    },
  });
}

export function useUpdateCatalogItem(appId: string, itemId: string) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (changes: CatalogItemChanges) => updateCatalogItem(token, itemId, changes),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.catalogItem(itemId), saved);
      return queryClient.invalidateQueries({ queryKey: queryKeys.catalog(appId) });
    },
  });
}

export function useDeleteCatalogItem(appId: string, itemId: string) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => deleteCatalogItem(token, itemId),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: queryKeys.catalogItem(itemId) });
      return queryClient.invalidateQueries({ queryKey: queryKeys.catalog(appId) });
    },
  });
}

export function useUploadAsset(appId: string) {
  const token = useToken();
  return useMutation({ mutationFn: (file: File) => uploadAsset(token, appId, file) });
}

/**
 * URL `blob:` de una imagen para `<img src>`. Un asset no cambia nunca, así que se pide una vez por
 * sesión (`staleTime` y `gcTime` infinitos) y la URL vive mientras la pestaña: son pocas imágenes por app.
 * Con `shareToken` (vista de un enlace) se pide sin sesión, por el endpoint público del enlace.
 */
export function useAssetUrl(assetId: string | undefined, shareToken?: string) {
  const token = useToken();
  return useQuery({
    queryKey: shareToken ? queryKeys.sharedAsset(shareToken, assetId ?? '') : queryKeys.asset(assetId ?? ''),
    queryFn: async ({ signal }) =>
      URL.createObjectURL(
        shareToken
          ? await getSharedAssetBlob(shareToken, assetId!, signal)
          : await getAssetBlob(token, assetId!, signal),
      ),
    enabled: Boolean(assetId),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

/** Enlaces activos de la feature (diálogo "Compartir"). */
export function useShares(featureId: string) {
  const token = useToken();
  return useQuery({
    queryKey: queryKeys.shares(featureId),
    queryFn: ({ signal }) => listShares(token, featureId, signal),
  });
}

export function useCreateShare(featureId: string) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (days: ShareDays) => createShare(token, featureId, days),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.shares(featureId) }),
  });
}

export function useRevokeShare(featureId: string) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (shareId: string) => revokeShare(token, shareId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.shares(featureId) }),
  });
}

/**
 * La feature de un enlace de solo lectura, sin sesión. Sin refetch automático: el lienzo se carga una vez
 * en su store (recargar la página trae la última versión guardada). Un 404 no se reintenta.
 */
export function useSharedFeature(shareToken: string) {
  return useQuery({
    queryKey: queryKeys.shared(shareToken),
    queryFn: ({ signal }) => getSharedFeature(shareToken, signal),
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
  });
}

/** Descarga el `.zip` del export de la feature (no cambia nada en la API). */
/** De qué es el contexto para IA: una feature (su lienzo) o la app completa. */
export type AiContextTarget = { kind: 'feature'; id: string } | { kind: 'app'; id: string };

/** Descarga el contexto para IA de una feature o de la app, en Markdown (`ai`) o JSON (`ai-json`). */
export function useAiContextExport(target: AiContextTarget) {
  const token = useToken();
  return useMutation({
    mutationFn: (format: 'ai' | 'ai-json') =>
      target.kind === 'app' ? exportApp(token, target.id, format) : exportFeature(token, target.id, format),
  });
}

/** PDF de la feature con la imagen del lienzo (o sin ella). */
export function useExportPdf(featureId: string) {
  const token = useToken();
  return useMutation({ mutationFn: (canvas: Blob | null) => exportPdf(token, featureId, canvas) });
}

export function useExportFeature(featureId: string) {
  const token = useToken();
  return useMutation({ mutationFn: (format?: ExportFormat) => exportFeature(token, featureId, format) });
}
