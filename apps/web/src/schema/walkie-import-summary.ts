/* Generado desde packages/schema/walkie-import-summary.schema.json. No editar a mano: `pnpm gen:schema`. */

/**
 * Respuesta de POST /api/apps/{appId}/import (features en una app) y de POST /api/apps/import (una app nueva) (spec exportar-e-importar, tareas 6 y 7; ADR-0009): lo que creó la importación de un archivo .walkie o, con dryRun, lo que crearía. Los errores van aparte, como ProblemDetails con la ruta dentro del archivo.
 */
export interface WalkieImportSummaryV0 {
  /**
   * true: solo se validó; no se creó nada
   */
  dryRun: boolean;
  /**
   * Solo al importar una app (POST /api/apps/import): la app nueva
   */
  app?: {
    /**
     * Nombre en el archivo
     */
    sourceName: string;
    /**
     * Nombre de la app nueva: el mismo o con «(importada)» si ya hay una con ese nombre
     */
    name: string;
    /**
     * Id de la app creada (no viene con dryRun)
     */
    id?: string;
  };
  features: {
    /**
     * Nombre en el archivo
     */
    sourceName: string;
    /**
     * Nombre en la app: el mismo o con «(importada)», «(importada 2)»… si ya existe
     */
    name: string;
    /**
     * Id de la feature creada (no viene con dryRun)
     */
    id?: string;
  }[];
  /**
   * Elementos del catálogo que se crean (con id nuevo)
   */
  newCatalogItems: number;
  /**
   * Elementos que ya estaban en la app (mismo id) y se reutilizan
   */
  existingCatalogItems: number;
  /**
   * Imágenes de pantallas que se suben
   */
  images: number;
  /**
   * Lo que no se pudo conservar tal cual (un portal sin destino, una pantalla sin imagen, una descripción recortada)
   */
  warnings: string[];
}
