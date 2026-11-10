import type { Database, Edge, Field, Http } from '../schema/walkie-graph';

/**
 * Detalle técnico (spec espacio-de-trabajo, criterios 13 a 15): contrato de una API, estructura de una base de
 * datos y acceso a datos de una conexión. Las mismas estructuras se usan en el lienzo y en el catálogo
 * (`$defs/http` y `$defs/database` de `packages/schema/walkie-graph.schema.json`).
 */
export type HttpParam = NonNullable<Http['params']>[number];
export type HttpResponse = NonNullable<Http['responses']>[number];
export type HttpBody = NonNullable<Http['request']>;
export type AuthType = NonNullable<Http['auth']>['type'];
export type DbTable = NonNullable<Database['tables']>[number];
export type DbField = NonNullable<DbTable['fields']>[number];
export type DbRelation = NonNullable<DbTable['relations']>[number];
export type EdgeData = NonNullable<Edge['data']>;
export type EdgeRequest = NonNullable<Edge['request']>;
export type EdgeRequestParam = NonNullable<EdgeRequest['params']>[number];

export const AUTH_TYPES: readonly AuthType[] = ['none', 'bearer', 'apiKey', 'basic', 'oauth2', 'mtls', 'other'];
export const AUTH_LABELS: Record<AuthType, string> = {
  none: 'Sin autenticación',
  bearer: 'Bearer (token)',
  apiKey: 'API key',
  basic: 'Básica',
  oauth2: 'OAuth 2',
  mtls: 'mTLS',
  other: 'Otra',
};
export const PARAM_PLACES: readonly HttpParam['in'][] = ['path', 'query', 'header'];
export const PARAM_LABELS: Record<HttpParam['in'], string> = { path: 'Ruta', query: 'Query', header: 'Header' };
export const TABLE_KINDS: readonly NonNullable<DbTable['kind']>[] = ['table', 'collection', 'view'];
export const TABLE_KIND_LABELS: Record<NonNullable<DbTable['kind']>, string> = {
  table: 'Tabla',
  collection: 'Colección',
  view: 'Vista',
};
export const KEY_LABELS: Record<NonNullable<DbField['key']>, string> = { primary: 'PK', foreign: 'FK', unique: 'Única' };
export const DATA_OPERATIONS: readonly NonNullable<EdgeData['operation']>[] = ['read', 'write'];
export const DATA_OPERATION_LABELS: Record<NonNullable<EdgeData['operation']>, string> = {
  read: 'Lee',
  write: 'Escribe',
};

/** Límites del schema. */
export const LIMITS = { name: 120, type: 60, short: 500, contentType: 100, example: 10000, ref: 250 } as const;

// --- Normalización: textos recortados al límite, vacíos fuera, filas sin nombre fuera. Así el grafo recarga idéntico.

function text(value: string | undefined, max: number): string | undefined {
  const clean = value?.trim().slice(0, max);
  return clean ? clean : undefined;
}

/** Quita las claves `undefined` (y los arreglos vacíos) para que el JSON no cambie al recargar. */
function compact<T extends object>(obj: T): T | undefined {
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0));
  return entries.length > 0 ? (Object.fromEntries(entries) as T) : undefined;
}

function normalizeField(f: Field): Field | undefined {
  const name = text(f.name, LIMITS.name);
  if (!name) return undefined;
  return {
    ...compact({
      type: text(f.type, LIMITS.type),
      required: f.required ? true : undefined,
      description: text(f.description, LIMITS.short),
      example: text(f.example, LIMITS.short),
    }),
    name,
  } as Field;
}

const fields = (list: Field[] | undefined) => list?.map(normalizeField).filter((f): f is Field => !!f);

function normalizeBody(b: HttpBody | undefined): HttpBody | undefined {
  if (!b) return undefined;
  return compact({
    contentType: text(b.contentType, LIMITS.contentType),
    fields: fields(b.fields),
    example: text(b.example, LIMITS.example),
  });
}

export function normalizeHttp(h: Http | undefined): Http | undefined {
  if (!h) return undefined;
  const params = h.params
    ?.map((p) => {
      const name = text(p.name, LIMITS.name);
      if (!name) return undefined;
      return {
        name,
        in: p.in,
        ...compact({
          type: text(p.type, LIMITS.type),
          required: p.required ? true : undefined,
          description: text(p.description, LIMITS.short),
          example: text(p.example, LIMITS.short),
        }),
      } as HttpParam;
    })
    .filter((p): p is HttpParam => !!p);
  const responses = h.responses
    ?.filter((r) => Number.isInteger(r.status) && r.status >= 100 && r.status <= 599)
    .map(
      (r) =>
        ({
          status: r.status,
          ...compact({
            description: text(r.description, LIMITS.short),
            contentType: text(r.contentType, LIMITS.contentType),
            fields: fields(r.fields),
            example: text(r.example, LIMITS.example),
          }),
        }) as HttpResponse,
    );
  return compact({
    method: h.method,
    path: text(h.path, 2000),
    auth: h.auth ? { type: h.auth.type, ...compact({ description: text(h.auth.description, LIMITS.short) }) } : undefined,
    params,
    request: normalizeBody(h.request),
    responses,
  });
}

