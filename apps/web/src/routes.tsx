import { Link, type RouteObject } from 'react-router';
import { AppPage } from './pages/AppPage';
import { AppsPage } from './pages/AppsPage';
import { FeaturePage } from './pages/FeaturePage';

export const routes: RouteObject[] = [
  { path: '/', element: <AppsPage /> },
  { path: '/apps/:appId', element: <AppPage /> },
  { path: '/apps/:appId/features/:featureId', element: <FeaturePage /> },
  {
    path: '*',
    element: (
      <section className="page">
        <p role="alert">Página no encontrada.</p>
        <Link to="/">Volver a las apps</Link>
      </section>
    ),
  },
];
