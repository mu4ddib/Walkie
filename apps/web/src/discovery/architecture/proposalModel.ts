import { v7 as uuidv7 } from 'uuid';
import type { ArchitectureProposal, DiscoveryOperation, DiscoveryReviewItem } from '../../api/client';
import type { CanvasInput } from '../initialCanvas';

/**
 * Qué hacer con una API del conjunto. `keep`: ya está en Walkie (vinculada o creada), no se toca. `choose`: nada elegido
 * todavía; la persona tiene que decidir antes de la vista previa (una coincidencia solo por título o varias candidatas).
 */
export type Choice = { op: 'link'; target: string } | { op: 'create'; id: string } | { op: 'omit' } | { op: 'keep' } | { op: 'choose' };

export const MAX_MEMBERS = 500;
const DECIDED = new Set(['linked', 'created', 'changed']);

/**
 * La elección inicial de una API, conservadora (spec walkie-live-arquitectura, revisión del PR B). Nada se aplica hasta
 * «Confirmar»:
 * - lo ya vinculado o creado se conserva (`keep`);
 * - lo descartado, lo que ya no aparece o no se pudo ver queda fuera (`omit`): nunca se reincorpora solo;
 * - varias candidatas o una coincidencia solo por título: ninguna elegida (`choose`). Dos APIs con el mismo nombre
 *   pueden tener contratos distintos; vincularlas es una decisión de la persona;
 * - una sola coincidencia por firma (método y ruta): se propone vincular (nunca una copia);
 * - lo nuevo se propone crear.
 */
export function initialChoice(item: DiscoveryReviewItem): Choice {
  if (DECIDED.has(item.status)) return { op: 'keep' };
  if (item.status === 'rejected' || item.status === 'missing' || item.status === 'unverified') return { op: 'omit' };
  if (item.candidates && item.candidates.length > 0) return { op: 'choose' };
  if (item.match?.reason === 'signature') return { op: 'link', target: `${item.match.target.kind}:${item.match.target.id}` };
  if (item.match) return { op: 'choose' };
  return { op: 'create', id: uuidv7() };
}

/** Qué entra y qué queda fuera con estas elecciones, para decirlo antes de la vista previa. */
export function choiceSummary(choices: Readonly<Record<string, Choice>>) {
  const values = Object.values(choices);
  const n = (op: Choice['op']) => values.filter((c) => c.op === op).length;
  return { keep: n('keep'), link: n('link'), create: n('create'), omit: n('omit'), choose: n('choose') };
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

/**
 * Si lo que se revisa es el conjunto entero de la propuesta (spec walkie-live-arquitectura, cierre del PR B): la lista de
 * miembros no está truncada (`memberCount`), cabe en una sola consulta y cada miembro pedido llegó en la respuesta. Si
 * no, la aplicación agrupada se bloquea: la API armaría la feature con todos sus miembros y la persona habría visto
 * menos.
 */
export function memberCoverage(
  proposal: Pick<ArchitectureProposal, 'members' | 'memberCount'>,
  items: readonly Pick<DiscoveryReviewItem, 'key'>[],
): { complete: true } | { complete: false; reason: 'truncated' | 'missing'; missing: string[] } {
  if (proposal.memberCount > proposal.members.length || proposal.members.length > MAX_MEMBERS) {
    return { complete: false, reason: 'truncated', missing: [] };
  }
  const received = new Set(items.map((i) => i.key));
  const missing = proposal.members.filter((m) => !received.has(m));
  return missing.length > 0 ? { complete: false, reason: 'missing', missing } : { complete: true };
}
