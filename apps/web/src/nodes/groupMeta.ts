import type { GroupKind } from '../store/graphStore';

/** Etiqueta y color de cada tipo de grupo de infraestructura (spec espacio-de-trabajo, criterio 18). */
export const GROUP_LABELS: Record<GroupKind, string> = {
  frontend: 'Frontend',
  backend: 'Backend',
  external: 'Externos',
  data: 'Datos',
  network: 'Red',
  environment: 'Entorno',
  cloud: 'Cloud',
  custom: 'Libre',
};

export const GROUP_COLORS: Record<GroupKind, string> = {
  frontend: '#3a70c0',
  backend: '#3f8358',
  external: '#857867',
  data: '#4d6485',
  network: '#b58316',
  environment: '#7d55b8',
  cloud: '#2d7f8f',
  custom: '#a9581a',
};

/** Caja de un grupo plegado. */
export const COLLAPSED_GROUP = { width: 232, height: 72 } as const;
