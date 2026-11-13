import type { ModuleInterfaceSummary, ModuleSummary } from '../api/client';
import { resolveInterface } from '../catalog/catalogContext';
import type { Edge } from '../schema/walkie-graph';
import type { InterfaceKind } from '../store/graphStore';

/** Ancho mínimo de la caja de un módulo (múltiplo de la grilla). */
export const MODULE_MIN_WIDTH = 208;

const KIND_LABELS: Record<InterfaceKind, string> = {
  provides: 'Ofrece',
  event: 'Evento',
  requires: 'Requiere',
};

const KIND_HELP: Record<InterfaceKind, string> = {
  provides: 'API u operación que el módulo ofrece: las features la llaman.',
  event: 'Evento que el módulo emite o recibe.',
  requires: 'Dependencia externa: algo de fuera que el módulo necesita (ej. una base de datos de otra feature).',
};

export function interfaceKindLabel(kind: InterfaceKind): string {
  return KIND_LABELS[kind];
}

export function interfaceKindHelp(kind: InterfaceKind): string {
  return KIND_HELP[kind];
}

/** Lo que distingue una interfaz al elegirla: `GET /usuarios/{id}` o el título de su caja. */
export function interfaceSignature(iface: Pick<ModuleInterfaceSummary, 'method' | 'path' | 'nodeTitle'>): string {
  const http = [iface.method, iface.path].filter(Boolean).join(' ');
  return http || iface.nodeTitle || '';
}

/**
 * Interfaces que usan las conexiones de la caja `nodeId`, sin repetir, como JSON `{ id, name }` (texto: así un selector
 * del store compara por valor y la caja solo se vuelve a dibujar si cambian).
 */
export function usedInterfaces(edges: Record<string, Edge>, nodeId: string): string[] {
  const seen = new Map<string, string>();
  for (const edge of Object.values(edges)) {
    if (edge.from === nodeId && edge.fromInterface && !seen.has(edge.fromInterface.id)) {
      seen.set(edge.fromInterface.id, JSON.stringify(edge.fromInterface));
    }
    if (edge.to === nodeId && edge.toInterface && !seen.has(edge.toInterface.id)) {
      seen.set(edge.toInterface.id, JSON.stringify(edge.toInterface));
    }
  }
  return [...seen.values()].sort();
}

/**
 * Interfaces que se ofrecen al conectar un extremo: hacia el módulo (`to`) primero lo que ofrece y sus eventos; desde
 * el módulo (`from`), sus dependencias y eventos. Las demás van después (un diagrama puede necesitarlas).
 */
export function interfacesForEnd(summary: ModuleSummary, end: 'from' | 'to'): ModuleInterfaceSummary[] {
  const first: InterfaceKind[] = end === 'to' ? ['provides', 'event'] : ['requires', 'event'];
  const rank = (i: ModuleInterfaceSummary) => (first.includes(i.kind) ? 0 : 1);
  return [...summary.interfaces].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'es'));
}

/** Busca por nombre, descripción, método, ruta o título de su caja (sin distinguir mayúsculas ni acentos). */
export function matchesInterface(iface: ModuleInterfaceSummary, query: string): boolean {
  const q = fold(query.trim());
  if (!q) return true;
  return [iface.name, iface.description, iface.method, iface.path, iface.nodeTitle].some((t) => t && fold(t).includes(q));
}

export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/**
 * Módulos que se pueden poner en este lienzo: en el de un módulo, ni él mismo ni los que lo contienen (directa o
 * indirectamente), que formarían un ciclo de contención.
 */
export function placeableModules(modules: Record<string, ModuleSummary>, currentModuleId?: string): ModuleSummary[] {
  const all = Object.values(modules);
  if (!currentModuleId) return all;
  const containers = new Set<string>([currentModuleId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const m of all) {
      if (!containers.has(m.id) && m.modules.some((inner) => containers.has(inner))) {
        containers.add(m.id);
        grew = true;
      }
    }
  }
  return all.filter((m) => !containers.has(m.id));
}

/** Una interfaz usada en un lienzo, ya resuelta: la actual (con su punto en la caja) o la que quedó pendiente. */
export type ResolvedUse = { key: string; iface: ModuleInterfaceSummary } | { key: string; pending: string };

/** Máximo de interfaces usadas que muestra la caja (cada una con su punto de conexión); el resto, en el inspector. */
export const MAX_BOX_INTERFACES = 4;

/**
 * Las interfaces usadas por las conexiones de una caja (JSON de `usedInterfaces`), resueltas con las redirecciones del
 * módulo: sin repetir, las que pasaron al módulo completo fuera y las pendientes al final.
 */
export function resolvedUses(summary: ModuleSummary, usedKey: string): ResolvedUse[] {
  const refs = usedKey ? usedKey.split('\n').map((pair) => JSON.parse(pair) as { id: string; name: string }) : [];
  const ok = new Map<string, ResolvedUse>();
  const pending: ResolvedUse[] = [];
  for (const ref of refs) {
    const r = resolveInterface(summary, ref);
    if (r.status === 'ok' && !ok.has(r.iface.id)) ok.set(r.iface.id, { key: r.iface.id, iface: r.iface });
    if (r.status === 'pending') pending.push({ key: ref.id, pending: r.name });
  }
  return [...[...ok.values()].sort((a, b) => ('iface' in a && 'iface' in b ? a.iface.name.localeCompare(b.iface.name, 'es') : 0)), ...pending];
}

/** Id del punto de conexión de una interfaz en la caja (llega por la izquierda, sale por la derecha). */
export const interfaceHandle = (interfaceId: string, out = false) => `iface:${interfaceId}${out ? ':out' : ''}`;

/** La interfaz de un punto de conexión de la caja, o `null` si es un punto de la caja entera. */
export function interfaceOfHandle(handle: string | null | undefined): string | null {
  if (!handle?.startsWith('iface:')) return null;
  return handle.slice('iface:'.length).replace(/:out$/, '');
}
