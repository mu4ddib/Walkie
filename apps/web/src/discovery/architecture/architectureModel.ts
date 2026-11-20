import type {
  ArchitectureEntity,
  ArchitectureGroup,
  ArchitectureLink,
  ArchitectureRelation,
  DiscoveryArchitectureGroup,
} from '../../api/client';

/**
 * Lo que la vista «Explorar arquitectura» calcula para dibujar (spec walkie-live-arquitectura, ADR-0016). Funciones
 * puras: la proyección la arma la API; aquí solo se filtra y se ubica cada caja en columnas por tipo (una sola vez por
 * vista, nunca al mover). Nada se guarda.
 */

/** Hallazgos por página al abrir un grupo (lo que React Flow dibuja de una vez; la API admite hasta 500). */
export const GROUP_PAGE_SIZE = 500;

export type Semantic = 'execution' | 'navigation' | 'containment' | 'dependency';

export const SEMANTICS: readonly Semantic[] = ['execution', 'navigation', 'dependency', 'containment'];

export const SEMANTIC_LABELS: Record<Semantic, string> = {
  execution: 'Ejecución',
  navigation: 'Navegación',
  containment: 'Contención',
  dependency: 'Dependencia',
};

/** Qué dice cada significado, para la leyenda: una contención o una dependencia nunca es una solicitud. */
export const SEMANTIC_HELP: Record<Semantic, string> = {
  execution: 'Llama, lee o escribe: algo que ocurre al usar la app.',
  navigation: 'Pasa de una pantalla a otra.',
  dependency: 'Declarada en el proyecto (referencia, compose): no prueba una llamada.',
  containment: 'Forma parte de otro (una app contiene sus pantallas; un módulo expone sus APIs).',
};

export const RELATION_LABELS: Record<string, string> = {
  calls: 'llama a',
  reads: 'lee',
  writes: 'escribe',
  publishes: 'publica en',
  consumes: 'consume de',
  exposes: 'expone',
  'depends-on': 'depende de',
  navigates: 'navega a',
  contains: 'contiene',
};

export const GROUP_KIND_LABELS: Record<ArchitectureGroup['kind'], string> = {
  frontend: 'App de front',
  service: 'Servicio',
  module: 'Módulo',
  data: 'Datos',
  infrastructure: 'Infraestructura',
  external: 'APIs externas',
  unassigned: 'Sin agrupar',
};

export const ENTITY_LABELS: Record<ArchitectureEntity['kind'], { one: string; many: string }> = {
  screen: { one: 'pantalla', many: 'pantallas' },
  api: { one: 'API', many: 'APIs' },
  service: { one: 'servicio', many: 'servicios' },
  module: { one: 'módulo', many: 'módulos' },
  database: { one: 'base', many: 'bases' },
  resource: { one: 'recurso', many: 'recursos' },
  feature: { one: 'propuesta', many: 'propuestas' },
};

/**
 * Una clave de hallazgo, corta para leer: sin el tipo y, en pantallas y propuestas, sin la app
 * (`screen:web:/pedidos` → `/pedidos`, `api:GET /api/x` → `GET /api/x`).
 */
export function shortKey(key: string): string {
  const [kind, ...rest] = key.split(':');
  const tail = rest.join(':');
  if ((kind === 'screen' || kind === 'feature') && tail.includes(':')) return tail.slice(tail.indexOf(':') + 1);
  return rest.length > 0 ? tail : key;
}

export const count = (n: number, kind: ArchitectureEntity['kind']) => `${n} ${n === 1 ? ENTITY_LABELS[kind].one : ENTITY_LABELS[kind].many}`;

export interface Filters {
  semantics: ReadonlySet<Semantic>;
  /** Mostrar lo que solo tiene confianza baja (por ejemplo, llamadas a través de un componente dibujado). */
  showLow: boolean;
  /** Solo lo observado directamente (sin lo inferido de varias pistas). */
  onlyObserved: boolean;
}

