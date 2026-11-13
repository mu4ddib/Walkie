import { describe, expect, it } from 'vitest';
import {
  OPERATIONS,
  OPERATION_IDS,
  accessOperation,
  effectiveOperation,
  familyOf,
  kindFor,
  legacyOperation,
  operationConflict,
  operationVerb,
  returnVerb,
  returnsOf,
  suggestOperations,
} from './operations';

describe('catálogo de operaciones (spec interacciones)', () => {
  it('cada operación tiene nombre, verbo, al menos un patrón y su retorno coincide con sus patrones', () => {
    for (const id of OPERATION_IDS) {
      const op = OPERATIONS[id];
      expect(op.name, id).toBeTruthy();
      expect(op.verb, id).toBeTruthy();
      expect(op.patterns.length, id).toBeGreaterThan(0);
      if (op.returns) expect(op.returns.types.length, id).toBeGreaterThan(0);
    }
  });

  it('las familias salen del tipo y del subtipo de recurso', () => {
    expect(familyOf('database')).toBe('database');
    expect(familyOf('resource', 'cache')).toBe('cache');
    expect(familyOf('resource', 'storage')).toBe('storage');
    expect(familyOf('resource', 'topic')).toBe('messaging');
    expect(familyOf('resource', 'function')).toBe('service');
    expect(familyOf('resource', 'gateway')).toBe('api');
    expect(familyOf('rule')).toBe('rule');
  });

  it('sugiere las operaciones pertinentes al par, la más probable primero', () => {
    expect(suggestOperations('service', 'database').slice(0, 3)).toEqual(['db.query', 'db.write', 'db.procedure']);
    expect(suggestOperations('screen', 'api')[0]).toBe('http.request');
    expect(suggestOperations('api', 'cache')).toEqual(['cache.get', 'cache.set', 'cache.delete']);
    expect(suggestOperations('service', 'messaging')[0]).toBe('message.publish');
    expect(suggestOperations('messaging', 'service')[0]).toBe('message.deliver');
    expect(suggestOperations('screen', 'screen')[0]).toBe('navigation');
  });

  it('el trazo (kind) sale de la operación y su patrón', () => {
    expect(kindFor('db.query')).toBe('request');
    expect(kindFor('service.invoke', 'one-way')).toBe('event');
    expect(kindFor('message.publish')).toBe('event');
    expect(kindFor('relation.depends')).toBe('uses');
    expect(kindFor('navigation')).toBe('navigation');
  });

  it('los retornos dependen del intercambio: resultado, respuesta, confirmación; un envío unidireccional no espera', () => {
    expect(returnsOf('db.query', 'request-response')?.action).toBe('Añadir resultado');
    expect(returnsOf('http.request', 'request-response')?.action).toBe('Añadir respuesta');
    expect(returnsOf('message.publish', 'pub-sub')?.action).toBe('Añadir confirmación del broker');
    expect(returnsOf('message.deliver', 'pub-sub')?.action).toBe('Añadir reconocimiento del consumidor');
    expect(returnsOf('service.invoke', 'one-way')).toBeNull();
    expect(returnsOf('relation.uses', 'one-way')).toBeNull();
    expect(returnVerb({ operation: 'db.query' })).toBe('devuelve');
    expect(returnVerb({ operation: 'db.query' }, 'error')).toBe('error');
    expect(returnVerb(undefined)).toBeUndefined();
  });

  it('una conexión anterior sin operación se interpreta por su tipo y su destino, sin guardarla', () => {
    expect(effectiveOperation({ kind: 'reads' }, 'api', 'database')).toEqual({ id: 'db.query', explicit: false });
    expect(effectiveOperation({ kind: 'writes' }, 'api', 'cache')).toEqual({ id: 'cache.set', explicit: false });
    expect(effectiveOperation({ kind: 'request' }, 'screen', 'api')).toEqual({ id: 'http.request', explicit: false });
    expect(effectiveOperation({ kind: 'event' }, 'messaging', 'service')).toEqual({ id: 'message.deliver', explicit: false });
    expect(effectiveOperation({ kind: 'request', operation: 'db.write' }, 'api', 'database')).toEqual({ id: 'db.write', explicit: true });
    expect(effectiveOperation({ kind: 'response' }, 'database', 'api')).toBeNull();
  });

  it('señala la contradicción «lee» + acceso «escribe» sin elegir por su cuenta', () => {
    expect(operationConflict({ kind: 'reads', data: { operation: 'write' } }, 'api', 'database')).toEqual({ kindSays: 'read', dataSays: 'write' });
    expect(operationConflict({ kind: 'reads', data: { operation: 'read' } }, 'api', 'database')).toBeNull();
    expect(operationConflict({ kind: 'uses', data: { operation: 'write' } }, 'api', 'other')).toBeNull();
    expect(accessOperation('write', 'database')).toBe('db.write');
    expect(accessOperation('read', 'storage')).toBe('storage.read');
  });

  it('la operación personalizada usa su nombre como verbo', () => {
    expect(operationVerb({ operation: 'custom', customOperation: 'Concilia' })).toBe('concilia');
    expect(operationVerb({ operation: 'custom' })).toBe('opera');
    expect(operationVerb({})).toBeUndefined();
  });

  it('migra una conexión anterior solo si su significado es inequívoco', () => {
    expect(legacyOperation({ kind: 'reads' }, 'api', 'database')).toBe('db.query');
    expect(legacyOperation({ kind: 'writes' }, 'service', 'storage')).toBe('storage.write');
    expect(legacyOperation({ kind: 'request' }, 'screen', 'api')).toBe('http.request');
    expect(legacyOperation({ kind: 'event' }, 'service', 'messaging')).toBe('message.publish');
    expect(legacyOperation({ kind: 'navigation' }, 'screen', 'screen')).toBe('navigation');
    // Ambiguas: un request a una base (¿consulta o escritura?), un evento entre servicios, un `reads` a una regla.
    expect(legacyOperation({ kind: 'request' }, 'api', 'database')).toBeNull();
    expect(legacyOperation({ kind: 'event' }, 'service', 'service')).toBeNull();
    expect(legacyOperation({ kind: 'reads' }, 'api', 'rule')).toBeNull();
    // Contradicción, retorno, rama o ya migrada: no se toca.
    expect(legacyOperation({ kind: 'reads', data: { operation: 'write' } }, 'api', 'database')).toBeNull();
    expect(legacyOperation({ kind: 'response' }, 'database', 'api')).toBeNull();
    expect(legacyOperation({ kind: 'uses', branch: 'si' }, 'rule', 'screen')).toBeNull();
    expect(legacyOperation({ kind: 'request', operation: 'db.write' }, 'api', 'database')).toBeNull();
  });
});
