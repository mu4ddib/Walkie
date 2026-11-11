import type { Tour } from '../schema/walkie-graph';

type Step = Tour['steps'][number];

function content(step: Step | undefined): Step | undefined {
  if (!step) return step;
  const copy = { ...step };
  delete copy.id;
  return copy;
}

/** Pasos sin su `id` (spec tours-compactos): las pruebas comparan lo que el paso señala y su nota. */
export function withoutIds(steps: readonly Step[] | undefined): (Step | undefined)[] | undefined;
export function withoutIds(step: Step | undefined): Step | undefined;
export function withoutIds(value: readonly Step[] | Step | undefined) {
  return Array.isArray(value) ? value.map(content) : content(value as Step | undefined);
}
