/** Rutas del espacio de trabajo. `/` es el lienzo (o la bienvenida); la lista de apps vive en `/apps`. */
export const APPS_PATH = '/apps';
export const appPath = (appId: string) => `/apps/${appId}`;
/** Mapa de la app (spec mapa-de-la-app): una vista adicional a la galería. */
export const mapPath = (appId: string) => `/apps/${appId}/map`;
export const featurePath = (appId: string, featureId: string) => `/apps/${appId}/features/${featureId}`;
/** Lienzo de un módulo compartido (spec modulos-compartidos): el mismo editor que una feature. */
export const modulePath = (appId: string, moduleId: string) => `/apps/${appId}/modules/${moduleId}`;

/** De dónde se entró a un módulo y a qué volver (query de `modulePath`). */
export interface ModuleEntry {
  /** Lienzo de origen (feature o módulo) y su caja del módulo, que se selecciona al volver. */
  from?: string;
  node?: string;
  /** Caja del módulo a enfocar (la de una interfaz). */
  select?: string;
  /** Recorrido interno a reproducir y el paso del recorrido de fuera al que volver. */
  play?: string;
  returnTour?: string;
  returnStep?: number;
}

export function moduleEntryPath(appId: string, moduleId: string, entry: ModuleEntry): string {
  const q = new URLSearchParams();
  if (entry.from) q.set('from', entry.from);
  if (entry.node) q.set('node', entry.node);
  if (entry.select) q.set('select', entry.select);
  if (entry.play) q.set('play', entry.play);
  if (entry.returnTour) q.set('rt', entry.returnTour);
  if (entry.returnStep !== undefined) q.set('rs', String(entry.returnStep));
  const query = q.toString();
  return modulePath(appId, moduleId) + (query ? `?${query}` : '');
}

export function readModuleEntry(search: URLSearchParams): ModuleEntry {
  const step = search.get('rs');
  return {
    from: search.get('from') ?? undefined,
    node: search.get('node') ?? undefined,
    select: search.get('select') ?? undefined,
    play: search.get('play') ?? undefined,
    returnTour: search.get('rt') ?? undefined,
    returnStep: step !== null && Number.isInteger(Number(step)) ? Number(step) : undefined,
  };
}

/**
 * Volver al lienzo de origen con su contexto: la caja del módulo seleccionada sin mover la vista recordada (`keep`) y,
 * si se venía de un recorrido, en el mismo paso.
 */
export function returnPath(appId: string, entry: ModuleEntry, fromIsModule: boolean): string | null {
  if (!entry.from) return null;
  const q = new URLSearchParams();
  if (entry.node) q.set('select', entry.node);
  q.set('keep', '1');
  if (entry.returnTour) q.set('play', entry.returnTour);
  if (entry.returnStep !== undefined) q.set('step', String(entry.returnStep));
  return (fromIsModule ? modulePath(appId, entry.from) : featurePath(appId, entry.from)) + `?${q.toString()}`;
}
