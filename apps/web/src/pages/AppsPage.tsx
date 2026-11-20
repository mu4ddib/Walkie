import { useState } from 'react';
import '../gallery/gallery.css';
import { Link, useLocation } from 'react-router';
import type { DeletedAppNotice } from '../deletion/DeleteAppDialog';
import { PendingDeletion } from '../deletion/PendingDeletion';
import { useApps, useCreateApp, useDiscoveryStatus } from '../api/hooks';
import { NewAppFromProjectDialog } from '../discovery/NewAppFromProjectDialog';
import { GalleryTools } from '../gallery/GalleryTools';
import { matches } from '../gallery/search';
import { NameForm } from '../ui/NameForm';
import { QueryState } from '../ui/QueryState';
import { useStartWorkspace } from '../workspace/useStartWorkspace';
import { appPath } from '../workspace/paths';
import { ImportDialog } from '../gallery/ImportDialog';

/** Galería de apps (spec espacio-de-trabajo, criterios 8 y 9): tarjetas con su cantidad de features. */
export function AppsPage() {
  const apps = useApps();
  const create = useCreateApp();
  const { sample } = useStartWorkspace();
  const [query, setQuery] = useState('');
  // «Importar app» desde el .walkie de una app (spec exportar-e-importar, tarea 7).
  const [importing, setImporting] = useState(false);
  // «Crear app desde proyecto local» (spec walkie-live, tarea 10): solo si Walkie Live está encendido en la API.
  const discovery = useDiscoveryStatus();
  const [fromProject, setFromProject] = useState(false);
  const shown = (apps.data ?? []).filter((a) => matches(a.name, query));
  // Al volver de eliminar una app (ADR-0017): qué se eliminó y si Walkie termina de borrarla en segundo plano.
  const state = useLocation().state as Partial<DeletedAppNotice> | null;
  const deleted = state?.deletedApp ? state : null;

  return (
    <section className="page gallery-page">
      <header className="gallery-head">
        <h2>Apps</h2>
        <p className="gallery-lead">
          Cada app es un producto que documentas: reúne sus features y un catálogo compartido.
        </p>
        <div className="gallery-head-actions">
          <button
            type="button"
            className="pixel-button is-ghost gallery-map-link"
            title="Crear una app desde el archivo .walkie de otra (features, catálogo, imágenes y mapa)"
            onClick={() => setImporting(true)}
          >
            Importar app
          </button>
          {discovery.data?.enabled && (
            <button
              type="button"
              className="pixel-button is-ghost gallery-map-link"
              title="Crear una app nueva desde el análisis (.walkiepack) de un proyecto en tu computador, para revisar qué sumar"
              onClick={() => setFromProject(true)}
            >
              Crear app desde proyecto local
            </button>
          )}
        </div>
      </header>
      {deleted &&
        (deleted.pending && deleted.deletionId ? (
          <PendingDeletion deletionId={deleted.deletionId} name={deleted.deletedApp!} kind="app" />
        ) : (
          <p className="gallery-note" role="status">
            {deleted.pending
              ? `La eliminación de la app «${deleted.deletedApp}» todavía está pendiente: ya no está disponible para nadie y Walkie la termina solo.`
              : `Se eliminó la app «${deleted.deletedApp}» con toda su documentación.`}
          </p>
        ))}
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
      {fromProject && <NewAppFromProjectDialog onClose={() => setFromProject(false)} />}
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
          <button type="button" className="pixel-button" disabled={sample.isPending} onClick={() => sample.mutate()}>
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
                <p className="app-card-meta">{app.featureCount === 1 ? '1 feature' : `${app.featureCount} features`}</p>
              </li>
            ))}
          </ul>
          {shown.length === 0 && <p className="gallery-note">Ninguna app coincide con “{query}”.</p>}
        </>
      )}
    </section>
  );
}
