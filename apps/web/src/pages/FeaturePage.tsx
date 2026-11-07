import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useApp, useFeatures } from '../api/hooks';
import { Canvas } from '../canvas/Canvas';
import { createGraphStore } from '../store/graphStore';
import { QueryState } from '../ui/QueryState';

/** Lienzo de una feature. Cargar y guardar el grafo llega en la tarea 7 de lienzo-base. */
export function FeaturePage() {
  const { appId = '', featureId = '' } = useParams();
  const app = useApp(appId);
  const features = useFeatures(appId);
  const feature = features.data?.find((f) => f.id === featureId);
  // Un store por feature: al cambiar de feature, React monta la página de nuevo (key en routes).
  const [store] = useState(() => createGraphStore());

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
            <div className="feature-canvas">
              <Canvas store={store} />
            </div>
          )}
        </>
      )}
    </section>
  );
}
