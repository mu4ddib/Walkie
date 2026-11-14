/**
 * Identidad estable de los nodos y conexiones que se pasan a React Flow (revisión de fluidez). `Canvas` reconstruye
 * las listas desde el store en cada cambio; si cada objeto es nuevo, React Flow vuelve a dibujar todas las cajas y
 * conexiones aunque solo una haya cambiado (al escribir en el inspector, al arrastrar o al seleccionar). Esta caché
 * devuelve el objeto anterior cuando el nuevo es equivalente, así solo se dibuja lo que cambió.
 *
 * Equivalente: mismos valores, comparando objetos y listas por contenido (son pequeños: posición, medidas, datos de
 * la etiqueta, puertos, trazo) y los objetos del grafo por referencia primero (el store solo los cambia si cambian).
 * Dos funciones se consideran iguales: las que se pasan en `data` se derivan de los demás datos del mismo elemento, que
 * sí se comparan; si cambian esos datos, el objeto se renueva con sus funciones nuevas.
 */

export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'function' && typeof b === 'function') return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameValue(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  if (a instanceof Set || b instanceof Set || a instanceof Map || b instanceof Map) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

/** Caché por id: `reuse` devuelve la lista nueva con los objetos anteriores donde no cambió nada. */
export class StableElements<T extends { id: string }> {
  private previous = new Map<string, T>();

  private list: T[] = [];
  /** Ids que se renovaron en el último `reuse` (para pruebas y diagnóstico). */
  changed: string[] = [];

  /**
   * La lista nueva con los objetos anteriores donde no cambió nada. Si no cambió ninguno (ni el orden ni la cantidad),
   * la misma lista anterior: así React Flow no procesa una actualización (que recorre todas sus suscripciones).
   */
  reuse(next: T[]): T[] {
    const map = new Map<string, T>();
    const changed: string[] = [];
    let sameOrder = next.length === this.list.length;
    const list = next.map((item, i) => {
      const old = this.previous.get(item.id);
      const kept = old && sameValue(old, item) ? old : item;
      if (kept !== old) changed.push(item.id);
      if (sameOrder && this.list[i] !== kept) sameOrder = false;
      map.set(item.id, kept);
      return kept;
    });
    this.previous = map;
    this.changed = changed;
    if (!sameOrder) this.list = list;
    return this.list;
  }
}

/**
 * Valor que se recalcula solo si cambia su clave (una firma barata de lo que de verdad lo determina). Sirve cuando las
 * referencias cambian más seguido que el contenido que importa: ej. la jerarquía de grupos no cambia al escribir la
 * descripción de una caja, aunque el mapa de nodos sea otro.
 */
export class KeyedValue<T> {
  private key: string | null = null;
  private value: T | undefined;

  get(key: string, make: () => T): T {
    if (key !== this.key || this.value === undefined) {
      this.key = key;
      this.value = make();
    }
    return this.value;
  }
}