export const DEFAULT_FILTERS: Filters = { semantics: new Set(['execution', 'navigation', 'dependency']), showLow: true, onlyObserved: false };

/**
 * Cuántas relaciones de un vínculo deja ver un filtro, sumando sus categorías disjuntas (base × confianza): «Solo
 * observadas» saca las inferidas y sin «Confianza baja» se van las bajas; las dos juntas dejan las observadas altas y
 * medias. Nunca el total del vínculo si el filtro deja menos.
 */
export function linkCount(link: ArchitectureLink, filters: Filters): number {
  const bases = filters.onlyObserved ? [link.byBasis.observed] : [link.byBasis.observed, link.byBasis.inferred];
  return bases.reduce((sum, c) => sum + c.high + c.medium + (filters.showLow ? c.low : 0), 0);
}

/** Lo que el filtro deja ver de un vínculo: total, observadas e inferidas (y cuántas de confianza baja). */
export function linkCounts(link: ArchitectureLink, filters: Filters) {
  const of = (c: ArchitectureLink['byBasis']['observed']) => c.high + c.medium + (filters.showLow ? c.low : 0);
  const observed = of(link.byBasis.observed);
  const inferred = filters.onlyObserved ? 0 : of(link.byBasis.inferred);
  const low = filters.showLow ? link.byBasis.observed.low + (filters.onlyObserved ? 0 : link.byBasis.inferred.low) : 0;
  return { total: observed + inferred, observed, inferred, low };
}

/** Los vínculos que quedan con los filtros: por significado y con al menos una relación que cumpla los demás. */
export function visibleLinks(links: readonly ArchitectureLink[], filters: Filters): ArchitectureLink[] {
  return links.filter((l) => filters.semantics.has(l.semantic) && linkCount(l, filters) > 0);
}

export function visibleRelations(relations: readonly ArchitectureRelation[], filters: Filters): ArchitectureRelation[] {
  return relations.filter(
    (r) =>
      filters.semantics.has(r.semantic) && (!filters.onlyObserved || r.basis === 'observed') && (filters.showLow || r.confidence !== 'low'),
  );
}

/**
 * Texto de un vínculo agregado, corto para que quepa entre dos cajas: «llama a ×12», con lo que deja ver el filtro. Si
 * es observado o inferido lo dice el trazo (punteado = inferido) y el inspector lo detalla.
 */
export function linkText(link: ArchitectureLink, filters: Filters): string {
  return `${RELATION_LABELS[link.kind] ?? link.kind} ×${linkCount(link, filters)}`;
}

export interface Point {
  x: number;
  y: number;
}

export const GROUP_BOX = { w: 232, h: 120 };
export const ENTITY_BOX = { w: 232, h: 64 };
/** Entre columnas de la vista general: deja lugar a la etiqueta de un vínculo («llama a ×12»). */
const OVERVIEW_GAP = 144;
/** Entre columnas del detalle: las etiquetas son de una relación y más cortas. */
const DETAIL_GAP = 112;
const ROW_GAP = 40;
const PER_COLUMN = 18;

const GROUP_COLUMNS: Record<ArchitectureGroup['kind'], number> = {
  frontend: 0,
  external: 1,
  service: 1,
  module: 2,
  data: 3,
  infrastructure: 4,
  unassigned: 4,
};

/**
 * Vista general: una columna por responsabilidad (front, servicios, módulos, datos, infraestructura), en el orden de
 * la API. Una columna larga se parte en varias (como mucho {@link PER_COLUMN} cajas por columna).
 */
export function overviewLayout(groups: readonly ArchitectureGroup[], longestLabel = 0, orientation: Orientation = 'columns'): Record<string, Point> {
  const items = groups.map((g) => ({ key: g.key, column: GROUP_COLUMNS[g.kind] }));
  return orientation === 'columns'
    ? columns(items, GROUP_BOX, Math.max(OVERVIEW_GAP, labelWidth(longestLabel)))
    : rows(items, GROUP_BOX, ROWS_GAP);
}

