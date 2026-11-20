import { useMemo, useState } from 'react';
import '../gallery/gallery.css';
import { Link, useParams } from 'react-router';
import {
  useApp,
  useCanvasPreviews,
  useCreateFeature,
  useDiscoverySources,
  useExportAppPackage,
  useFeatures,
  useAppRole,
  useUpdateFeature,
} from '../api/hooks';
import { saveFile } from '../ui/download';
import { FeatureCard } from '../gallery/FeatureCard';
import { GalleryTools } from '../gallery/GalleryTools';
import { matches, type FeatureSort } from '../gallery/search';
import { latest } from '../gallery/dates';
import { NameForm } from '../ui/NameForm';
import { catalogPath } from './catalogPaths';
import { mapPath } from '../workspace/paths';
import { APP_NO_ACCESS, QueryState } from '../ui/QueryState';
import { AiContextDialog } from '../canvas/AiContextDialog';
import { ImportDialog } from '../gallery/ImportDialog';
import { LocalImportDialog } from '../discovery/LocalImportDialog';
import { SourcesSection } from '../discovery/SourcesSection';
import { MembersDialog } from '../apps/MembersDialog';
import { DeleteAppDialog } from '../deletion/DeleteAppDialog';
import { DeleteFeatureDialog } from '../deletion/DeleteFeatureDialog';

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
  // «Exportar app (.walkie)»: la app completa para reconstruirla con «Importar app» (spec exportar-e-importar, tarea 7).
  const exportApp = useExportAppPackage(appId);
  // Walkie Live (spec walkie-live, tarea 5): solo si la API responde las fuentes. Con Discovery apagado (404) no se
  // muestra nada que parezca funcionar.
  const sources = useDiscoverySources(appId);
  const [importingLocal, setImportingLocal] = useState(false);
  // Mi rol (ADR-0015): un viewer no crea, edita ni importa; «Miembros» lo ven todos y lo administra el owner.
  const { canEdit, isOwner } = useAppRole(appId);
  const [members, setMembers] = useState(false);
  // Eliminar (ADR-0017, solo el owner): la feature elegida, el aviso de lo eliminado y el diálogo de la app.
  const [deletingFeature, setDeletingFeature] = useState<string | null>(null);
  const [deletedNotice, setDeletedNotice] = useState<string | null>(null);
  const [deletingApp, setDeletingApp] = useState(false);

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
        <QueryState isPending={app.isPending} error={app.error} notFound={APP_NO_ACCESS} />
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
          {canEdit && (
            <button
              type="button"
              className="pixel-button is-ghost gallery-map-link"
              title="Reconstruir una feature desde un archivo .walkie exportado"
              onClick={() => setImporting(true)}
            >
              Importar feature
            </button>
          )}
          {sources.data && canEdit && (
            <button
              type="button"
              className="pixel-button is-ghost gallery-map-link"
              title="Analizar el código de un proyecto con «walkie scan» y revisar lo descubierto"
              onClick={() => setImportingLocal(true)}
            >
              Importar proyecto local
            </button>
          )}
          <button
            type="button"
            className="pixel-button is-ghost gallery-map-link"
            title="Todas las features, el catálogo, las imágenes y el mapa en un archivo para reconstruir la app"
            disabled={exportApp.isPending}
            onClick={() => exportApp.mutate(undefined, { onSuccess: (file) => saveFile(file.blob, file.fileName) })}
          >
            {exportApp.isPending ? 'Exportando…' : 'Exportar app (.walkie)'}
          </button>
          <button
            type="button"
            className="pixel-button is-ghost gallery-map-link"
            title={isOwner ? 'Quién ve y edita esta app' : 'Quién ve esta app'}
            onClick={() => setMembers(true)}
          >
            Miembros
          </button>
        </div>
        {exportApp.isError && (
          <p role="alert" className="save-error">
            No se pudo exportar la app. Vuelve a intentarlo.
          </p>
        )}
      </header>
      {aiContext && <AiContextDialog target={{ kind: 'app', id: appId }} onClose={() => setAiContext(false)} />}
      {importing && <ImportDialog appId={appId} onClose={() => setImporting(false)} />}
      {importingLocal && <LocalImportDialog appId={appId} onClose={() => setImportingLocal(false)} />}
      {members && <MembersDialog appId={appId} onClose={() => setMembers(false)} />}
      {deletingFeature && (
        <DeleteFeatureDialog
          appId={appId}
          featureId={deletingFeature}
          onClose={() => setDeletingFeature(null)}
          onDeleted={(name, result) => {
            setDeletingFeature(null);
            setDeletedNotice(
              result.status === 'completed'
                ? `Se eliminó «${name}».`
                : `«${name}» ya no está disponible; Walkie termina de borrar sus datos en segundo plano.`,
            );
          }}
        />
      )}
      {deletingApp && <DeleteAppDialog appId={appId} onClose={() => setDeletingApp(false)} />}
      {deletedNotice && (
        <p className="gallery-note" role="status">
          {deletedNotice}
        </p>
      )}
      {canEdit ? (
        <div className="gallery-create">
          <NameForm
            label="Nueva feature"
            submitLabel="Crear feature"
            pending={create.isPending}
            error={create.error}
            onSubmit={(name) => create.mutateAsync(name)}
          />
        </div>
      ) : (
        app.data.role && (
          <p className="gallery-note" role="note">
            Tu rol en esta app es «viewer»: puedes ver y exportar, no cambiar.
          </p>
        )
      )}
      <QueryState isPending={features.isPending} error={features.error} notFound={APP_NO_ACCESS} />
      {features.data && features.data.length === 0 && (
        <div className="gallery-empty">
          <h3>Aún no hay features</h3>
          <p>
            Una feature documenta un flujo con un solo objetivo, por ejemplo “Iniciar sesión” o “Transferir”: sus
            pantallas, reglas y las APIs que usa.{canEdit && ' Crea la primera arriba.'}
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
                onSave={canEdit ? (changes) => update.mutateAsync({ featureId: feature.id, changes }) : undefined}
                onDelete={
                  isOwner
                    ? () => {
                        setDeletedNotice(null);
                        setDeletingFeature(feature.id);
                      }
                    : undefined
                }
              />
            ))}
          </ul>
          {shown.length === 0 && <p className="gallery-note">Ninguna feature coincide con “{query}”.</p>}
        </>
      )}
      {sources.data && <SourcesSection sources={sources.data} onImport={canEdit ? () => setImportingLocal(true) : undefined} />}
      {isOwner && (
        <section className="gallery-admin" aria-labelledby="app-admin-title">
          <h3 id="app-admin-title">Administración</h3>
          <p className="gallery-note">
            Eliminar la app borra para siempre sus features, módulos, catálogo, imágenes, enlaces y análisis de Walkie Live, para todos
            sus miembros.
          </p>
          <button type="button" className="pixel-button is-danger" onClick={() => setDeletingApp(true)}>
            Eliminar app…
          </button>
        </section>
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
