import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthContextProps } from 'react-oidc-context';
import { AuthGate } from './AuthGate';

const auth = vi.hoisted(() => ({ current: {} as Partial<AuthContextProps> }));
vi.mock('react-oidc-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-oidc-context')>()),
  useAuth: () => auth.current,
}));

/** La URL a la que vuelve el proveedor, antes de que `onSigninCallback` la cambie. */
const CALLBACK = '/?state=abc&session_state=s&code=xyz';

function renderGate(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthGate>contenido privado</AuthGate>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  auth.current = { isLoading: false, isAuthenticated: false, signinRedirect: vi.fn().mockResolvedValue(undefined) };
});

describe('AuthGate', () => {
  it('sin sesión muestra el botón y redirige al proveedor', async () => {
    renderGate();

    expect(screen.queryByText('contenido privado')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
    expect(auth.current.signinRedirect).toHaveBeenCalledWith({ state: { returnTo: '/' } });
  });

  it('con sesión muestra el contenido', () => {
    auth.current = { ...auth.current, isAuthenticated: true };
    renderGate();

    expect(screen.getByText('contenido privado')).toBeInTheDocument();
  });

  it('muestra el error del proveedor', () => {
    auth.current = { ...auth.current, error: Object.assign(new Error('access_denied'), { source: 'signinCallback' as const }) };
    renderGate();

    expect(screen.getByRole('alert')).toHaveTextContent('access_denied');
  });

  it('con sesión, espera a que el router deje la URL de vuelta del proveedor (code y state)', () => {
    auth.current = { ...auth.current, isAuthenticated: true };
    renderGate(CALLBACK);

    expect(screen.getByText('Cargando…')).toBeInTheDocument();
    expect(screen.queryByText('contenido privado')).not.toBeInTheDocument();
  });

  it('si el proveedor falla con la URL de vuelta, muestra el error en vez de quedarse en «Cargando…»', () => {
    auth.current = { ...auth.current, error: Object.assign(new Error('invalid_grant'), { source: 'signinCallback' as const }) };
    renderGate(CALLBACK);

    expect(screen.getByRole('alert')).toHaveTextContent('invalid_grant');
  });
});