/** Columnas (de izquierda a derecha) o filas (de arriba abajo): la misma secuencia por responsabilidad. */
export type Orientation = 'columns' | 'rows';
/** Entre filas de la vista general: la etiqueta va sobre una flecha vertical, así que basta su alto y aire. */
const ROWS_GAP = 96;
const PER_ROW = 6;

/**
 * La orientación que se lee mejor en un lienzo de este tamaño: la que permite encuadrar todo con más zoom. Se elige una
 * vez al abrir la vista (nunca al plegar un panel ni al filtrar), así la vista no salta.
 */
export function overviewOrientation(groups: readonly ArchitectureGroup[], longestLabel: number, size: { w: number; h: number }): Orientation {
  const zoom = (orientation: Orientation) => {
    const points = Object.values(overviewLayout(groups, longestLabel, orientation));
    if (points.length === 0) return 1;
    const w = Math.max(...points.map((p) => p.x)) + GROUP_BOX.w;
    const h = Math.max(...points.map((p) => p.y)) + GROUP_BOX.h;
    return Math.min(size.w / w, size.h / h);
  };
  return zoom('rows') > zoom('columns') ? 'rows' : 'columns';
}

/** Ancho aproximado de la etiqueta de una flecha (11 px de IBM Plex Sans ≈ 6 px por carácter, más el relleno). */
export const labelWidth = (chars: number) => Math.ceil((chars * 6 + 32) / 8) * 8;

/** Columnas del detalle: la app, el módulo y las propuestas a la izquierda; pantallas; APIs; datos; vecinos al final. */
const ENTITY_COLUMNS: Record<ArchitectureEntity['kind'], number> = {
  service: 0,
  module: 0,
  feature: 0,
  screen: 1,
  api: 2,
  database: 3,
  resource: 3,
};

/** Un vecino de otro grupo, en el detalle: una caja por grupo, con cuántos hallazgos suyos se relacionan. */
export interface Stub {
  key: string;
  group: string;
  entities: number;
}

/** El detalle de un grupo: sus hallazgos por tipo en columnas y, a la derecha, una caja por grupo vecino. */
export function detailLayout(detail: DiscoveryArchitectureGroup): { positions: Record<string, Point>; stubs: Stub[] } {
  const stubs = new Map<string, number>();
  for (const n of detail.neighbors) stubs.set(n.group, (stubs.get(n.group) ?? 0) + 1);
  const stubList = [...stubs.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([group, entities]) => ({ key: stubKey(group), group, entities }));
  const items = [
    ...detail.entities.map((e) => ({ key: e.key, column: ENTITY_COLUMNS[e.kind] })),
    ...stubList.map((s) => ({ key: s.key, column: 4 })),
  ];
  return { positions: columns(items, ENTITY_BOX, DETAIL_GAP), stubs: stubList };
}

export const stubKey = (group: string) => `grupo:${group}`;

function columns(items: readonly { key: string; column: number }[], box: { w: number; h: number }, gap: number): Record<string, Point> {
  const byColumn = new Map<number, string[]>();
  for (const item of items) byColumn.set(item.column, [...(byColumn.get(item.column) ?? []), item.key]);
  const positions: Record<string, Point> = {};
  let x = 0;
  for (const column of [...byColumn.keys()].sort((a, b) => a - b)) {
    const keys = byColumn.get(column)!;
    const parts = Math.ceil(keys.length / PER_COLUMN);
    for (let part = 0; part < parts; part++) {
      keys.slice(part * PER_COLUMN, (part + 1) * PER_COLUMN).forEach((key, row) => {
        positions[key] = { x, y: row * (box.h + ROW_GAP) };
      });
      x += box.w + gap;
    }
  }
  return positions;
}

