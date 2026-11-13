/** Rutas del espacio de trabajo. `/` es el lienzo (o la bienvenida); la lista de apps vive en `/apps`. */
export const APPS_PATH = '/apps';
export const appPath = (appId: string) => `/apps/${appId}`;
/** Mapa de la app (spec mapa-de-la-app): una vista adicional a la galería. */
export const mapPath = (appId: string) => `/apps/${appId}/map`;
export const featurePath = (appId: string, featureId: string) => `/apps/${appId}/features/${featureId}`;
/** Lienzo de un módulo compartido (spec modulos-compartidos): el mismo editor que una feature. */
export const modulePath = (appId: string, moduleId: string) => `/apps/${appId}/modules/${moduleId}`;

/**
 * De dónde se entró a un módulo y a qué volver (query de `modulePath`). `trail` es la entrada del lienzo de origen
 * cuando ese también es un módulo: así «Volver» funciona en cada nivel de módulos anidados.
 */
export interface ModuleEntry {
  /** Lienzo de origen (feature o módulo) y su caja del módulo, que se selecciona al volver. */
  from?: string;
  node?: string;
  /** Caja del módulo a enfocar (la de una interfaz) o a seleccionar al volver (con `keep`, sin mover la vista). */
  select?: string;
  keep?: boolean;
  /** Recorrido a reproducir al abrir (el interno de una interfaz, o el de fuera al volver) y desde qué paso. */
  play?: string;
  step?: number;
  /** Recorrido y paso del lienzo de origen al que volver. */
  returnTour?: string;
  returnStep?: number;
  /** Entrada del lienzo de origen, si también es un módulo. */
  trail?: ModuleEntry;
}

export function entryQuery(entry: ModuleEntry): string {
  const q = new URLSearchParams();
  if (entry.from) q.set('from', entry.from);
  if (entry.node) q.set('node', entry.node);
  if (entry.select) q.set('select', entry.select);
  if (entry.keep) q.set('keep', '1');
  if (entry.play) q.set('play', entry.play);
  if (entry.step !== undefined) q.set('step', String(entry.step));
  if (entry.returnTour) q.set('rt', entry.returnTour);
  if (entry.returnStep !== undefined) q.set('rs', String(entry.returnStep));
  if (entry.trail) q.set('trail', JSON.stringify(entry.trail));
  const query = q.toString();
  return query ? `?${query}` : '';
}

export function moduleEntryPath(appId: string, moduleId: string, entry: ModuleEntry): string {
  return modulePath(appId, moduleId) + entryQuery(entry);
}

const int = (value: string | null) => (value !== null && Number.isInteger(Number(value)) ? Number(value) : undefined);

export function readModuleEntry(search: URLSearchParams): ModuleEntry {
  let trail: ModuleEntry | undefined;
  try {
    const raw = search.get('trail');
    trail = raw ? (JSON.parse(raw) as ModuleEntry) : undefined;
  } catch {
    trail = undefined;
  }
  return {
    from: search.get('from') ?? undefined,
    node: search.get('node') ?? undefined,
    select: search.get('select') ?? undefined,
    keep: search.get('keep') === '1',
    play: search.get('play') ?? undefined,
    step: int(search.get('step')),
    returnTour: search.get('rt') ?? undefined,
    returnStep: int(search.get('rs')),
    trail,
  };
}

/** Lo de una entrada que importa para volver a ese lienzo más tarde (no lo que se enfocó o reprodujo al abrirlo). */
export function trailOf(entry: ModuleEntry): ModuleEntry | undefined {
  if (!entry.from) return undefined;
  return { from: entry.from, node: entry.node, returnTour: entry.returnTour, returnStep: entry.returnStep, trail: entry.trail };
}

/**
 * Volver al lienzo de origen con su contexto: la caja del módulo seleccionada sin mover la vista recordada (`keep`), el
 * recorrido en el mismo paso y, si el origen es otro módulo, su propia entrada (para seguir volviendo desde ahí).
 */
export function returnPath(appId: string, entry: ModuleEntry, fromIsModule: boolean): string | null {
  if (!entry.from) return null;
  const back: ModuleEntry = {
    ...(fromIsModule ? (entry.trail ?? {}) : {}),
    select: entry.node,
    keep: true,
    play: entry.returnTour,
    step: entry.returnStep,
  };
  if (fromIsModule) return moduleEntryPath(appId, entry.from, back);
  return featurePath(appId, entry.from) + entryQuery({ select: back.select, keep: true, play: back.play, step: back.step });
}
