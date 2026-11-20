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

/** Los vínculos que quedan con los filtros: por significado, por base (observado) y sin los de confianza baja si se piden fuera. */
export function visibleLinks(links: readonly ArchitectureLink[], filters: Filters): ArchitectureLink[] {
  return links.filter(
    (l) =>
      filters.semantics.has(l.semantic) && (!filters.onlyObserved || l.observed > 0) && (filters.showLow || l.low < l.total),
  );
}

export function visibleRelations(relations: readonly ArchitectureRelation[], filters: Filters): ArchitectureRelation[] {
  return relations.filter(
    (r) =>
      filters.semantics.has(r.semantic) && (!filters.onlyObserved || r.basis === 'observed') && (filters.showLow || r.confidence !== 'low'),
  );
}

/**
 * Texto de un vínculo agregado, corto para que quepa entre dos cajas: «llama a ×12». Si es observado o inferido lo dice
 * el trazo (punteado = inferido) y el inspector lo detalla.
 */
export function linkText(link: ArchitectureLink): string {
  return `${RELATION_LABELS[link.kind] ?? link.kind} ×${link.total}`;
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
export function overviewLayout(groups: readonly ArchitectureGroup[], longestLabel = 0): Record<string, Point> {
  return columns(groups.map((g) => ({ key: g.key, column: GROUP_COLUMNS[g.kind] })), GROUP_BOX, Math.max(OVERVIEW_GAP, labelWidth(longestLabel)));
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
