import { Navigate } from 'react-router';
import { useApps, useFeatures } from '../api/hooks';
import { QueryState } from '../ui/QueryState';
import { getLastWorkspace } from './session';
import { appPath, featurePath } from './paths';
import { Welcome } from './Welcome';

/**
 * `/`: el lienzo es la pantalla de inicio (spec espacio-de-trabajo, criterio 1). Abre la última feature
 * de este navegador si aún existe; si no, la primera feature de la app que corresponda; sin apps, la bienvenida.
 */
export function HomePage() {
  const apps = useApps();
  // Al volver del login, `onSigninCallback` ya puso en la URL la página de la que se venía y `BrowserRouter` la aplica
  // en una transición; mientras tanto esta página puede montarse con la ruta vieja («/»). Si la URL real ya no es «/»,
  // no hay que llevar a ningún lado: abrir la última feature pisaría la página pedida (pasaba en WebKit).
  const stale = window.location.pathname !== '/';
  const last = getLastWorkspace();
  const target = apps.data?.find((a) => a.id === last?.appId) ?? apps.data?.[0];

  if (stale || !apps.data) {
    return (
      <div className="workspace-loading">
        <QueryState isPending={stale || apps.isPending} error={stale ? null : apps.error} notFound="" />
      </div>
    );
  }
  if (!target) return <Welcome />;
  return <OpenApp appId={target.id} featureId={target.id === last?.appId ? last.featureId : undefined} />;
}

function OpenApp({ appId, featureId }: { appId: string; featureId?: string }) {
  const features = useFeatures(appId);
  if (!features.data) {
    return (
      <div className="workspace-loading">
        <QueryState isPending={features.isPending} error={features.error} notFound="" />
      </div>
    );
  }
  const feature = features.data.find((f) => f.id === featureId) ?? features.data[0];
  return <Navigate replace to={feature ? featurePath(appId, feature.id) : appPath(appId)} />;
}
