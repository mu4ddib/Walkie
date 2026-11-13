import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ApiError, type SharedFeature, type SharedModule } from '../api/client';
import { useSharedFeature, useSharedModule } from '../api/hooks';
import { Canvas } from '../canvas/Canvas';
import type { CanvasCatalog } from '../catalog/catalogContext';
import { createGraphStore } from '../store/graphStore';
import { entryQuery, readModuleEntry, type ModuleEntry } from '../workspace/paths';
import { sharedModulePath, sharedPath } from './sharedPath';
import { formatDay } from './shareFormat';
import './share.css';
import '../modules/modules.css';

/**
 * Un módulo visto desde un enlace de solo lectura (`/s/:token/modules/:moduleId`, spec modulos-compartidos): su lienzo
 * sin edición, con la franja del módulo y «Volver» a la feature del enlace (o al módulo de origen), con su contexto.
 * Solo se ve si la feature del enlace lo usa.
 */
export function SharedModulePage() {
  const { token = '', moduleId = '' } = useParams();
  const feature = useSharedFeature(token);
  const module = useSharedModule(token, moduleId);
  const error = feature.error ?? module.error;

  if (feature.isPending || module.isPending) return <p>Cargando…</p>;
  if (error) {
    return error instanceof ApiError && error.status === 404 ? (
      <div className="shared-unavailable" role="alert">
        <h2>Este enlace ya no está disponible</h2>
        <p>Pide a quien te lo envió uno nuevo.</p>
      </div>
    ) : (
      <p role="alert">No se pudo cargar. Revisa la conexión y vuelve a intentarlo.</p>
    );
  }
  if (!feature.data || !module.data) return null;
  return <SharedModuleCanvas key={moduleId} token={token} moduleId={moduleId} feature={feature.data} module={module.data} />;
}

/** Volver dentro del enlace: a la feature (`from = feature`) o al módulo de origen con su propia entrada. */
function sharedReturnPath(token: string, entry: ModuleEntry): string {
  const back: ModuleEntry = { select: entry.node, keep: true, play: entry.returnTour, step: entry.returnStep };
  if (!entry.from || entry.from === 'feature') return sharedPath(token) + entryQuery(back);
  return sharedModulePath(token, entry.from) + entryQuery({ ...(entry.trail ?? {}), ...back });
}

function SharedModuleCanvas({
  token,
  moduleId,
  feature,
  module,
}: {
  token: string;
  moduleId: string;
  feature: SharedFeature;
  module: SharedModule;
}) {
  const [search] = useSearchParams();
  const entry = readModuleEntry(search);
  const [store] = useState(() => {
    const s = createGraphStore();
    s.getState().loadGraph(module.graph);
    return s;
  });
  const [catalog] = useState<CanvasCatalog>(() => ({
    appId: '',
    items: Object.fromEntries(module.catalog.map((i) => [i.id, i])),
    share: { token },
    modules: Object.fromEntries((feature.modules ?? []).map((m) => [m.id, m])),
    currentModuleId: moduleId,
  }));
  const fromName =
    !entry.from || entry.from === 'feature'
      ? feature.featureName
      : (feature.modules?.find((m) => m.id === entry.from)?.name ?? 'el módulo');

  return (
    <section className="shared-page" aria-label="Módulo compartido">
      <h2>
        {feature.appName} / {feature.featureName} / Módulo · {module.name}
      </h2>
      <div className="module-banner" role="region" aria-label="Módulo de solo lectura">
        <Link className="pixel-button module-back" to={sharedReturnPath(token, entry)}>
          ← Volver a {fromName}
        </Link>
        <span className="module-banner-name">
          <span className="module-banner-kind" aria-hidden="true">
            [::] Módulo
          </span>{' '}
          <strong>{module.name}</strong>
        </span>
        {module.description && <span className="module-banner-shared">{module.description}</span>}
        <span className="module-banner-shared">Solo lectura · disponible hasta el {formatDay(feature.expiresAt)}</span>
      </div>
      <div className="feature-canvas">
        <Canvas
          store={store}
          catalog={catalog}
          focusId={entry.select}
          focusCenter={!entry.keep}
          initialPlay={entry.play ? { tourId: entry.play, step: entry.step ?? 0 } : undefined}
        />
      </div>
    </section>
  );
}
