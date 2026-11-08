import { useQuery } from '@tanstack/react-query';
import { getHealth } from './client';

/** Estado de la API. `compact` (barra del editor) solo aparece si algo falla: un punto verde no informa nada. */
export function ApiStatus({ compact = false }: { compact?: boolean }) {
  const { data, isPending, isError } = useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => getHealth(signal),
    retry: false,
  });

  const label = isPending ? 'API…' : isError ? 'API sin conexión' : `API ${data.status}`;
  const state = isPending ? 'pending' : isError ? 'error' : 'ok';

  if (compact && state !== 'error') return null;

  return (
    <span className="api-status" data-state={state} role="status">
      {label}
    </span>
  );
}
