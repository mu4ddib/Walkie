import { describe, expect, it } from 'vitest';
import type { Edge } from '../schema/walkie-graph';
import {
  TIMEOUT_SCENARIO,
  edgeDisplay,
  edgeDisplayText,
  endpointText,
  interactionEdges,
  responseStatus,
  scenariosOf,
  shouldReverse,
} from './edgeMeta';

describe('shouldReverse (tipo y sentido concuerdan)', () => {
  it('una pantalla → API marcada como "responde" se invierte: la respuesta sale de la API', () => {
    expect(shouldReverse('request', 'response', 'screen', 'api')).toBe(true);
    expect(shouldReverse('navigation', 'response', 'actor', 'service')).toBe(true);
  });

  it('si el sentido ya concuerda, no se toca', () => {
    expect(shouldReverse('uses', 'response', 'api', 'screen')).toBe(false);
    expect(shouldReverse('response', 'request', 'screen', 'api')).toBe(false);
    expect(shouldReverse('request', 'request', 'screen', 'api')).toBe(false);
  });

  it('una API → pantalla marcada como "llama" se invierte', () => {
    expect(shouldReverse('response', 'request', 'api', 'screen')).toBe(true);
  });

  it('si los tipos no deciden, solicitud ↔ respuesta se invierten entre sí y el resto no', () => {
    expect(shouldReverse('request', 'response', 'api', 'service')).toBe(true);
    expect(shouldReverse('event', 'response', 'api', 'service')).toBe(false);
    expect(shouldReverse('request', 'event', 'screen', 'api')).toBe(false);
  });
});

describe('edgeDisplay', () => {
  it('una solicitud sin etiqueta muestra el endpoint: el del paso o el del contrato de la API', () => {
    const http = { method: 'POST', path: '/creacionUsuario' } as const;
    expect(edgeDisplayText(edgeDisplay({ kind: 'request' }, { targetHttp: http }))).toBe('llama · POST /creacionUsuario');
    expect(endpointText({ kind: 'request', request: { path: '/v2/usuarios' } }, http)).toBe('POST /v2/usuarios');
    expect(edgeDisplayText(edgeDisplay({ kind: 'request', label: 'Alta' }, { targetHttp: http }))).toBe('llama · Alta');
    expect(edgeDisplayText(edgeDisplay({ kind: 'request' }))).toBe('llama');
  });

  it('una respuesta muestra su código; uno escrito como condición también cuenta, sin repetirse', () => {
    expect(edgeDisplayText(edgeDisplay({ kind: 'response', status: 201, when: 'si es nuevo' }))).toBe('responde 201 [si es nuevo]');
    expect(edgeDisplayText(edgeDisplay({ kind: 'response', when: '404', label: 'Cliente' }))).toBe('responde 404 · Cliente');
    expect(responseStatus({ kind: 'request', when: '200' })).toBeUndefined();
    expect(edgeDisplayText(edgeDisplay({ kind: 'request', label: 'Buscar', when: '200' }))).toBe('llama · Buscar [200]');
  });

  it('la etiqueta de una salida sustituye a "usa" y la rama lleva punta', () => {
    const branch = edgeDisplay({ kind: 'uses', when: 'correo registrado' }, { branchLabel: 'Sí' });
    expect(edgeDisplayText(branch)).toBe('Sí [correo registrado]');
    expect(branch.marker).toBe('open');
    expect(edgeDisplayText(edgeDisplay({ kind: 'navigation' }, { branchLabel: 'No' }))).toBe('No · navega');
    expect(edgeDisplay({ kind: 'uses' }).marker).toBe('none');
  });
});

describe('interactionEdges (previsualizar)', () => {
  const edges: Record<string, Edge> = {
    req: { id: 'req', from: 'a', to: 'b', kind: 'request' },
    ok: { id: 'ok', from: 'b', to: 'a', kind: 'response', replyTo: 'req', status: 201 },
    error: { id: 'error', from: 'b', to: 'a', kind: 'response', replyTo: 'req', status: 409 },
    nav: { id: 'nav', from: 'a', to: 'c', kind: 'navigation' },
  };

  it('desde la solicitud: la ida y el escenario elegido (por defecto el primero); desde una respuesta: su solicitud y ella', () => {
    expect(interactionEdges(edges, 'req')).toEqual(['req', 'ok']);
    expect(interactionEdges(edges, 'req', 'error')).toEqual(['req', 'error']);
    expect(interactionEdges(edges, 'req', TIMEOUT_SCENARIO)).toEqual(['req']);
    expect(interactionEdges(edges, 'error')).toEqual(['req', 'error']);
    expect(interactionEdges(edges, 'nav')).toEqual(['nav']);
    expect(interactionEdges(edges, 'no-existe')).toEqual([]);
  });
});

describe('escenarios de una interacción (spec interacciones)', () => {
  it('cada retorno alternativo y el timeout; los mensajes de un stream van siempre, en orden', () => {
    const edges: Record<string, Edge> = {
      q: { id: 'q', from: 'api', to: 'db', kind: 'request', operation: 'db.query' },
      found: { id: 'found', from: 'db', to: 'api', kind: 'response', replyTo: 'q', result: { type: 'success' } },
      none: { id: 'none', from: 'db', to: 'api', kind: 'response', replyTo: 'q', result: { type: 'empty', description: 'sin filas' } },
      s: { id: 's', from: 'a', to: 'b', kind: 'request', operation: 'stream.open' },
      m1: { id: 'm1', from: 'b', to: 'a', kind: 'response', replyTo: 's', stream: true, result: { type: 'message' } },
      m2: { id: 'm2', from: 'b', to: 'a', kind: 'response', replyTo: 's', stream: true, result: { type: 'end' } },
      pub: { id: 'pub', from: 'svc', to: 'topic', kind: 'event', operation: 'message.publish' },
      reply: { id: 'reply', from: 'worker', to: 'svc', kind: 'event', operation: 'message.reply', correlatesWith: 'pub' },
    };
    expect(scenariosOf(edges, 'q').map((x) => x.label)).toEqual(['resultado', 'resultado vacío · sin filas', 'Timeout (no llega respuesta)']);
    expect(interactionEdges(edges, 'q', 'none')).toEqual(['q', 'none']);
    expect(interactionEdges(edges, 's')).toEqual(['s', 'm1', 'm2']);
    expect(interactionEdges(edges, 'pub')).toEqual(['pub', 'reply']);
    expect(scenariosOf(edges, 'pub')).toEqual([]);
  });

  it('un retorno dice su verbo según la operación a la que responde', () => {
    const parent = { operation: 'db.query' as const };
    expect(edgeDisplay({ kind: 'response', result: { type: 'empty' } }, { parent })).toMatchObject({ main: 'devuelve', detail: 'resultado vacío' });
    expect(edgeDisplay({ kind: 'response', result: { type: 'error', code: 'ORA-01403' } }, { parent })).toMatchObject({
      main: 'error',
      detail: 'ORA-01403',
      error: true,
    });
    expect(edgeDisplay({ kind: 'request', operation: 'db.query' }).main).toBe('consulta');
    expect(edgeDisplay({ kind: 'reads' }).main).toBe('lee');
  });
});
