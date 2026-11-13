import { Link, useParams, useSearchParams } from 'react-router';
import { useEffect } from 'react';
import { useApp, useCanvas } from '../api/hooks';
import { FeatureEditor } from '../canvas/FeatureEditor';
import { QueryState } from '../ui/QueryState';
import { APPS_PATH, appPath } from '../workspace/paths';
import { forgetLastWorkspace, setLastWorkspace } from '../workspace/session';
import { useEditorCatalog } from './editorCatalog';

/**
 * Lienzo de una feature a pantalla completa (spec espacio-de-trabajo): carga el grafo guardado y monta el
 * editor, que trae su propia barra superior. Recuerda esta feature como la última abierta en el navegador.
 */
export function FeaturePage() {
  const { appId = '', featureId = '' } = useParams();
  // `?select=<id>`: abrir con esa caja seleccionada y centrada (ej. «Abrir en el lienzo» desde el mapa de la app).
  // Con `keep` (al volver de un módulo) se selecciona sin mover la vista recordada; `play` y `step` siguen el recorrido.
  const [search] = useSearchParams();
  const focusId = search.get('select') ?? undefined;
  const keepView = search.get('keep') === '1';
  const play = search.get('play');
  const step = Number(search.get('step') ?? 0);
  const app = useApp(appId);
  const { catalog, features, error } = useEditorCatalog(appId, featureId);
  const feature = features.data?.find((f) => f.id === featureId);
  const canvas = useCanvas(featureId);
  const missing = features.data !== undefined && !feature;

  useEffect(() => {
    if (feature) setLastWorkspace({ appId, featureId });
    else if (missing) forgetLastWorkspace();
  }, [appId, featureId, feature, missing]);

  if (missing || error || canvas.error) {
    return (
      <section className="workspace-problem">
        {missing ? (
          <p role="alert">Esta feature no existe.</p>
        ) : (
          <QueryState isPending={false} error={error ?? canvas.error} notFound="Esta app no existe." />
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
        focusId={focusId}
        focusCenter={!keepView}
        initialPlay={play ? { tourId: play, step: Number.isInteger(step) ? step : 0 } : undefined}
      />
    </section>
  );
}
