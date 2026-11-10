/** Rutas del espacio de trabajo. `/` es el lienzo (o la bienvenida); la lista de apps vive en `/apps`. */
export const APPS_PATH = '/apps';
export const appPath = (appId: string) => `/apps/${appId}`;
/** Mapa de la app (spec mapa-de-la-app): una vista adicional a la galería. */
export const mapPath = (appId: string) => `/apps/${appId}/map`;
export const featurePath = (appId: string, featureId: string) => `/apps/${appId}/features/${featureId}`;
