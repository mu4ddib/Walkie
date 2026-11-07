import { afterEach, describe, expect, it } from 'vitest';
import type { User } from 'oidc-client-ts';
import { currentPath, onSigninCallback, safeReturnTo } from './config';

afterEach(() => window.history.replaceState({}, '', '/'));

describe('volver a la página de origen tras el login', () => {
  it('currentPath guarda ruta, query y hash', () => {
    window.history.replaceState({}, '', '/apps/a1/features/f1?x=1#n');

    expect(currentPath()).toEqual({ returnTo: '/apps/a1/features/f1?x=1#n' });
  });

  it.each([
    [{ returnTo: '/apps/a1' }, '/apps/a1'],
    [{ returnTo: '//evil.example' }, '/'],
    [{ returnTo: 'https://evil.example' }, '/'],
    [undefined, '/'],
    ['texto', '/'],
  ])('safeReturnTo(%j) → %s', (state, expected) => {
    expect(safeReturnTo(state)).toBe(expected);
  });

  it('onSigninCallback limpia el código de la URL y navega al origen', () => {
    window.history.replaceState({}, '', '/?code=abc&state=xyz');
    let popped = false;
    window.addEventListener('popstate', () => (popped = true), { once: true });

    onSigninCallback({ state: { returnTo: '/apps/a1/features/f1' } } as unknown as User);

    expect(window.location.pathname + window.location.search).toBe('/apps/a1/features/f1');
    expect(popped).toBe(true);
  });
});
