import { describe, expect, it } from 'vitest';
import type { ModuleSummary } from '../api/client';
import { resolveInterface } from '../catalog/catalogContext';
import { featurePath, moduleEntryPath, modulePath, readModuleEntry, returnPath, trailOf } from '../workspace/paths';
import { interfaceHandle, interfaceOfHandle, resolvedUses } from './moduleMeta';

const summary: ModuleSummary = {
  id: 'm',
  appId: 'app',
  name: 'Usuarios',
  version: 3,
  interfaces: [
    { id: 'new', name: 'Alta', kind: 'provides', nodeId: 'a', method: 'POST', path: '/usuarios' },
    { id: 'get', name: 'Consulta', kind: 'provides', nodeId: 'b' },
  ],
  redirects: [{ from: 'old', to: 'new' }, { from: 'gone' }],
  modules: [],
  usedBy: [],
};

describe('interfaces resueltas con las redirecciones del módulo', () => {
  it('una quitada se ve como la que la reemplaza, el módulo completo o pendiente', () => {
    expect(resolveInterface(summary, { id: 'new', name: 'x' })).toMatchObject({ status: 'ok', iface: { name: 'Alta' } });
    expect(resolveInterface(summary, { id: 'old', name: 'Alta vieja' })).toMatchObject({
      status: 'ok',
      iface: { id: 'new' },
      redirectedFrom: 'Alta vieja',
    });
    expect(resolveInterface(summary, { id: 'gone', name: 'Baja' })).toEqual({ status: 'whole', redirectedFrom: 'Baja' });
    expect(resolveInterface(summary, { id: 'nada', name: 'Borrar' })).toEqual({ status: 'pending', name: 'Borrar' });
    expect(resolveInterface(summary, undefined)).toEqual({ status: 'whole' });
  });

  it('la caja lista cada interfaz una vez, sin las del módulo completo y con las pendientes al final', () => {
    const used = ['{"id":"nada","name":"Borrar"}', '{"id":"old","name":"Alta vieja"}', '{"id":"new","name":"Alta"}', '{"id":"gone","name":"Baja"}'];
    expect(resolvedUses(summary, used.join('\n')).map((u) => ('iface' in u ? u.iface.name : `⚠ ${u.pending}`))).toEqual([
      'Alta',
      '⚠ Borrar',
    ]);
  });

  it('el punto de conexión de una interfaz se reconoce en ambos sentidos', () => {
    expect(interfaceOfHandle(interfaceHandle('new'))).toBe('new');
    expect(interfaceOfHandle(interfaceHandle('new', true))).toBe('new');
    expect(interfaceOfHandle('top')).toBeNull();
  });
});

describe('volver por cada nivel de módulos anidados', () => {
  it('de un módulo dentro de otro vuelve al primero con su propia entrada, y de ahí a la feature', () => {
    // Feature f → módulo A (caja nA, desde el paso 2 de «Alta») → módulo B (caja nB).
    const intoA = { from: 'f', node: 'nA', returnTour: 'alta', returnStep: 2 };
    const urlA = new URL(moduleEntryPath('app', 'A', intoA), 'http://x');
    const intoB = { from: 'A', node: 'nB', trail: trailOf(readModuleEntry(urlA.searchParams)) };
    const urlB = new URL(moduleEntryPath('app', 'B', intoB), 'http://x');

    const backToA = new URL(returnPath('app', readModuleEntry(urlB.searchParams), true)!, 'http://x');
    expect(backToA.pathname).toBe(modulePath('app', 'A'));
    const entryA = readModuleEntry(backToA.searchParams);
    expect(entryA).toMatchObject({ from: 'f', node: 'nA', select: 'nB', keep: true, returnTour: 'alta', returnStep: 2 });

    const backToF = new URL(returnPath('app', entryA, false)!, 'http://x');
    expect(backToF.pathname).toBe(featurePath('app', 'f'));
    expect(Object.fromEntries(backToF.searchParams)).toEqual({ select: 'nA', keep: '1', play: 'alta', step: '2' });
  });

  it('un rastro mal formado se ignora', () => {
    expect(readModuleEntry(new URLSearchParams('from=f&trail=%7Bmal')).trail).toBeUndefined();
  });
});
