/** Rutas del espacio de trabajo. `/` es el lienzo (o la bienvenida); la lista de apps vive en `/apps`. */
export const APPS_PATH = '/apps';
export const appPath = (appId: string) => `/apps/${appId}`;
export const featurePath = (appId: string, featureId: string) => `/apps/${appId}/features/${featureId}`;
