import { useAuth } from 'react-oidc-context';
import { useQuery } from '@tanstack/react-query';
import { getMe } from '../api/client';

export function UserMenu() {
  const auth = useAuth();
  const token = auth.user?.access_token;
  // El nombre viene de la API (/api/me) para confirmar que el token es válido de punta a punta.
  const { data: me } = useQuery({
    queryKey: ['me', auth.user?.profile.sub],
    queryFn: ({ signal }) => getMe(token!, signal),
    enabled: !!token,
  });

  return (
    <span className="user-menu">
      <span>{me?.name ?? auth.user?.profile.preferred_username}</span>
      <button type="button" className="pixel-button" onClick={() => void auth.signoutRedirect()}>
        Salir
      </button>
    </span>
  );
}
