import { beforeEach, describe, expect, it } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';
import { createGraphStore, defaultEdgeKind, toGraph, type GraphStore } from './graphStore';
import { normalizeResource, resourceEdgeKind, resourceLabel } from '../nodes/resourceMeta';
import { nodeLabel } from '../nodes/nodeMeta';

let store: StoreApi<GraphStore>;
const s = () => store.getState();
const at = { x: 0, y: 0 };

beforeEach(() => {
  store = createGraphStore();
});

describe('recursos de infraestructura (spec nodos-de-infraestructura)', () => {
  it('crea un recurso con su subtipo y el título del subtipo; el grafo recarga idéntico', () => {
    const id = s().addResource('queue', { x: 13, y: 7 });
    expect(s().nodes[id]).toEqual({ id, type: 'resource', title: 'Cola', resource: { kind: 'queue' } });
    expect(s().layout[id]).toEqual({ x: 16, y: 8 });
    expect(s().dirty).toBe(true);

    const graph = toGraph(s());
    const other = createGraphStore();
    other.getState().loadGraph(graph);
    expect(toGraph(other.getState()).nodes).toEqual(graph.nodes);
  });

  it('uno personalizado lleva su nombre (o «Recurso»); addNode("resource") crea uno personalizado válido', () => {
    const custom = s().addResource('custom', at, '  Step Functions  ');
    expect(s().nodes[custom]).toMatchObject({ title: 'Step Functions', resource: { kind: 'custom', label: 'Step Functions' } });
    const bare = s().addNode('resource', at);
    expect(s().nodes[bare]!.resource).toEqual({ kind: 'custom', label: 'Recurso' });
  });

  it('cambiar el subtipo conserva título, conexiones y detalles; a personalizado se queda con el nombre anterior', () => {
    const api = s().addNode('api', at);
    const id = s().addResource('storage', at);
    s().renameNode(id, 'Comprobantes');
    const edge = s().connect(api, id)!;
    s().setResource(id, { provider: 'aws', name: 'comprobantes-prod', details: [{ key: 'clase', value: 'estándar' }] });

    s().setResource(id, { kind: 'cache' });
    expect(s().nodes[id]).toMatchObject({
      title: 'Comprobantes',
      resource: { kind: 'cache', provider: 'aws', name: 'comprobantes-prod', details: [{ key: 'clase', value: 'estándar' }] },
    });
    expect(s().edges[edge]).toBeDefined();

    s().setResource(id, { kind: 'custom' });
    expect(s().nodes[id]!.resource).toMatchObject({ kind: 'custom', label: 'Caché' });
    // Al dejar de ser personalizado, el nombre del subtipo se quita.
    s().setResource(id, { kind: 'queue' });
    expect(s().nodes[id]!.resource!.label).toBeUndefined();
  });

  it('normaliza: recorta, quita vacíos y detalles sin clave, respeta los límites; sin cambios no marca dirty', () => {
    const id = s().addResource('function', at);
    s().setResource(id, {
      name: '   ',
      details: [
        { key: ' runtime ', value: ' node20 ' },
        { key: '  ', value: 'sin clave' },
        { key: 'k'.repeat(60), value: 'v'.repeat(300) },
      ],
    });
    const resource = s().nodes[id]!.resource!;
    expect(resource.name).toBeUndefined();
    expect(resource.details).toEqual([
      { key: 'runtime', value: 'node20' },
      { key: 'k'.repeat(40), value: 'v'.repeat(200) },
    ]);
    s().markSaved(1);
    s().setResource(id, { details: [{ key: 'runtime', value: 'node20' }, { key: 'k'.repeat(40), value: 'v'.repeat(200) }] });
    expect(s().dirty).toBe(false);
    expect(normalizeResource({ kind: 'custom', label: '' })).toEqual({ kind: 'custom', label: 'Recurso' });
  });

  it('setResource solo en recursos; setRuntime solo en servicios', () => {
    const api = s().addNode('api', at);
    s().setResource(api, { kind: 'queue' });
    expect(s().nodes[api]!.resource).toBeUndefined();

    const service = s().addNode('service', at);
    s().setRuntime(service, 'container');
    expect(s().nodes[service]!.runtime).toBe('container');
    s().setRuntime(service, undefined);
    expect('runtime' in s().nodes[service]!).toBe(false);
    s().setRuntime(api, 'vm');
    expect(s().nodes[api]!.runtime).toBeUndefined();
  });

  it('la conexión por defecto sigue la naturaleza del recurso', () => {
    const service = s().addNode('service', at);
    const queue = s().addResource('queue', at);
    const fn = s().addResource('function', at);
    const bucket = s().addResource('storage', at);
    const secret = s().addResource('secret', at);
    // Guardar el id antes de leer el estado (si no, se lee el anterior a conectar).
    const kindOf = (from: string, to: string) => {
      const id = s().connect(from, to)!;
      return s().edges[id]!.kind;
    };
    expect(kindOf(service, queue)).toBe('event');
    expect(kindOf(queue, fn)).toBe('event');
    expect(kindOf(fn, bucket)).toBe('writes');
    expect(kindOf(bucket, service)).toBe('reads');
    expect(kindOf(service, fn)).toBe('request');
    expect(kindOf(service, secret)).toBe('uses');
    // Sin recursos, las reglas de siempre.
    expect(defaultEdgeKind('screen', 'api')).toBe('request');
    expect(defaultEdgeKind('screen', 'resource', { to: 'cache' })).toBe('writes');
    expect(resourceEdgeKind(undefined, undefined)).toBeNull();
  });

  it('la cabecera dice el subtipo (o el nombre del personalizado) con su glifo', () => {
    expect(resourceLabel({ kind: 'topic' }).label).toBe('Tópico / bus');
    expect(nodeLabel({ type: 'resource', resource: { kind: 'custom', label: 'Step Functions' } })).toEqual({
      label: 'Step Functions',
      glyph: '<#>',
    });
    expect(nodeLabel({ type: 'api' }).label).toBe('API');
  });
});
