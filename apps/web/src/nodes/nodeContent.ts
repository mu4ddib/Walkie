import type { Node } from '../schema/walkie-graph';

/** Inputs visibles dentro de la caja (spec panel-propiedades, criterio 8c). El resto, en el panel. */
export const MAX_VISIBLE_INPUTS = 5;
/** Líneas de la expresión de una regla visibles dentro de la caja (criterio 8c). */
export const MAX_VISIBLE_EXPRESSION_LINES = 3;

/** Primeros `max` elementos y cuántos quedan fuera. */
export function preview<T>(items: readonly T[], max: number): { shown: T[]; more: number } {
  return { shown: items.slice(0, max), more: Math.max(0, items.length - max) };
}

/** Líneas no vacías de la expresión, recortadas. */
export function expressionLines(expression: string | undefined): string[] {
  return (expression ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** `MÉTODO /ruta` de una API (criterio 6); `null` si no hay ninguno de los dos. */
export function httpLabel(http: Node['http']): string | null {
  const text = [http?.method, http?.path].filter(Boolean).join(' ');
  return text.length > 0 ? text : null;
}

/** Texto de "+N más". */
export function moreLabel(more: number): string {
  return `+${more} más`;
}
