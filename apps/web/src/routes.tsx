import { Link, type RouteObject } from 'react-router';
import { AppPage } from './pages/AppPage';
import { AppsPage } from './pages/AppsPage';
import { CatalogPage } from './pages/CatalogPage';
import { FeatureRoute } from './pages/FeatureRoute';
import { ModuleRoute } from './pages/ModuleRoute';
import { MapPage } from './map/MapPage';
import { SharedFeaturePage } from './share/SharedFeaturePage';
import { SHARED_MODULE_PATH, SHARED_PATH } from './share/sharedPath';
import { SharedModulePage } from './share/SharedModulePage';
import { HomePage } from './workspace/HomePage';
import { APPS_PATH } from './workspace/paths';

export const routes: RouteObject[] = [
  // El lienzo es la pantalla de inicio (spec espacio-de-trabajo): `/` abre la última feature o la bienvenida.
  { path: '/', element: <HomePage /> },
  { path: APPS_PATH, element: <AppsPage /> },
  { path: '/apps/:appId', element: <AppPage /> },
  { path: '/apps/:appId/catalog', element: <CatalogPage /> },
  // Mapa de la app (spec mapa-de-la-app): una vista adicional a la galería.
  { path: '/apps/:appId/map', element: <MapPage /> },
  { path: '/apps/:appId/catalog/:itemId', element: <CatalogPage /> },
  { path: '/apps/:appId/features/:featureId', element: <FeatureRoute /> },
  // Lienzo de un módulo compartido (spec modulos-compartidos): el mismo editor, con su franja.
  { path: '/apps/:appId/modules/:moduleId', element: <ModuleRoute /> },
  // Pública (ADR-0005): `App` la monta sin `AuthGate`.
  { path: SHARED_PATH, element: <SharedFeaturePage /> },
  { path: SHARED_MODULE_PATH, element: <SharedModulePage /> },
  {
    path: '*',
    element: (
      <section className="page">
        <p role="alert">Página no encontrada.</p>
        <Link to={APPS_PATH}>Ver las apps</Link>
      </section>
    ),
  },
];

