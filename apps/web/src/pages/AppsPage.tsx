import { Link } from 'react-router';
import { useApps, useCreateApp } from '../api/hooks';
import { NameForm } from '../ui/NameForm';
import { QueryState } from '../ui/QueryState';

export function AppsPage() {
  const apps = useApps();
  const create = useCreateApp();

  return (
    <section className="page">
      <h2>Apps</h2>
      <NameForm
        label="Nueva app"
        submitLabel="Crear app"
        pending={create.isPending}
        error={create.error}
        onSubmit={(name) => create.mutateAsync(name)}
      />
      <QueryState isPending={apps.isPending} error={apps.error} notFound="" />
      {apps.data && apps.data.length === 0 && <p>Aún no hay apps. Crea la primera.</p>}
      {apps.data && apps.data.length > 0 && (
        <ul className="item-list" aria-label="Apps">
          {apps.data.map((app) => (
            <li key={app.id}>
              <Link to={`/apps/${app.id}`}>{app.name}</Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
