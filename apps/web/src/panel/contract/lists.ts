/** Reemplaza el elemento `index` de la lista. */
export function replaceAt<T>(list: readonly T[], index: number, next: T): T[] {
  return list.map((item, i) => (i === index ? next : item));
}

/** La lista sin el elemento `index`. */
export function removeAt<T>(list: readonly T[], index: number): T[] {
  return list.filter((_, i) => i !== index);
}
