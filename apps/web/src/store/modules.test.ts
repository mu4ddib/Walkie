import { describe, expect, it } from 'vitest';
import { createGraphStore, toGraph } from './graphStore';

/** Módulos compartidos en el store (spec modulos-compartidos): cajas, interfaces y conexiones a ellas. */
function setup() {
  let n = 0;
  const store = createGraphStore(() => `id-${++n}`);
  const s = () => store.getState();
  return { store, s };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('caja de un módulo', () => {
  it('se agrega con su id y su nombre, guarda su presentación y su ancho', () => {
    const { s } = setup();
    const id = s().addModuleRef({ id: 'mod-1', name: 'Usuarios' }, { x: 13, y: 22 });
    expect(s().nodes[id]).toEqual({ id, type: 'module', title: 'Usuarios', moduleId: 'mod-1' });
    expect(s().layout[id]).toEqual({ x: 16, y: 24 });

    s().setModuleDisplay(id, { description: false });
    expect(s().nodes[id]!.display).toEqual({ description: false });
    // Mostrar es lo de siempre: no se guarda nada.
    s().setModuleDisplay(id, { description: true });
    expect(s().nodes[id]!.display).toBeUndefined();

    s().resizeNode(id, { w: 301 });
    expect(s().layout[id]).toEqual({ x: 16, y: 24, w: 304 });
  });

  it('duplicar la caja sigue apuntando al mismo módulo', () => {
    const { s } = setup();
    const id = s().addModuleRef({ id: 'mod-1', name: 'Usuarios' }, { x: 0, y: 0 });
    const copy = s().duplicateNode(id)!;
    expect(s().nodes[copy]).toMatchObject({ type: 'module', moduleId: 'mod-1' });
  });

  it('una conexión apunta a una interfaz solo en el extremo que es un módulo; la respuesta sale de la misma', () => {
    const { s } = setup();
    const screen = s().addNode('screen', { x: 0, y: 0 });
    const mod = s().addModuleRef({ id: 'mod-1', name: 'Usuarios' }, { x: 300, y: 0 });
    const iface = { id: 'i-post', name: 'Crear usuario' };
    const request = s().connect(screen, mod, 'request', { toInterface: iface, fromInterface: iface })!;
    expect(s().edges[request]!.toInterface).toEqual(iface);
    expect(s().edges[request]!.fromInterface).toBeUndefined();

    const response = s().addResponse(request, { status: 201 })!;
    expect(s().edges[response]).toMatchObject({ from: mod, to: screen, replyTo: request, fromInterface: iface });
    expect(s().edges[response]!.toInterface).toBeUndefined();

    // Al invertir, la interfaz cambia de extremo con la caja.
    s().updateEdge(request, { reverse: true });
    expect(s().edges[request]).toMatchObject({ from: mod, fromInterface: iface });
    expect(s().edges[request]!.toInterface).toBeUndefined();

    // Precisar después (o volver al módulo completo).
    s().updateEdge(response, { fromInterface: null });
    expect(s().edges[response]!.fromInterface).toBeUndefined();
  });

  it('apuntar la caja a otro módulo pasa sus conexiones al módulo completo, salvo una copia con las mismas interfaces', () => {
    const { s } = setup();
    const screen = s().addNode('screen', { x: 0, y: 0 });
    const mod = s().addModuleRef({ id: 'mod-1', name: 'Usuarios' }, { x: 300, y: 0 });
    const edge = s().connect(screen, mod, 'request', { toInterface: { id: 'i1', name: 'Alta' } })!;

    s().relinkModule(mod, { id: 'mod-copy', name: 'Usuarios (copia)' }, { keepInterfaces: true });
    expect(s().nodes[mod]).toMatchObject({ moduleId: 'mod-copy', title: 'Usuarios (copia)' });
    expect(s().edges[edge]!.toInterface).toEqual({ id: 'i1', name: 'Alta' });

    s().relinkModule(mod, { id: 'mod-2', name: 'Cuentas' });
    expect(s().edges[edge]!.toInterface).toBeUndefined();
  });
});

describe('interfaces del lienzo de un módulo', () => {
  it('se agregan con nombre único, se renombran y van al grafo', () => {
    const { s } = setup();
    const api = s().addNode('api', { x: 0, y: 0 });
    const first = s().addInterface({ name: ' Crear usuario ', kind: 'provides', nodeId: api })!;
    expect(s().interfaces[first]).toEqual({ id: first, name: 'Crear usuario', kind: 'provides', nodeId: api });
    expect(s().addInterface({ name: 'crear USUARIO', kind: 'event', nodeId: api })).toBeNull();
    expect(s().addInterface({ name: 'Otra', kind: 'provides', nodeId: 'nada' })).toBeNull();

    s().updateInterface(first, { name: 'Alta de usuario', description: 'Registra la cuenta', kind: 'event' });
    expect(s().interfaces[first]).toMatchObject({ name: 'Alta de usuario', description: 'Registra la cuenta', kind: 'event' });
    expect(toGraph(s()).interfaces).toEqual(s().interfaces);
  });

  it('el recorrido interno se vincula y se suelta si el recorrido desaparece', () => {
    const { s } = setup();
    const api = s().addNode('api', { x: 0, y: 0 });
    const tour = s().addTour('Por dentro', 'flow')!;
    const id = s().addInterface({ name: 'Alta', kind: 'provides', nodeId: api, tourId: tour })!;
    expect(s().interfaces[id]!.tourId).toBe(tour);
    s().removeTour(tour);
    expect(s().interfaces[id]!.tourId).toBeUndefined();
  });

  it('borrar la caja quita sus interfaces y Ctrl+Z las recupera; sin interfaces el grafo no lleva el campo', async () => {
    const { s } = setup();
    const api = s().addNode('api', { x: 0, y: 0 });
    s().addInterface({ name: 'Alta', kind: 'provides', nodeId: api });
    await tick();
    s().removeNode(api);
    expect(s().interfaces).toEqual({});
    expect(toGraph(s()).interfaces).toBeUndefined();
    await tick();
    s().undo();
    expect(Object.values(s().interfaces).map((i) => i.name)).toEqual(['Alta']);
  });

  it('cargar y guardar conserva las interfaces; marcar guardado las incluye', () => {
    const { s } = setup();
    s().loadGraph({
      schemaVersion: 0,
      version: 3,
      nodes: { a: { id: 'a', type: 'api', title: 'A' } },
      edges: {},
      layout: { a: { x: 0, y: 0 } },
      interfaces: { i: { id: 'i', name: 'A', kind: 'provides', nodeId: 'a' } },
    });
    expect(s().dirty).toBe(false);
    const sent = s();
    s().updateInterface('i', { name: 'B' });
    s().markSaved(4, sent);
    // Cambió durante el guardado: sigue pendiente.
    expect(s().dirty).toBe(true);
  });
});

describe('reemplazar el grafo (convertir en módulo)', () => {
  it('es un solo paso del historial: deshacer devuelve lo de antes', async () => {
    const { s } = setup();
    const a = s().addNode('api', { x: 0, y: 0 });
    s().markSaved(1, s());
    await tick();
    s().replaceGraph({
      schemaVersion: 0,
      version: 2,
      nodes: { m: { id: 'm', type: 'module', title: 'Usuarios', moduleId: 'mod-1' } },
      edges: {},
      layout: { m: { x: 0, y: 0 } },
    });
    s().markSaved(2, s());
    expect(s().dirty).toBe(false);
    expect(Object.keys(s().nodes)).toEqual(['m']);
    await tick();
    s().undo();
    expect(Object.keys(s().nodes)).toEqual([a]);
    expect(s().dirty).toBe(true);
    s().redo();
    expect(s().dirty).toBe(false);
  });
});
