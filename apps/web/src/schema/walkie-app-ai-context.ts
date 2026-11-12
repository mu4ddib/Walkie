/* Generado desde packages/schema/walkie-app-ai-context.schema.json. No editar a mano: `pnpm gen:schema`. */
import type {Database, Http, Resource} from './walkie-graph';
import type {WalkieAIContextV0} from './walkie-ai-context';

/**
 * Contexto de una app completa para darle a una IA (spec exportar-e-importar, tarea 2): el contexto de cada feature (walkie-ai-context), el catálogo compartido con dónde se usa, el mapa de la app (qué feature lleva a cuál) y los vacíos de todo. Lo genera la API desde la última versión guardada de cada lienzo.
 */
export interface WalkieAppAIContextV0 {
  format: 'walkie-app-ai-context';
  formatVersion: 0;
  app: {
    id: string;
    name: string;
  };
  exportedAt: string;
  /**
   * El contexto de cada feature, por nombre
   */
  features: WalkieAIContextV0[];
  /**
   * Componentes compartidos de la app (definición única para todos los lienzos que los usan)
   */
  catalog: {
    id: string;
    type: 'api' | 'service' | 'database' | 'resource';
    /**
     * Qué es, en palabras (en un recurso, su subtipo)
     */
    is: string;
    title: string;
    description?: string;
    http?: Http;
    database?: Database;
    resource?: Resource;
    /**
     * Dónde corre un servicio: contenedor, máquina virtual, serverless, servicio gestionado u otro
     */
    runtime?: 'container' | 'vm' | 'serverless' | 'managed' | 'other';
    /**
     * Nombres de las features cuyos lienzos lo usan
     */
    usedBy: string[];
  }[];
  map: {
    /**
     * Qué feature lleva a cuál, por los portales de sus lienzos
     */
    links: {
      /**
       * Feature de origen
       */
      from: string;
      /**
       * Feature destino
       */
      to: string;
      /**
       * Título del portal
       */
      via: string;
    }[];
  };
  /**
   * Vacíos de todas las features (con su feature) y del catálogo (componentes que ningún lienzo usa)
   */
  gaps: {
    /**
     * Feature a la que pertenece; sin ella, es del catálogo
     */
    feature?: string;
    /**
     * Los de walkie-ai-context más unused-catalog-item
     */
    kind: string;
    elementId?: string;
    message: string;
  }[];
}