function rows(items: readonly { key: string; column: number }[], box: { w: number; h: number }, gap: number): Record<string, Point> {
  const byRow = new Map<number, string[]>();
  for (const item of items) byRow.set(item.column, [...(byRow.get(item.column) ?? []), item.key]);
  const positions: Record<string, Point> = {};
  let y = 0;
  for (const row of [...byRow.keys()].sort((a, b) => a - b)) {
    const keys = byRow.get(row)!;
    for (let part = 0; part < Math.ceil(keys.length / PER_ROW); part++) {
      keys.slice(part * PER_ROW, (part + 1) * PER_ROW).forEach((key, column) => {
        positions[key] = { x: column * (box.w + ROW_GAP), y };
      });
      y += box.h + gap;
    }
  }
  return positions;
}

/** Un paso de evidencia tal como llega de la API (lo que hace falta para ordenarlo). */
export interface EvidenceStep {
  id: string;
  symbol?: string;
  note?: string;
}

const CALLEE = /^(?:llama a |dibuja <)([^>\s]+)>?$/;
const WHERE = /(?:^|· )en (\S+)$/;

/** En qué función está un paso («… · en useApps») y a quién llama o dibuja («llama a listApps», «dibuja <Welcome>»). */
export function stepParts(step: EvidenceStep): { in?: string; calls?: string; note?: string } {
  const where = step.note ? WHERE.exec(step.note) : null;
  const calls = step.symbol ? CALLEE.exec(step.symbol) : null;
  const note = step.note && where ? step.note.slice(0, where.index).trim() || undefined : step.note;
  return { ...(where ? { in: where[1] } : {}), ...(calls ? { calls: calls[1] } : {}), ...(note ? { note } : {}) };
}

/**
 * La evidencia de una relación en el orden en que ocurre (pantalla → hook o servicio → cliente → API). La API la guarda
 * ordenada por id, así que el orden se reconstruye de cada paso: en qué función está y a qué función llama. Empieza por
 * un paso cuya función nadie llama (la pantalla), sigue al paso de la función llamada y, si un paso no llama a nadie
 * (donde se arma la URL), sigue por el siguiente que nadie de lo que queda llama. Lo que no tiene función (análisis
 * anteriores) queda al final en el orden recibido; `ordered` dice si se pudo ordenar.
 */
export function orderChain<T extends EvidenceStep>(steps: readonly T[]): { steps: T[]; ordered: boolean } {
  const parts = new Map(steps.map((s) => [s.id, stepParts(s)]));
  const located = steps.filter((s) => parts.get(s.id)!.in);
  if (located.length < 2) return { steps: [...steps], ordered: false };
  const rest = [...located];
  const out: T[] = [];
  let next: string | undefined;
  // Cuántos pasos se encadenan desde uno (siguiendo a quién llama), para empezar por la cadena más larga: la pantalla.
  const reach = (from: T, pool: readonly T[]) => {
    let length = 1;
    let callee = parts.get(from.id)!.calls;
    const seen = new Set([from.id]);
    for (let step = pool.find((s) => parts.get(s.id)!.in === callee); step && !seen.has(step.id); step = pool.find((s) => parts.get(s.id)!.in === callee)) {
      seen.add(step.id);
      length++;
      callee = parts.get(step.id)!.calls;
    }
    return length;
  };
  while (rest.length > 0) {
    const called = new Set(rest.map((s) => parts.get(s.id)!.calls).filter(Boolean));
    const roots = rest.filter((s) => !called.has(parts.get(s.id)!.in));
    const root = roots.reduce<T | undefined>((best, s) => (best === undefined || reach(s, rest) > reach(best, rest) ? s : best), undefined);
    const pick = (next !== undefined ? rest.find((s) => parts.get(s.id)!.in === next) : undefined) ?? root ?? rest[0]!;
    out.push(pick);
    rest.splice(rest.indexOf(pick), 1);
    next = parts.get(pick.id)!.calls;
  }
  return { steps: [...out, ...steps.filter((s) => !parts.get(s.id)!.in)], ordered: true };
}
