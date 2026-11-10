import type { MapFeatureSummary } from './FeatureMapNode';

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Lo que tiene la feature, en pocas palabras: «2 pantallas · 1 API · 1 recorrido». */
export function contentsOf(s: MapFeatureSummary): string {
  const parts = [
    s.screens && plural(s.screens, 'pantalla', 'pantallas'),
    s.apis && plural(s.apis, 'API', 'APIs'),
    s.tours && plural(s.tours, 'tour', 'tours'),
    s.flows && plural(s.flows, 'recorrido', 'recorridos'),
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Lienzo vacío';
}

export type MapSelection = { kind: 'feature' | 'link' | 'catalog'; id: string };

/** Clave de una conexión del mapa (origen → destino). */
export const linkKey = (from: string, to: string) => `${from}>${to}`;
