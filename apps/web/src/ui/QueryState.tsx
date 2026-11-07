import { ApiError } from '../api/client';

/** Mensaje de carga o error de una consulta; `null` si hay datos. */
export function QueryState({ isPending, error, notFound }: { isPending: boolean; error: unknown; notFound: string }) {
  if (isPending) return <p>Cargando…</p>;
  if (error instanceof ApiError && error.status === 404) return <p role="alert">{notFound}</p>;
  if (error) return <p role="alert">No se pudo cargar. Revisa la conexión con la API.</p>;
  return null;
}
