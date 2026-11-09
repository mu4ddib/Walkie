import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  forgetLastWorkspace,
  getEdgeMotion,
  getInspectorOpen,
  getLastWorkspace,
  getSavedViewport,
  saveViewport,
  setEdgeMotion,
  setInspectorOpen,
  setLastWorkspace,
} from './session';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('sesión del espacio de trabajo', () => {
  it('recuerda y olvida la última app y feature', () => {
    expect(getLastWorkspace()).toBeNull();
    setLastWorkspace({ appId: 'a', featureId: 'f' });
    expect(getLastWorkspace()).toEqual({ appId: 'a', featureId: 'f' });
    forgetLastWorkspace();
    expect(getLastWorkspace()).toBeNull();
  });

  it('guarda la vista por feature y descarta valores inválidos', () => {
    saveViewport('f1', { x: 10, y: -20, zoom: 1.5 });
    expect(getSavedViewport('f1')).toEqual({ x: 10, y: -20, zoom: 1.5 });
    expect(getSavedViewport('f2')).toBeNull();
    localStorage.setItem('walkie.viewport.f3', '{"x":1,"y":2,"zoom":0}');
    localStorage.setItem('walkie.viewport.f4', 'no es json');
    expect(getSavedViewport('f3')).toBeNull();
    expect(getSavedViewport('f4')).toBeNull();
  });

  it('el inspector empieza abierto y recuerda si se plegó', () => {
    expect(getInspectorOpen()).toBe(true);
    setInspectorOpen(false);
    expect(getInspectorOpen()).toBe(false);
  });

  it('la animación de las conexiones empieza encendida y recuerda si se apagó', () => {
    expect(getEdgeMotion()).toBe(true);
    setEdgeMotion(false);
    expect(getEdgeMotion()).toBe(false);
  });

  it('sin almacenamiento disponible no falla', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    expect(() => setLastWorkspace({ appId: 'a', featureId: 'f' })).not.toThrow();
    expect(getLastWorkspace()).toBeNull();
    expect(getInspectorOpen()).toBe(true);
  });
});
