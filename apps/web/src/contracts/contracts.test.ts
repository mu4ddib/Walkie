import { describe, expect, it } from 'vitest';
import { databaseSummary, edgeDataSummary, httpSummary, normalizeDatabase, normalizeHttp } from './contracts';

describe('normalizeHttp', () => {
  it('recorta textos, quita filas sin nombre, respuestas fuera de rango y lo vacío', () => {
    expect(
      normalizeHttp({
        method: 'POST',
        path: ' /transferencias ',
        auth: { type: 'bearer', description: '  ' },
        params: [
          { name: ' X-Canal ', in: 'header', required: true, type: '' },
          { name: '  ', in: 'query' },
        ],
        request: { contentType: ' application/json ', fields: [{ name: 'monto', required: false }], example: '' },
        responses: [{ status: 201, description: ' Creada ' }, { status: 0 }],
      }),
    ).toEqual({
      method: 'POST',
      path: '/transferencias',
      auth: { type: 'bearer' },
      params: [{ name: 'X-Canal', in: 'header', required: true }],
      request: { contentType: 'application/json', fields: [{ name: 'monto' }] },
      responses: [{ status: 201, description: 'Creada' }],
    });
  });

  it('un contrato sin nada útil es undefined', () => {
    expect(normalizeHttp({ params: [{ name: ' ', in: 'path' }], request: {} })).toBeUndefined();
  });
});

describe('normalizeDatabase', () => {
  it('limpia tablas, campos y relaciones', () => {
    expect(
      normalizeDatabase({
        engine: ' PostgreSQL ',
        schemas: ['pagos', ' '],
        tables: [
          {
            name: 'cuentas',
            fields: [{ name: 'id', key: 'primary', nullable: false }, { name: '' }],
            relations: [{ field: 'cliente_id', references: ' ' }],
          },
          { name: '' },
        ],
      }),
    ).toEqual({
      engine: 'PostgreSQL',
      schemas: ['pagos'],
      tables: [{ name: 'cuentas', fields: [{ name: 'id', key: 'primary', nullable: false }] }],
    });
  });
});

describe('resúmenes', () => {
  it('describen el contrato, la base y el acceso a datos en una línea', () => {
    expect(
      httpSummary({
        auth: { type: 'bearer' },
        params: [{ name: 'id', in: 'path' }],
        responses: [{ status: 200 }, { status: 404 }, { status: 500 }],
      }),
    ).toBe('Bearer (token) · 1 parámetro · 3 respuestas (2 errores)');
    expect(httpSummary({ method: 'GET' })).toBe('');
    expect(databaseSummary({ engine: 'MongoDB', tables: [{ name: 'a', kind: 'collection' }] })).toBe(
      'MongoDB · 1 colección',
    );
    expect(edgeDataSummary({ operation: 'write', entities: ['transferencias'] })).toBe('Escribe: transferencias');
  });
});
