import { Link, useParams } from 'react-router';
import { useApp, useCreateFeature, useFeatures } from '../api/hooks';
import { NameForm } from '../ui/NameForm';
import { QueryState } from '../ui/QueryState';

export function AppPage() {
  const { appId = '' } = useParams();
  const app = useApp(appId);
  const features = useFeatures(appId);
  const create = useCreateFeature(appId);

  if (!app.data) {
    return (
      <section className="page">
        <Breadcrumb />
        <QueryState isPending={app.isPending} error={app.error} notFound="Esta app no existe." />
      </section>
    );
  }

  return (
    <section className="page">
      <Breadcrumb appName={app.data.name} />
      <h2>{app.data.name}</h2>
      <NameForm
        label="Nueva feature"
        submitLabel="Crear feature"
        pending={create.isPending}
        error={create.error}
        onSubmit={(name) => create.mutateAsync(name)}
      />
      <QueryState isPending={features.isPending} error={features.error} notFound="Esta app no existe." />
      {features.data && features.data.length === 0 && <p>Aún no hay features. Crea la primera.</p>}
      {features.data && features.data.length > 0 && (
        <ul className="item-list" aria-label="Features">
          {features.data.map((feature) => (
            <li key={feature.id}>
              <Link to={`/apps/${appId}/features/${feature.id}`}>{feature.name}</Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Breadcrumb({ appName }: { appName?: string }) {
  return (
    <nav className="breadcrumb" aria-label="Ruta">
      <Link to="/">Apps</Link>
      {appName && <span> / {appName}</span>}
    </nav>
  );
}
