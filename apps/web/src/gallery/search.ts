export type FeatureSort = 'recent' | 'name';

/** Coincide sin distinguir mayúsculas ni tildes. */
export function matches(text: string, query: string) {
  const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  return fold(text).includes(fold(query.trim()));
}
