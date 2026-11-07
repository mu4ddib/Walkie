import { Link, type RouteObject } from 'react-router';
import { AppPage } from './pages/AppPage';
import { AppsPage } from './pages/AppsPage';
import { CatalogPage } from './pages/CatalogPage';
import { FeatureRoute } from './pages/FeatureRoute';

export const routes: RouteObject[] = [
  { path: '/', element: <AppsPage /> },
  { path: '/apps/:appId', element: <AppPage /> },
  { path: '/apps/:appId/catalog', element: <CatalogPage /> },
  { path: '/apps/:appId/catalog/:itemId', element: <CatalogPage /> },
  { path: '/apps/:appId/features/:featureId', element: <FeatureRoute /> },
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

