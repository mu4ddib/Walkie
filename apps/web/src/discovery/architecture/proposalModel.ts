import { v7 as uuidv7 } from 'uuid';
import type { ArchitectureProposal, DiscoveryOperation, DiscoveryReviewItem } from '../../api/client';
import type { CanvasInput } from '../initialCanvas';

/** Qué hacer con una API del conjunto. `keep`: ya está en Walkie (vinculada o creada), no se toca. */
export type Choice = { op: 'link'; target: string } | { op: 'create'; id: string } | { op: 'omit' } | { op: 'keep' };

export const MAX_MEMBERS = 500;
const DECIDED = new Set(['linked', 'created', 'changed']);

/**
 * La elección inicial de una API, conservadora (spec walkie-live-arquitectura, tarea 9): lo ya decidido se conserva; una
 * sola coincidencia se propone vincular (nunca se reemplaza por una copia); con varias candidatas no se elige ninguna; lo
 * nuevo se propone crear. Lo descartado queda fuera. Nada se aplica hasta «Confirmar».
 */
export function initialChoice(item: DiscoveryReviewItem): Choice {
  if (DECIDED.has(item.status)) return { op: 'keep' };
  if (item.status === 'rejected' || item.status === 'missing' || item.status === 'unverified') return { op: 'omit' };
  if (item.candidates && item.candidates.length > 0) return { op: 'omit' };
  if (item.match) return { op: 'link', target: `${item.match.target.kind}:${item.match.target.id}` };
  return { op: 'create', id: uuidv7() };
}

/** Las operaciones de una sola aplicación: vínculos y APIs nuevas primero (el lienzo las referencia), la feature al final. */
export function proposalOperations(
  proposal: ArchitectureProposal,
  items: readonly DiscoveryReviewItem[],
  choices: Readonly<Record<string, Choice>>,
  feature: { id: string; name?: string; canvas?: CanvasInput },
): DiscoveryOperation[] {
  const ops: DiscoveryOperation[] = [];
  for (const item of items) {
    const choice = choices[item.key];
    const version = item.binding?.version ?? 0;
    if (choice?.op === 'link') {
      const [kind, ...rest] = choice.target.split(':');
      ops.push({ op: 'link', entityKey: item.key, target: { kind: kind as 'catalogItem', id: rest.join(':') }, bindingVersion: version });
    } else if (choice?.op === 'create') {
      ops.push({ op: 'create', entityKey: item.key, id: choice.id, bindingVersion: version });
    }
  }
  ops.push({
    op: 'create',
    entityKey: proposal.key,
    id: feature.id,
    bindingVersion: 0,
    ...(feature.name ? { name: feature.name } : {}),
    ...(feature.canvas ? { canvas: feature.canvas } : {}),
  });
  return ops;
}
