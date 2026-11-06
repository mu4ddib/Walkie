import { useQuery } from '@tanstack/react-query';
import { getHealth } from './client';

export function ApiStatus() {
  const { data, isPending, isError } = useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => getHealth(signal),
    retry: false,
  });

  const label = isPending ? 'API…' : isError ? 'API sin conexión' : `API ${data.status}`;
  const state = isPending ? 'pending' : isError ? 'error' : 'ok';

  return (
    <span className="api-status" data-state={state} role="status">
      {label}
    </span>
  );
}
