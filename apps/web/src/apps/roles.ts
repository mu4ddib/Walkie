import type { AppRole } from '../api/client';

/** Del rol mayor al menor, como se ofrecen al elegir. */
export const ROLES: readonly AppRole[] = ['owner', 'editor', 'viewer'];

export const ROLE_LABELS: Record<AppRole, string> = {
  owner: 'Owner',
  editor: 'Editor',
  viewer: 'Viewer',
};

export const ROLE_HELP =
  'Viewer ve y exporta. Editor además crea y edita features, módulos, catálogo y lienzos. Owner además borra del catálogo y los módulos, comparte enlaces y administra miembros.';
