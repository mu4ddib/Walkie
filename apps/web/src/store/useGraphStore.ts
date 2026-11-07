import { useContext } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { GraphStore } from './graphStore';
import { GraphStoreContext } from './graphStoreContext';

export function useGraphStoreApi(): StoreApi<GraphStore> {
  const store = useContext(GraphStoreContext);
  if (!store) throw new Error('Falta <GraphStoreProvider> alrededor del lienzo.');
  return store;
}

/** Lee el store del lienzo del contexto. */
export function useGraphStore<T>(selector: (s: GraphStore) => T): T {
  return useStore(useGraphStoreApi(), selector);
}
