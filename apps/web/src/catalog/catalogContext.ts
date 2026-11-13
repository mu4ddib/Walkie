import { createContext, useContext } from 'react';
import type { CatalogItem, Feature, ModuleInterfaceSummary, ModuleSummary, NewCatalogItem } from '../api/client';
import type { InterfaceRef, Node } from '../schema/walkie-graph';
import type { NodeType } from '../store/graphStore';

/**
 * Catálogo de la app visto desde un lienzo: los nodos `ref` se dibujan con los datos actuales
 * del elemento (spec catalogo, criterio 7). Crear o editar un componente va directo a la API (`createItem`,
 * inspector de un `ref`), aparte del guardado del lienzo.
 */
export interface CanvasCatalog {
  appId: string;
  items: Record<string, CatalogItem>;
  /** Features de la app (destinos de los `portal`) y la del lienzo actual. */
  features?: Record<string, Feature>;
  featureId?: string;
  /**
   * Vista de un enlace de solo lectura (spec enlace-solo-lectura, ADR-0005): el lienzo no se edita, los
   * portales no se abren (la otra feature no está compartida) y las imágenes se piden con el token del enlace.
   */
  share?: { token: string };
  /** Crea un componente en el catálogo de la app (panel "Componentes"); sin él, el panel no ofrece crear. */
  createItem?: (item: NewCatalogItem) => Promise<CatalogItem>;
  /**
   * Módulos compartidos de la app (spec modulos-compartidos), por id: el resumen que dibuja sus cajas y resuelve sus
   * interfaces (una sola consulta para todas). Sin él (enlace de solo lectura), una caja de módulo muestra su título.
   */
  modules?: Record<string, ModuleSummary>;
  /** El lienzo abierto es el de este módulo (no se ofrece meterlo dentro de sí mismo ni de lo que lo contiene). */
  currentModuleId?: string;
  /** Crea un módulo vacío (panel del catálogo); devuelve su resumen. */
  createModule?: (module: { name: string; description?: string }) => Promise<ModuleSummary>;
}

export interface OpenModuleOptions {
  /** Caja de este lienzo desde la que se abre (se selecciona al volver). */
  nodeId?: string;
  /** Caja del módulo a enfocar (la de una interfaz). */
  focus?: string;
  /** Recorrido interno a reproducir al abrir, y el paso del recorrido de fuera al que volver. */
  play?: { tourId: string; returnTour: string; returnStep: number };
}

export const CatalogContext = createContext<CanvasCatalog>({ appId: '', items: {} });

export function useCanvasCatalog(): CanvasCatalog {
  return useContext(CatalogContext);
}

/** Catálogo (y features de la app) indexados por id. */
export function toCanvasCatalog(
  appId: string,
  items: readonly CatalogItem[],
  features: readonly Feature[] = [],
  featureId?: string,
): CanvasCatalog {
  return {
    appId,
    items: Object.fromEntries(items.map((i) => [i.id, i])),
    features: Object.fromEntries(features.map((f) => [f.id, f])),
    featureId,
  };
}

/** Feature a la que lleva un `portal`; `undefined` si no tiene destino o ya no existe. */
export function portalTarget(node: Node, features: Record<string, Feature> | undefined): Feature | undefined {
  return node.type === 'portal' && node.targetFeatureId ? features?.[node.targetFeatureId] : undefined;
}

/** Módulo al que apunta una caja de módulo; `undefined` si no lo es o el módulo ya no existe (o no se conoce). */
export function moduleTarget(node: Node, modules: Record<string, ModuleSummary> | undefined): ModuleSummary | undefined {
  return node.type === 'module' && node.moduleId ? modules?.[node.moduleId] : undefined;
}

/** La interfaz a la que apunta un extremo de conexión en el módulo; `undefined` si es el módulo completo o ya no existe. */
export function interfaceTarget(
  node: Node | undefined,
  ref: InterfaceRef | undefined,
  modules: Record<string, ModuleSummary> | undefined,
): ModuleInterfaceSummary | undefined {
  if (!node || !ref) return undefined;
  return moduleTarget(node, modules)?.interfaces.find((i) => i.id === ref.id);
}

/**
 * Tipo con el que se comporta el extremo de una conexión: en un módulo, el de la caja interna de su interfaz (una API
 * ofrecida se llama con `request`); el módulo completo actúa como un servicio.
 */
export function endType(
  node: Node,
  ref: InterfaceRef | undefined,
  items: Record<string, CatalogItem>,
  modules: Record<string, ModuleSummary> | undefined,
): NodeType {
  if (node.type !== 'module') return effectiveType(node, items);
  const type = interfaceTarget(node, ref, modules)?.nodeType;
  return type && type !== 'module' && type !== 'ref' ? type : 'service';
}

/** Elemento al que apunta un `ref`; `undefined` si el nodo no es `ref` o el elemento ya no existe. */
export function refTarget(node: Node, items: Record<string, CatalogItem>): CatalogItem | undefined {
  return node.type === 'ref' && node.catalogId ? items[node.catalogId] : undefined;
}

/** Recurso con el que se comporta un nodo (el de su elemento si es un `ref`; spec nodos-de-infraestructura). */
export function effectiveResource(node: Node, items: Record<string, CatalogItem>): Node['resource'] {
  return refTarget(node, items)?.resource ?? node.resource;
}

/** Tipo con el que se comporta un nodo: un `ref` actúa como su elemento (criterio 9). */
export function effectiveType(node: Node, items: Record<string, CatalogItem>): NodeType {
  return refTarget(node, items)?.type ?? node.type;
}
