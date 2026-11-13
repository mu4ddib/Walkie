import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { ApiError, type SharedFeature } from '../api/client';
import { useSharedFeature } from '../api/hooks';
import { Canvas } from '../canvas/Canvas';
import type { CanvasCatalog } from '../catalog/catalogContext';
import { createGraphStore } from '../store/graphStore';
import { formatDay } from './shareFormat';
import { readModuleEntry } from '../workspace/paths';
import './share.css';

/**
 * Vista pública de un enlace de solo lectura (`/s/:token`, spec enlace-solo-lectura, criterios 5 a 10):
 * sin sesión, el lienzo de la feature sin edición y sus tours. Un enlace revocado, caducado o inexistente
 * muestra el mismo aviso, sin decir cuál de los tres es.
 */
export function SharedFeaturePage() {
  const { token = '' } = useParams();
  const shared = useSharedFeature(token);

  if (shared.isPending) return <p>Cargando…</p>;
  if (shared.error) {
    return shared.error instanceof ApiError && shared.error.status === 404 ? (
      <div className="shared-unavailable" role="alert">
        <h2>Este enlace ya no está disponible</h2>
        <p>Pide a quien te lo envió uno nuevo.</p>
      </div>
    ) : (
      <p role="alert">No se pudo cargar. Revisa la conexión y vuelve a intentarlo.</p>
    );
  }
  return <SharedCanvas token={token} shared={shared.data} />;
}

function SharedCanvas({ token, shared }: { token: string; shared: SharedFeature }) {
  const [store] = useState(() => {
    const s = createGraphStore();
    s.getState().loadGraph(shared.graph);
    return s;
  });
  const [catalog] = useState<CanvasCatalog>(() => ({
    appId: '',
    items: Object.fromEntries(shared.catalog.map((i) => [i.id, i])),
    share: { token },
    // Los módulos que usa (spec modulos-compartidos): sus cajas se ven y se abren de solo lectura.
    modules: Object.fromEntries((shared.modules ?? []).map((m) => [m.id, m])),
  }));
  // Al volver de un módulo: su caja seleccionada sin mover la vista y, si se venía de un recorrido, en el mismo paso.
  const [search] = useSearchParams();
  const entry = readModuleEntry(search);

  return (
    <section className="shared-page" aria-label="Feature compartida">
      <h2>
        {shared.appName} / {shared.featureName}
      </h2>
      <p className="shared-bar" role="status">
        Solo lectura · disponible hasta el {formatDay(shared.expiresAt)}
      </p>
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
