import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from 'react-oidc-context';
import { createApp, createFeature, getApp, listApps, listFeatures } from './client';

/** Access token de la sesión actual. `AuthGate` garantiza que existe dentro de la app. */
export function useToken(): string {
  return useAuth().user?.access_token ?? '';
}

export const queryKeys = {
  apps: ['apps'] as const,
  app: (appId: string) => ['apps', appId] as const,
  features: (appId: string) => ['apps', appId, 'features'] as const,
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
