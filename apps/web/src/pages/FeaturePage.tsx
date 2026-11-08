import { Link, useParams } from 'react-router';
import { useEffect, useMemo } from 'react';
import { useApp, useCanvas, useCatalog, useFeatures } from '../api/hooks';
import { toCanvasCatalog } from '../catalog/catalogContext';
import { FeatureEditor } from '../canvas/FeatureEditor';
import { QueryState } from '../ui/QueryState';
import { APPS_PATH, appPath } from '../workspace/paths';
import { forgetLastWorkspace, setLastWorkspace } from '../workspace/session';

/**
 * Lienzo de una feature a pantalla completa (spec espacio-de-trabajo): carga el grafo guardado y monta el
 * editor, que trae su propia barra superior. Recuerda esta feature como la última abierta en el navegador.
 */
export function FeaturePage() {
  const { appId = '', featureId = '' } = useParams();
  const app = useApp(appId);
  const features = useFeatures(appId);
  const feature = features.data?.find((f) => f.id === featureId);
  const canvas = useCanvas(featureId);
  const catalogQuery = useCatalog(appId);
  const catalog = useMemo(
    () =>
      catalogQuery.data ? toCanvasCatalog(appId, catalogQuery.data, features.data ?? [], featureId) : undefined,
    [appId, catalogQuery.data, features.data, featureId],
  );
  const missing = features.data !== undefined && !feature;

  useEffect(() => {
    if (feature) setLastWorkspace({ appId, featureId });
    else if (missing) forgetLastWorkspace();
  }, [appId, featureId, feature, missing]);

  if (missing || features.error || canvas.error || catalogQuery.error) {
    return (
      <section className="workspace-problem">
        {missing ? (
          <p role="alert">Esta feature no existe.</p>
        ) : (
          <QueryState isPending={false} error={features.error ?? canvas.error ?? catalogQuery.error} notFound="Esta app no existe." />
        )}
        <p>
          <Link to={appPath(appId)}>Ver las features de la app</Link> · <Link to={APPS_PATH}>Todas las apps</Link>
        </p>
      </section>
    );
  }

  // El editor crea su store con el grafo cargado; al cambiar de feature se monta otro (key en FeatureRoute).
  if (!canvas.data || !catalog || !feature) {
    return (
      <div className="workspace-loading">
        <p>Abriendo el lienzo…</p>
      </div>
    );
  }

  return (
    <section className="feature-page">
      <FeatureEditor
        featureId={featureId}
        initialGraph={canvas.data}
        catalog={catalog}
        location={{ appId, appName: app.data?.name, featureName: feature.name }}
      />
    </section>
  );
}
