import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from 'react-oidc-context';
import type { WalkieCanvasGraphV0 } from '../schema/walkie-graph';
import { createApp, createFeature, getApp, getCanvas, listApps, listFeatures, saveCanvas } from './client';

/** Access token de la sesión actual. `AuthGate` garantiza que existe dentro de la app. */
export function useToken(): string {
  return useAuth().user?.access_token ?? '';
}

export const queryKeys = {
  apps: ['apps'] as const,
  app: (appId: string) => ['apps', appId] as const,
  features: (appId: string) => ['apps', appId, 'features'] as const,
  canvas: (featureId: string) => ['canvas', featureId] as const,
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
    onSuccess: (saved) => queryClient.setQueryData(queryKeys.canvas(featureId), saved),
  });
}
