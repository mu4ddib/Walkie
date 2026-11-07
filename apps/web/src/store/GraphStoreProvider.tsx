import type { ReactNode } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import type { GraphStore } from './graphStore';
import { GraphStoreContext } from './graphStoreContext';

/** Da acceso al store del lienzo a nodos y conexiones (React Flow los renderiza sin props propias). */
export function GraphStoreProvider({ store, children }: { store: StoreApi<GraphStore>; children: ReactNode }) {
  return <GraphStoreContext.Provider value={store}>{children}</GraphStoreContext.Provider>;
}
