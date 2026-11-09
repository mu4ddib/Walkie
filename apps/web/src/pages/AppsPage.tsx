import { useState } from 'react';
import '../gallery/gallery.css';
import { Link } from 'react-router';
import { useApps, useCreateApp } from '../api/hooks';
import { GalleryTools } from '../gallery/GalleryTools';
import { matches } from '../gallery/search';
import { NameForm } from '../ui/NameForm';
import { QueryState } from '../ui/QueryState';
import { useStartWorkspace } from '../workspace/useStartWorkspace';
import { appPath } from '../workspace/paths';

/** Galería de apps (spec espacio-de-trabajo, criterios 8 y 9): tarjetas con su cantidad de features. */
export function AppsPage() {
  const apps = useApps();
  const create = useCreateApp();
  const { sample } = useStartWorkspace();
  const [query, setQuery] = useState('');
  const shown = (apps.data ?? []).filter((a) => matches(a.name, query));

  return (
    <section className="page gallery-page">
      <header className="gallery-head">
        <h2>Apps</h2>
        <p className="gallery-lead">Cada app es un producto que documentas: reúne sus features y un catálogo compartido.</p>
      </header>
      <div className="gallery-create">
        <NameForm
          label="Nueva app"
          submitLabel="Crear app"
          pending={create.isPending}
          error={create.error}
          onSubmit={(name) => create.mutateAsync(name)}
        />
      </div>
      <QueryState isPending={apps.isPending} error={apps.error} notFound="" />
      {apps.data && apps.data.length === 0 && (
        <div className="gallery-empty">
          <h3>Aún no hay apps</h3>
          <p>
            Una app agrupa los flujos de un producto, por ejemplo la banca móvil. Créala arriba o carga el ejemplo para
            ver un lienzo ya armado.
          </p>
          <button
            type="button"
            className="pixel-button"
            disabled={sample.isPending}
            onClick={() => sample.mutate()}
          >
            Cargar el ejemplo
          </button>
          {sample.isError && <p role="alert">No se pudo crear el ejemplo.</p>}
        </div>
      )}
      {apps.data && apps.data.length > 0 && (
        <>
          <GalleryTools label="Buscar apps" query={query} onQuery={setQuery} />
          <ul className="card-grid app-grid" aria-label="Apps">
            {shown.map((app) => (
              <li key={app.id} className="app-card">
                <h3 className="app-card-title">
                  <Link to={appPath(app.id)}>{app.name}</Link>
                </h3>
                <p className="app-card-meta">
                  {app.featureCount === 1 ? '1 feature' : `${app.featureCount} features`}
                </p>
              </li>
            ))}
          </ul>
          {shown.length === 0 && <p className="gallery-note">Ninguna app coincide con “{query}”.</p>}
        </>
      )}
    </section>
  );
}
