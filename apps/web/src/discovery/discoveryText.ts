import type { DiscoveryStatus } from '../api/client';

/**
 * Textos de Walkie Live (spec walkie-live, tarea 5). Cada estado tiene nombre, glifo y explicación: nunca se distingue
 * solo por el color. Las explicaciones dicen lo que la revisión sabe, no lo que la persona tiene que hacer: un hallazgo
 * que «ya no aparece» no es una orden de borrar nada.
 */
export const STATUS: Record<DiscoveryStatus, { label: string; glyph: string; help: string }> = {
  new: {
    label: 'Nuevo',
    glyph: '+',
    help: 'Walkie no tiene nada vinculado a este hallazgo y no encontró un elemento que coincida.',
  },
  matched: {
    label: 'Coincide',
    glyph: '≈',
    help: 'Se parece a un elemento que ya existe en la app. Es una sugerencia: no se vincula hasta que lo confirmes.',
  },
  linked: {
    label: 'Vinculado',
    glyph: '↔',
    help: 'Está vinculado a un elemento existente. El elemento no cambió: el vínculo solo dice de qué código viene.',
  },
  created: {
    label: 'Creado',
    glyph: '✓',
    help: 'Walkie creó un elemento a partir de este hallazgo.',
  },
  rejected: {
    label: 'Descartado',
    glyph: '×',
    help: 'Lo descartaste: sigue descartado en los análisis siguientes de esta fuente hasta que lo restablezcas.',
  },
  changed: {
    label: 'Cambió',
    glyph: 'Δ',
    help: 'El descubrimiento cambió desde que se decidió sobre él (por ejemplo, su contrato). La decisión se conserva: revísala.',
  },
  missing: {
    label: 'Ya no aparece',
    glyph: '?',
    help: 'Estaba vinculado y este análisis, que sí miró donde estaba, ya no lo encontró. No se borra nada: decide tú si sigue vigente.',
  },
  unverified: {
    label: 'Sin cobertura',
    glyph: '◌',
    help: 'Estaba vinculado y no aparece, pero este análisis no miró donde estaba (un detector no corrió, quedó fuera del alcance o lo alcanza una limitación). No se concluye que desapareció.',
  },
};

export const STATUS_ORDER: DiscoveryStatus[] = ['new', 'matched', 'changed', 'missing', 'unverified', 'linked', 'created', 'rejected'];

/**
 * Cómo cambió cada hallazgo respecto del análisis anterior de la misma fuente (tarea 10). Lo calcula la API; aquí solo
 * hay textos. Distinto del estado: «Nuevo en este análisis» puede estar ya vinculado (por ejemplo, tras renombrar).
 */
export type Change = 'added' | 'modified' | 'unchanged';

export const CHANGE: Record<Change, { label: string; glyph: string; help: string }> = {
  added: { label: 'Nuevo en este análisis', glyph: '+', help: 'No estaba en el análisis anterior.' },
  modified: { label: 'Cambió desde el anterior', glyph: 'Δ', help: 'Estaba en el análisis anterior y cambió su contenido (por ejemplo, su contrato).' },
  unchanged: { label: 'Sin cambios', glyph: '=', help: 'Estaba en el análisis anterior y sigue igual.' },
};

export const CHANGE_ORDER: Change[] = ['added', 'modified', 'unchanged'];

/** Lo que se puede crear en el catálogo desde un hallazgo (tarea 6). Módulos y features llegan en la tarea 9. */
export const CREATABLE_KINDS: readonly string[] = ['api', 'service', 'database', 'resource'];

/** Hallazgos que se crean con su lienzo inicial (tarea 9). Una pantalla entra con su feature. */
export const CONTAINER_KINDS: readonly string[] = ['module', 'feature'];

export const KIND: Record<string, string> = {
  api: 'API',
  service: 'Servicio',
  database: 'Base de datos',
  resource: 'Recurso',
  screen: 'Pantalla',
  module: 'Módulo',
  feature: 'Feature',
};

export const KIND_ORDER = ['api', 'service', 'database', 'resource', 'screen', 'module', 'feature'];

export const BASIS: Record<string, string> = {
  observed: 'Observado en el código',
  inferred: 'Inferido',
};

export const CONFIDENCE: Record<string, string> = { high: 'alta', medium: 'media', low: 'baja' };

export const REASON: Record<string, { label: string; help: string }> = {
  signature: { label: 'Misma firma', help: 'El contrato coincide: mismo método y ruta, mismo motor y nombre o mismo subtipo y nombre.' },
  title: { label: 'Mismo nombre', help: 'Solo coincide el nombre: puede ser otro componente con el mismo título.' },
};

export const TARGET_KIND: Record<string, string> = { catalogItem: 'Elemento del catálogo', module: 'Módulo', feature: 'Feature' };

export const DETECTOR_STATUS: Record<string, string> = { ran: 'corrió', skipped: 'no corrió', failed: 'falló' };

/** A qué tipo de elemento existente se puede vincular un hallazgo (como `MatchIndex.TargetKindFor` en la API). */
export function targetKindFor(kind: string): 'catalogItem' | 'module' | 'feature' | null {
  if (kind === 'api' || kind === 'service' || kind === 'database' || kind === 'resource') return 'catalogItem';
  if (kind === 'module') return 'module';
  if (kind === 'feature') return 'feature';
  return null;
}

/** Ruta de la revisión de un análisis. */
export const reviewPath = (appId: string, snapshotId: string) => `/apps/${appId}/sources/${snapshotId}`;

/** Commit corto. */
export const shortCommit = (commit: string) => commit.slice(0, 8);

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
