import { Link, useParams } from 'react-router';
import { useApp, useCanvas, useFeatures } from '../api/hooks';
import { FeatureEditor } from '../canvas/FeatureEditor';
import { QueryState } from '../ui/QueryState';

/** Lienzo de una feature: carga el grafo guardado y monta el editor. */
export function FeaturePage() {
  const { appId = '', featureId = '' } = useParams();
  const app = useApp(appId);
  const features = useFeatures(appId);
  const feature = features.data?.find((f) => f.id === featureId);
  const canvas = useCanvas(featureId);

  return (
    <section className="feature-page">
      <nav className="breadcrumb" aria-label="Ruta">
        <Link to="/">Apps</Link>
        {app.data && (
          <span>
            {' / '}
            <Link to={`/apps/${appId}`}>{app.data.name}</Link>
          </span>
        )}
        {feature && <span> / {feature.name}</span>}
      </nav>
      {features.data && !feature ? (
        <p role="alert">Esta feature no existe.</p>
      ) : (
        <>
          <QueryState isPending={features.isPending} error={features.error} notFound="Esta app no existe." />
          {feature && (
            <>
              <QueryState isPending={canvas.isPending} error={canvas.error} notFound="Esta feature no existe." />
              {/* El editor crea su store con el grafo cargado; al cambiar de feature se monta otro (key en FeatureRoute). */}
              {canvas.data && <FeatureEditor featureId={featureId} initialGraph={canvas.data} />}
            </>
          )}
        </>
      )}
    </section>
  );
}
