import { ApiError } from '../api/client';

/** 404 de una app (ADR-0015): la API responde igual si no existe o si no soy miembro. */
export const APP_NO_ACCESS = 'No tienes acceso a esta app (o ya no existe).';

/** Mensaje de carga o error de una consulta; `null` si hay datos. Un 403 dice el motivo que da la API. */
export function QueryState({ isPending, error, notFound }: { isPending: boolean; error: unknown; notFound: string }) {
  if (isPending) return <p>Cargando…</p>;
  if (error instanceof ApiError && error.status === 404) return <p role="alert">{notFound}</p>;
  if (error instanceof ApiError && error.status === 403) return <p role="alert">{error.userMessage}</p>;
  if (error) return <p role="alert">No se pudo cargar. Revisa la conexión con la API.</p>;
  return null;
}
