import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { createApp, createFeature, saveCanvas } from '../api/client';
import { queryKeys, refreshAfterWrite, useToken } from '../api/hooks';
import { featurePath } from './paths';
import { SAMPLE_APP_NAME, SAMPLE_FEATURES, sampleFlow } from './sampleFlow';

/**
 * Primer ingreso (spec espacio-de-trabajo, criterio 2): crea la app y su primera feature, o el ejemplo
 * completo, y abre el lienzo de una vez, sin pasar por pantallas intermedias.
 */
export function useStartWorkspace() {
  const token = useToken();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const start = useMutation({
    mutationFn: async ({ appName, featureName }: { appName: string; featureName: string }) => {
      const app = await createApp(token, appName);
      const feature = await createFeature(token, app.id, featureName);
      return { appId: app.id, featureId: feature.id };
    },
    onSuccess: async (target) => {
      await refreshAfterWrite(queryClient, { queryKey: queryKeys.apps });
      void navigate(featurePath(target.appId, target.featureId));
    },
  });

  const sample = useMutation({
    mutationFn: async () => {
      const app = await createApp(token, SAMPLE_APP_NAME);
      const [login, transferir] = await Promise.all(SAMPLE_FEATURES.map((name) => createFeature(token, app.id, name)));
      await saveCanvas(token, login!.id, sampleFlow(transferir!.id));
      return { appId: app.id, featureId: login!.id };
    },
    onSuccess: async (target) => {
      await refreshAfterWrite(queryClient, { queryKey: queryKeys.apps });
      void navigate(featurePath(target.appId, target.featureId));
    },
  });

  return { start, sample };
}
