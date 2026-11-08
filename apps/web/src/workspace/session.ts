/**
 * Sesión del espacio de trabajo en este navegador (spec espacio-de-trabajo, decisión 1): última app y
 * feature, vista del lienzo por feature y si el inspector está plegado. Es preferencia local, no dato
 * compartido: si `localStorage` no está disponible (modo privado, bloqueado), todo sigue funcionando.
 */
export interface LastWorkspace {
  appId: string;
  featureId: string;
}

export interface SavedViewport {
  x: number;
  y: number;
  zoom: number;
}

const LAST = 'walkie.lastWorkspace';
const viewportKey = (featureId: string) => `walkie.viewport.${featureId}`;
const INSPECTOR = 'walkie.inspectorOpen';

function read<T>(key: string, valid: (value: unknown) => value is T): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    return valid(value) ? value : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Sin almacenamiento: la sesión simplemente no se recuerda.
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

export const getLastWorkspace = () =>
  read(LAST, (v): v is LastWorkspace => isRecord(v) && typeof v.appId === 'string' && typeof v.featureId === 'string');

export const setLastWorkspace = (value: LastWorkspace) => write(LAST, value);

export const forgetLastWorkspace = () => {
  try {
    localStorage.removeItem(LAST);
  } catch {
    // Nada que olvidar.
  }
};

export const getSavedViewport = (featureId: string) =>
  read(
    viewportKey(featureId),
    (v): v is SavedViewport =>
      isRecord(v) &&
      [v.x, v.y, v.zoom].every((n) => typeof n === 'number' && Number.isFinite(n)) &&
      (v.zoom as number) > 0,
  );

export const saveViewport = (featureId: string, viewport: SavedViewport) => write(viewportKey(featureId), viewport);

export const getInspectorOpen = () => read(INSPECTOR, (v): v is boolean => typeof v === 'boolean') ?? true;

export const setInspectorOpen = (open: boolean) => write(INSPECTOR, open);
