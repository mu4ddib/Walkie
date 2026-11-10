import type { EdgeTypes, NodeTypes } from '@xyflow/react';
import { CatalogMapNode } from './CatalogMapNode';
import { FeatureMapNode } from './FeatureMapNode';
import { MapEdge } from './MapEdge';

/** Tipos de nodo y de conexión del mapa de la app (fuera del componente: React Flow los compara por referencia). */
export const mapNodeTypes: NodeTypes = { feature: FeatureMapNode, catalog: CatalogMapNode };
export const mapEdgeTypes: EdgeTypes = { map: MapEdge };
