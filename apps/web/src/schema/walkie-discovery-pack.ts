/* Generado desde packages/schema/walkie-discovery-pack.schema.json. No editar a mano: `pnpm gen:schema`. */

/**
 * Patrón relativo a la raíz del proyecto, con /
 */
export type Glob = string;

/**
 * manifest.json de un .walkiepack (spec walkie-live, ADR-0013): un .zip que genera el CLI de Walkie al analizar un proyecto local de forma estática. Junto al manifest va discovery.json (walkie-discovery.schema.json: entidades, relaciones y evidencia). Nunca lleva rutas absolutas ni contenido de archivos de secretos; los fragmentos de código solo con includeSnippets. La integridad que el schema no expresa (claves únicas, evidencia y extremos que existen, stats coherentes) la valida la API al recibirlo.
 */
export interface WalkieDiscoveryPackManifestV0 {
  format: 'walkiepack';
  /**
   * Versión de este formato; un paquete de una versión que la API no conoce se rechaza con un mensaje propio
   */
  formatVersion: 0;
  /**
   * schemaVersion de walkie-graph del que salen los $defs que usan las entidades (http, database, resource, runtime)
   */
  schemaVersion: number;
  /**
   * Única fecha del paquete: las entidades no llevan fechas, así el mismo árbol da el mismo contenido
   */
  createdAt: string;
  analyzer: {
    /**
     * Ej. walkie-cli
     */
    name: string;
    /**
     * SemVer del analizador
     */
    version: string;
  };
  /**
   * El proyecto analizado. El id lo crea el CLI una vez y lo guarda en .walkie/source.json del proyecto: reanalizar apunta a la misma fuente
   */
  source: {
    id: string;
    /**
     * Nombre del proyecto (por defecto, el de su carpeta), nunca su ruta
     */
    name: string;
  };
  /**
   * Estado del control de versiones al analizar, si lo hay (leído de los archivos de .git, sin ejecutar git)
   */
  vcs?: {
    kind: 'git';
    commit: string;
    branch?: string;
    /**
     * Hay cambios sin confirmar (si se pudo saber)
     */
    dirty?: boolean;
  };
  /**
   * Qué se miró: rutas relativas (globs) incluidas y excluidas y los detectores que corrieron
   */
  scope: {
    include: Glob[];
    exclude: Glob[];
    detectors: {
      /**
       * Detector que produjo el hallazgo (ej. openapi, compose, csproj, package-json, aspnetcore-endpoints, efcore, react-router, angular-router)
       */
      id: string;
      version: string;
    }[];
  };
  /**
   * Tecnologías detectadas (lenguajes, frameworks, motores), para mostrarlas antes de confirmar
   */
  technologies: {
    /**
     * Ej. dotnet, aspnetcore, efcore, react, angular, postgresql
     */
    id: string;
    name: string;
    version?: string;
    /**
     * @minItems 1
     *
     * Items: Id de una evidencia en este archivo (el CLI lo deriva del contenido, ej. un hash corto)
     */
    evidence: [string, ...string[]];
  }[];
  /**
   * Lo que el análisis no pudo resolver o no miró (ej. una ruta construida en tiempo de ejecución); se muestra antes de confirmar en vez de adivinar
   */
  limitations: {
    /**
     * Ej. dynamic-route, unparsed-file, unsupported-technology, file-too-large
     */
    code: string;
    message: string;
    /**
     * Detector que produjo el hallazgo (ej. openapi, compose, csproj, package-json, aspnetcore-endpoints, efcore, react-router, angular-router)
     */
    detector?: string;
    /**
     * Ruta relativa a la raíz del proyecto, con /: nunca absoluta, sin .. ni \
     */
    path?: string;
  }[];
  stats: {
    /**
     * Archivos leídos
     */
    files: number;
    entities: number;
    relations: number;
    evidence: number;
  };
  /**
   * Si la evidencia trae fragmentos de código (--include-snippets). Sin él, ninguna evidencia lleva snippet
   */
  includeSnippets: boolean;
}
