/* Generado desde packages/schema/walkie-package.schema.json. No editar a mano: `pnpm gen:schema`. */

/**
 * manifest.json de un archivo .walkie (spec exportar-e-importar, tareas 5 a 7): un .zip que reconstruye una o varias features en otra app (o en la misma). Lista qué hay en el archivo y dónde: el lienzo de cada feature (features/<id>/canvas.json, según walkie-graph), los elementos del catálogo que usan (catalog.json, cada uno según walkie-catalog-item), las imágenes de sus pantallas (img/) y, en el de una app, la distribución del mapa (map.json).
 */
export interface WalkiePackageManifestV0 {
  format: 'walkie-package';
  /**
   * Versión de este formato de archivo; un archivo de una versión que la API no conoce se rechaza
   */
  formatVersion: 0;
  /**
   * schemaVersion de walkie-graph de los lienzos que trae
   */
  schemaVersion: number;
  exportedAt: string;
  /**
   * Qué se exportó: una feature o la app completa (sin él, feature)
   */
  scope?: 'feature' | 'app';
  /**
   * La app de origen (al importar en otra app, solo informativa)
   */
  app: {
    id: string;
    name: string;
  };
  /**
   * @minItems 1
   */
  features: [
    {
      /**
       * Id en la app de origen (los portales entre features del archivo lo usan)
       */
      id: string;
      name: string;
      description?: string;
      /**
       * Ruta del lienzo en el archivo, ej. features/<id>/canvas.json
       */
      canvas: string;
      /**
       * Versión del lienzo exportado (al importar empieza de nuevo)
       */
      canvasVersion: number;
    },
    ...{
      /**
       * Id en la app de origen (los portales entre features del archivo lo usan)
       */
      id: string;
      name: string;
      description?: string;
      /**
       * Ruta del lienzo en el archivo, ej. features/<id>/canvas.json
       */
      canvas: string;
      /**
       * Versión del lienzo exportado (al importar empieza de nuevo)
       */
      canvasVersion: number;
    }[]
  ];
  catalog: {
    /**
     * Arreglo de elementos del catálogo (walkie-catalog-item) que usan los lienzos del archivo
     */
    path: 'catalog.json';
    count: number;
  };
  /**
   * Solo en un archivo de la app (scope app) cuya distribución del mapa se acomodó: dónde están las posiciones
   */
  map?: {
    /**
     * Objeto positions de walkie-app-map ($defs/layout): id de feature o catalog:<id> -> { x, y }, con los ids de la app de origen
     */
    path: 'map.json';
  };
  /**
   * Imágenes de las pantallas: una por asset, aunque varias pantallas la usen
   */
  images: {
    /**
     * Id en la app de origen (el assetId de las pantallas)
     */
    assetId: string;
    /**
     * Ruta en el archivo, ej. img/<assetId>.png
     */
    path: string;
    contentType: 'image/png' | 'image/jpeg' | 'image/webp';
  }[];
}
