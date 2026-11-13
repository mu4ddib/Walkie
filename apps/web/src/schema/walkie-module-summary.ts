/* Generado desde packages/schema/walkie-module-summary.schema.json. No editar a mano: `pnpm gen:schema`. */

/**
 * Resumen de un módulo compartido (spec modulos-compartidos, ADR-0010): lo que una feature necesita para dibujar su caja y resolver sus interfaces sin cargar su lienzo. GET /api/apps/{appId}/modules devuelve un arreglo de estos.
 */
export interface WalkieModuleSummaryV0 {
  id: string;
  appId: string;
  name: string;
  description?: string;
  /**
   * Versión del lienzo del módulo (0: aún no se guardó)
   */
  version: number;
  /**
   * Cajas del lienzo del módulo
   */
  nodes?: number;
  /**
   * Interfaces del módulo, por nombre, con lo que se sabe de su caja interna
   */
  interfaces: Interface[];
  /**
   * Interfaces quitadas y adónde pasan sus conexiones (interfaceRedirects del lienzo del módulo); sin to, al módulo completo
   */
  redirects?: {
    from: string;
    to?: string;
  }[];
  /**
   * Módulos que contiene (nodos module de su lienzo)
   */
  modules: string[];
  /**
   * Features y módulos de la app cuyo lienzo guardado lo referencia
   */
  usedBy: string[];
}
export interface Interface {
  id: string;
  name: string;
  description?: string;
  kind: 'provides' | 'event' | 'requires';
  nodeId: string;
  /**
   * Tipo con el que se comporta su caja interna (un ref, el de su elemento del catálogo); falta si la caja ya no existe
   */
  nodeType?: 'actor' | 'screen' | 'rule' | 'api' | 'service' | 'database' | 'resource' | 'ref' | 'portal' | 'module';
  nodeTitle?: string;
  /**
   * Del contrato de su caja (api o ref a una api)
   */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path?: string;
  /**
   * Recorrido interno de la interfaz
   */
  tourId?: string;
  tourName?: string;
}
