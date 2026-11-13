/** Ruta pública de un enlace de solo lectura (ADR-0005): se abre sin sesión. */
export const SHARED_PATH = '/s/:token';

/** Un módulo que usa la feature del enlace (spec modulos-compartidos), también de solo lectura y sin sesión. */
export const SHARED_MODULE_PATH = '/s/:token/modules/:moduleId';

export const sharedPath = (token: string) => `/s/${token}`;
export const sharedModulePath = (token: string, moduleId: string) => `/s/${token}/modules/${moduleId}`;