export function normalizeDatabase(d: Database | undefined): Database | undefined {
  if (!d) return undefined;
  const tables = d.tables
    ?.map((t) => {
      const name = text(t.name, LIMITS.name);
      if (!name) return undefined;
      const tableFields = t.fields
        ?.map((f) => {
          const fname = text(f.name, LIMITS.name);
          if (!fname) return undefined;
          return {
            name: fname,
            ...compact({
              type: text(f.type, LIMITS.type),
              key: f.key,
              nullable: f.nullable === undefined ? undefined : f.nullable,
              description: text(f.description, LIMITS.short),
            }),
          } as DbField;
        })
        .filter((f): f is DbField => !!f);
      const relations = t.relations
        ?.map((r) => {
          const field = text(r.field, LIMITS.name);
          const references = text(r.references, LIMITS.ref);
          if (!field || !references) return undefined;
          return { field, references, ...compact({ description: text(r.description, LIMITS.short) }) } as DbRelation;
        })
        .filter((r): r is DbRelation => !!r);
      return {
        name,
        ...compact({
          schema: text(t.schema, LIMITS.name),
          kind: t.kind,
          description: text(t.description, LIMITS.short),
          fields: tableFields,
          relations,
        }),
      } as DbTable;
    })
    .filter((t): t is DbTable => !!t);
  return compact({
    engine: text(d.engine, LIMITS.type),
    name: text(d.name, LIMITS.name),
    schemas: d.schemas?.map((s) => text(s, LIMITS.name)).filter((s): s is string => !!s),
    tables,
  });
}

export function normalizeEdgeData(d: EdgeData | undefined): EdgeData | undefined {
  if (!d) return undefined;
  return compact({
    operation: d.operation,
    entities: d.entities?.map((e) => text(e, LIMITS.name)).filter((e): e is string => !!e),
  });
}

/** Endpoint y parámetros propios de una solicitud (`edge.request`); vacío → `undefined`. */
export function normalizeEdgeRequest(r: EdgeRequest | undefined): EdgeRequest | undefined {
  if (!r) return undefined;
  const params = r.params
    ?.map((p) => {
      const name = text(p.name, LIMITS.name);
      if (!name) return undefined;
      return { name, in: p.in, ...compact({ value: text(p.value, LIMITS.short) }) } as EdgeRequestParam;
    })
    .filter((p): p is EdgeRequestParam => !!p);
  return compact({ method: r.method, path: text(r.path, 2000), params });
}

/** Lista separada por comas → elementos, sin recortar (el borrador conserva lo escrito; la normalización recorta). */
export const splitList = (value: string) => value.split(',');

// --- Resúmenes para el nodo (criterio 13: "el nodo muestra solo un resumen").

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Ej. "Bearer (token) · 2 parámetros · 3 respuestas (1 error)"; vacío si no hay más que método y ruta. */
export function httpSummary(h: Http | undefined): string {
  if (!h) return '';
  const parts: string[] = [];
  if (h.auth && h.auth.type !== 'none') parts.push(AUTH_LABELS[h.auth.type]);
  if (h.params?.length) parts.push(plural(h.params.length, 'parámetro', 'parámetros'));
  if (h.request?.fields?.length) parts.push(`request ${plural(h.request.fields.length, 'campo', 'campos')}`);
  if (h.responses?.length) {
    const errors = h.responses.filter((r) => r.status >= 400).length;
    parts.push(plural(h.responses.length, 'respuesta', 'respuestas') + (errors ? ` (${plural(errors, 'error', 'errores')})` : ''));
  }
  return parts.join(' · ');
}

/** Ej. "PostgreSQL · core · 3 tablas". */
export function databaseSummary(d: Database | undefined): string {
  if (!d) return '';
  const parts = [d.engine, d.name].filter(Boolean) as string[];
  if (d.tables?.length) {
    const kinds = new Set(d.tables.map((t) => t.kind ?? 'table'));
    const noun = kinds.size === 1 && kinds.has('collection') ? ['colección', 'colecciones'] : ['tabla', 'tablas'];
    parts.push(plural(d.tables.length, noun[0]!, noun[1]!));
  }
  return parts.join(' · ');
}

/** Ej. "Escribe: transferencias, movimientos". */
export function edgeDataSummary(d: EdgeData | undefined): string {
  if (!d?.operation && !d?.entities?.length) return '';
  const op = d.operation ? DATA_OPERATION_LABELS[d.operation] : 'Datos';
  return d.entities?.length ? `${op}: ${d.entities.join(', ')}` : op;
}
