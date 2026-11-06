import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthContextProps } from 'react-oidc-context';
import { AuthGate } from './AuthGate';

const auth = vi.hoisted(() => ({ current: {} as Partial<AuthContextProps> }));
vi.mock('react-oidc-context', () => ({ useAuth: () => auth.current }));

beforeEach(() => {
  auth.current = { isLoading: false, isAuthenticated: false, signinRedirect: vi.fn().mockResolvedValue(undefined) };
});

describe('AuthGate', () => {
  it('sin sesión muestra el botón y redirige al proveedor', async () => {
    render(<AuthGate>contenido privado</AuthGate>);

    expect(screen.queryByText('contenido privado')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
    expect(auth.current.signinRedirect).toHaveBeenCalledOnce();
  });

  it('con sesión muestra el contenido', () => {
    auth.current = { ...auth.current, isAuthenticated: true };
    render(<AuthGate>contenido privado</AuthGate>);

    expect(screen.getByText('contenido privado')).toBeInTheDocument();
  });

  it('muestra el error del proveedor', () => {
    auth.current = { ...auth.current, error: Object.assign(new Error('access_denied'), { source: 'signinCallback' as const }) };
    render(<AuthGate>contenido privado</AuthGate>);

    expect(screen.getByRole('alert')).toHaveTextContent('access_denied');
  });
});
