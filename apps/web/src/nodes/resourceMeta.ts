import type { EdgeKind } from '../store/graphStore';
import type { Resource } from '../schema/walkie-graph';

/**
 * Recursos de infraestructura (spec nodos-de-infraestructura, ADR-0007): subtipos con su etiqueta, glifo (ASCII, en
 * el estilo pixel de los demás tipos) y una línea de qué es; proveedores y el tipo de conexión que sugiere cada uno.
 */
export type ResourceKind = Resource['kind'];
export type Provider = NonNullable<Resource['provider']>;

/** Límites de `$defs/resource` en el schema. */
export const RESOURCE_LABEL_MAX_LENGTH = 40;
export const RESOURCE_NAME_MAX_LENGTH = 120;
export const RESOURCE_DETAILS_MAX = 30;
export const DETAIL_KEY_MAX_LENGTH = 40;
export const DETAIL_VALUE_MAX_LENGTH = 200;
/** Detalles que se ven en la caja (el resto, en el inspector). */
export const MAX_VISIBLE_DETAILS = 3;

/** En el orden en que se ofrecen (el de la paleta y del export). */
export const RESOURCE_KINDS: readonly { kind: ResourceKind; label: string; glyph: string; help: string }[] = [
  { kind: 'storage', label: 'Bucket', glyph: '[_]', help: 'Almacenamiento de objetos: archivos, comprobantes, respaldos.' },
  { kind: 'function', label: 'Función', glyph: 'f()', help: 'Código que corre por evento o invocación (serverless).' },
  { kind: 'queue', label: 'Cola', glyph: '|||', help: 'Mensajes en espera que un consumidor procesa en orden.' },
  { kind: 'topic', label: 'Tópico / bus', glyph: '<+>', help: 'Eventos publicados a varios suscriptores.' },
  { kind: 'cache', label: 'Caché', glyph: '{~}', help: 'Datos en memoria para leer rápido (sesiones, consultas).' },
  { kind: 'cdn', label: 'CDN', glyph: '(@)', help: 'Contenido estático servido cerca del usuario.' },
  { kind: 'gateway', label: 'Gateway', glyph: '>|<', help: 'Balanceador o API gateway: la puerta de entrada.' },
  { kind: 'secret', label: 'Secreto', glyph: '[*]', help: 'Credenciales, llaves o configuración protegida.' },
  { kind: 'scheduler', label: 'Programador', glyph: '(:)', help: 'Tareas que se disparan por horario (cron).' },
  { kind: 'custom', label: 'Personalizado', glyph: '<#>', help: 'Otro recurso: escribe qué es (ej. Step Functions).' },
];

export const PROVIDERS: readonly { provider: Provider; label: string }[] = [
  { provider: 'aws', label: 'AWS' },
  { provider: 'azure', label: 'Azure' },
  { provider: 'gcp', label: 'Google Cloud' },
  { provider: 'on-premise', label: 'On-premise' },
  { provider: 'other', label: 'Otro' },
];

export function resourceKindMeta(kind: ResourceKind) {
  return RESOURCE_KINDS.find((k) => k.kind === kind) ?? RESOURCE_KINDS[RESOURCE_KINDS.length - 1]!;
}

/** Lo que dice la cabecera de la caja: el subtipo, o el nombre del personalizado. */
export function resourceLabel(resource: Resource | undefined): { label: string; glyph: string } {
  const meta = resourceKindMeta(resource?.kind ?? 'custom');
  return { label: resource?.kind === 'custom' && resource.label ? resource.label : meta.label, glyph: meta.glyph };
}

export function providerLabel(provider: Provider | undefined): string | undefined {
  return PROVIDERS.find((p) => p.provider === provider)?.label;
}

/**
 * Tipo de conexión que sugiere un recurso según su naturaleza: hacia una cola o un tópico se emite un evento (y desde
 * ellos llega uno); en un bucket o una caché se escribe y desde ellos se lee; una función o un gateway se invocan.
 * `null` si el recurso no sugiere nada (vale la regla general).
 */
export function resourceEdgeKind(from: ResourceKind | undefined, to: ResourceKind | undefined): EdgeKind | null {
  if (to === 'queue' || to === 'topic' || from === 'queue' || from === 'topic') return 'event';
  if (to === 'storage' || to === 'cache') return 'writes';
  if (from === 'storage' || from === 'cache') return 'reads';
  if (to === 'function' || to === 'gateway') return 'request';
  return null;
}

/**
 * Recurso como lo guarda el grafo: textos recortados y en sus límites, `label` solo (y siempre) en `custom`, detalles
 * sin clave vacía. Un vacío quita el campo opcional, así el grafo recarga idéntico.
 */
export function normalizeResource(resource: Resource, fallbackLabel?: string): Resource {
  const out: Resource = { kind: resource.kind };
  if (resource.kind === 'custom') {
    const label = (resource.label ?? '').trim() || (fallbackLabel ?? '').trim() || 'Recurso';
    out.label = label.slice(0, RESOURCE_LABEL_MAX_LENGTH);
  }
  if (resource.provider) out.provider = resource.provider;
  const name = resource.name?.trim();
  if (name) out.name = name.slice(0, RESOURCE_NAME_MAX_LENGTH);
  const details = (resource.details ?? [])
    .map((d) => ({ key: d.key.trim().slice(0, DETAIL_KEY_MAX_LENGTH), value: d.value.trim().slice(0, DETAIL_VALUE_MAX_LENGTH) }))
    .filter((d) => d.key)
    .slice(0, RESOURCE_DETAILS_MAX);
  if (details.length) out.details = details;
  return out;
}
