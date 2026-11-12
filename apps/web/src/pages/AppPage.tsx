import { useMemo, useState } from 'react';
import '../gallery/gallery.css';
import { Link, useParams } from 'react-router';
import { useApp, useCanvasPreviews, useCreateFeature, useFeatures, useUpdateFeature } from '../api/hooks';
import { FeatureCard } from '../gallery/FeatureCard';
import { GalleryTools } from '../gallery/GalleryTools';
import { matches, type FeatureSort } from '../gallery/search';
import { latest } from '../gallery/dates';
import { NameForm } from '../ui/NameForm';
import { catalogPath } from './catalogPaths';
import { mapPath } from '../workspace/paths';
import { QueryState } from '../ui/QueryState';
import { AiContextDialog } from '../canvas/AiContextDialog';
import { ImportDialog } from '../gallery/ImportDialog';

/**
 * Galería de features de una app (spec espacio-de-trabajo, criterios 7 a 9): tarjetas con miniatura,
 * descripción y fecha, búsqueda y orden; "Nueva feature" va aparte, arriba.
 */
export function AppPage() {
  const { appId = '' } = useParams();
  const app = useApp(appId);
  const features = useFeatures(appId);
  const previews = useCanvasPreviews(appId);
  const create = useCreateFeature(appId);
  const update = useUpdateFeature(appId);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<FeatureSort>('recent');
  // «Contexto para IA de la app» (spec exportar-e-importar, tarea 2).
  const [aiContext, setAiContext] = useState(false);
  // «Importar feature» desde un archivo .walkie (spec exportar-e-importar, tarea 6).
  const [importing, setImporting] = useState(false);

  const byFeature = useMemo(() => new Map((previews.data ?? []).map((p) => [p.featureId, p])), [previews.data]);
  const shown = useMemo(() => {
    const list = (features.data ?? []).filter((f) => matches(`${f.name} ${f.description}`, query));
    const updated = (id: string, own: string) => Date.parse(latest(own, byFeature.get(id)?.updatedAt));
    return sort === 'name'
      ? list.sort((a, b) => a.name.localeCompare(b.name, 'es'))
      : list.sort((a, b) => updated(b.id, b.updatedAt) - updated(a.id, a.updatedAt));
  }, [features.data, query, sort, byFeature]);

  if (!app.data) {
    return (
      <section className="page">
        <Breadcrumb />
        <QueryState isPending={app.isPending} error={app.error} notFound="Esta app no existe." />
      </section>
    );
  }

  return (
    <section className="page gallery-page">
      <Breadcrumb appName={app.data.name} />
      <header className="gallery-head">
        <h2>{app.data.name}</h2>
        <p className="gallery-lead">
          Cada feature es un objetivo del usuario con su propio lienzo.{' '}
          <Link to={catalogPath(appId)}>Catálogo de la app</Link>: APIs, servicios y bases de datos compartidos.
        </p>
        {/* Vista adicional (spec mapa-de-la-app): la galería sigue igual. */}
        <div className="gallery-head-actions">
          <Link className="pixel-button gallery-map-link" to={mapPath(appId)}>
            ◇ Ver mapa
          </Link>
          <button
            type="button"
            className="pixel-button is-ghost gallery-map-link"
            title="Todas las features, el catálogo y el mapa, para darle a una IA antes de construir"
            onClick={() => setAiContext(true)}
          >
            Contexto para IA
          </button>
          <button
            type="button"
            className="pixel-button is-ghost gallery-map-link"
            title="Reconstruir una feature desde un archivo .walkie exportado"
            onClick={() => setImporting(true)}
          >
            Importar feature
          </button>
        </div>
      </header>
      {aiContext && <AiContextDialog target={{ kind: 'app', id: appId }} onClose={() => setAiContext(false)} />}
      {importing && <ImportDialog appId={appId} onClose={() => setImporting(false)} />}
      <div className="gallery-create">
        <NameForm
          label="Nueva feature"
          submitLabel="Crear feature"
          pending={create.isPending}
          error={create.error}
          onSubmit={(name) => create.mutateAsync(name)}
        />
      </div>
      <QueryState isPending={features.isPending} error={features.error} notFound="Esta app no existe." />
      {features.data && features.data.length === 0 && (
        <div className="gallery-empty">
          <h3>Aún no hay features</h3>
          <p>
            Una feature documenta un flujo con un solo objetivo, por ejemplo “Iniciar sesión” o “Transferir”: sus
            pantallas, reglas y las APIs que usa. Crea la primera arriba.
          </p>
        </div>
      )}
      {features.data && features.data.length > 0 && (
        <>
          <GalleryTools label="Buscar features" query={query} onQuery={setQuery} sort={sort} onSort={setSort} />
          <ul className="card-grid feature-grid" aria-label="Features">
            {shown.map((feature) => (
              <FeatureCard
                key={feature.id}
                feature={feature}
                preview={byFeature.get(feature.id)}
                onSave={(changes) => update.mutateAsync({ featureId: feature.id, changes })}
              />
            ))}
          </ul>
          {shown.length === 0 && <p className="gallery-note">Ninguna feature coincide con “{query}”.</p>}
        </>
      )}
    </section>
  );
}

function Breadcrumb({ appName }: { appName?: string }) {
  return (
    <nav className="breadcrumb" aria-label="Ruta">
      <Link to="/apps">Apps</Link>
      {appName && <span> / {appName}</span>}
    </nav>
  );
}
