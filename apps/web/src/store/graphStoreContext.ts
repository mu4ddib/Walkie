import { createContext } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import type { GraphStore } from './graphStore';

export const GraphStoreContext = createContext<StoreApi<GraphStore> | null>(null);
