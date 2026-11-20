/* Generado desde packages/schema/walkie-discovery-pack.schema.json. No editar a mano: `pnpm gen:schema`. */

/**
 * Patrón relativo a la raíz del proyecto, con /
 */
export type Glob = string;

/**
 * manifest.json de un .walkiepack (spec walkie-live, ADR-0013 y ADR-0014): un .zip que genera un analizador local de forma estática. Junto al manifest va discovery.json (walkie-discovery.schema.json: entidades, relaciones y evidencia). Un .walkiepack no es un lienzo: no trae posiciones, ni código fuente completo, ni secretos, ni confirmaciones (las decide una persona en Walkie). Se lee primero: format y formatVersion se revisan antes que el resto (mensaje propio para una versión desconocida). La integridad que el schema no expresa la valida DiscoveryPackValidator (Walkie.Shared).
 */
export interface WalkieDiscoveryPackManifestV1 {
  format: 'walkiepack';
  /**
   * Versión de este formato (ADR-0014; la 0 está congelada en walkiepack/v0/). Un lector rechaza una versión mayor que la suya con un mensaje propio; las anteriores las sube con migraciones puras
   */
  formatVersion: 1;
  /**
   * schemaVersion de walkie-graph de los $defs que usan las entidades (http, database, resource, runtime); no puede ser mayor que el del lector
   */
  schemaVersion: number;
  /**
   * Cuándo se generó. Única fecha del paquete: discovery.json no lleva fechas
   */
  generatedAt: string;
  /**
   * Qué programa lo generó
   */
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
   * El proyecto analizado. El id lo crea el analizador una vez y lo guarda en .walkie/source.json del proyecto: reanalizar apunta a la misma fuente
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
   * Capacidades del analizador: cada detector, qué puede producir y si corrió. Un hallazgo solo puede venir de un detector que corrió; en un reanálisis, algo «ya no aparece» solo si un detector que lo puede producir corrió sobre su ruta (ADR-0014)
   *
   * @minItems 1
   */
  detectors: [
    {
      /**
       * Detector que produjo el hallazgo (ej. openapi, compose, csproj, package-json, aspnetcore-endpoints, efcore, react-router, angular-router)
       */
      id: string;
      version: string;
      /**
       * ran: corrió sobre todo su alcance, aunque no encontrara nada que mirar (entonces dice por qué en reason, ej. no hay apps Angular); skipped: no corrió porque se excluyó (--detectors); failed: empezó y no terminó
       */
      status: 'ran' | 'skipped' | 'failed';
      /**
       * Por qué no corrió o falló (obligatorio salvo en ran)
       */
      reason?: string;
      produces: {
        /**
         * Items: api, service, database y resource se proponen como elementos del catálogo; screen como pantalla de una feature; module como módulo compartido (ADR-0010) y feature como feature con su lienzo inicial
         */
        entities: ('api' | 'service' | 'database' | 'resource' | 'screen' | 'module' | 'feature')[];
        /**
         * Items: calls: una pantalla o servicio llama a una api; reads/writes: un servicio usa una base, o una api lee o escribe la base de su DbContext (ADR-0016); publishes/consumes: mensajería; exposes: un servicio publica una api; depends-on: dependencia declarada (compose, referencia de proyecto); navigates: de una pantalla a otra; contains: un servicio contiene un módulo, o una app de front contiene sus pantallas (ADR-0016)
         */
        relations: (
          'calls' | 'reads' | 'writes' | 'publishes' | 'consumes' | 'exposes' | 'depends-on' | 'navigates' | 'contains'
        )[];
      };
    },
    ...{
      /**
       * Detector que produjo el hallazgo (ej. openapi, compose, csproj, package-json, aspnetcore-endpoints, efcore, react-router, angular-router)
       */
      id: string;
      version: string;
      /**
       * ran: corrió sobre todo su alcance, aunque no encontrara nada que mirar (entonces dice por qué en reason, ej. no hay apps Angular); skipped: no corrió porque se excluyó (--detectors); failed: empezó y no terminó
       */
      status: 'ran' | 'skipped' | 'failed';
      /**
       * Por qué no corrió o falló (obligatorio salvo en ran)
       */
      reason?: string;
      produces: {
        /**
         * Items: api, service, database y resource se proponen como elementos del catálogo; screen como pantalla de una feature; module como módulo compartido (ADR-0010) y feature como feature con su lienzo inicial
         */
        entities: ('api' | 'service' | 'database' | 'resource' | 'screen' | 'module' | 'feature')[];
        /**
         * Items: calls: una pantalla o servicio llama a una api; reads/writes: un servicio usa una base, o una api lee o escribe la base de su DbContext (ADR-0016); publishes/consumes: mensajería; exposes: un servicio publica una api; depends-on: dependencia declarada (compose, referencia de proyecto); navigates: de una pantalla a otra; contains: un servicio contiene un módulo, o una app de front contiene sus pantallas (ADR-0016)
         */
        relations: (
          'calls' | 'reads' | 'writes' | 'publishes' | 'consumes' | 'exposes' | 'depends-on' | 'navigates' | 'contains'
        )[];
      };
    }[]
  ];
  /**
   * Qué se miró: rutas relativas (globs) incluidas y excluidas. Los secretos se excluyen siempre, estén o no aquí
   */
  scope: {
    /**
     * @minItems 1
     */
    include: [Glob, ...Glob[]];
    exclude: Glob[];
  };
  /**
   * complete: todos los detectores corrieron sobre todo el proyecto (include = ** /*); partial: no. Un análisis parcial es válido: la revisión no marca como «ya no aparece» lo que quedó fuera
   */
  completeness: 'complete' | 'partial';
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
     * Items: Id de una evidencia en este archivo (el analizador lo deriva de detector, ruta y ancla)
     */
    evidence: [string, ...string[]];
  }[];
  /**
   * Lo que el análisis no pudo resolver o no miró (ej. una ruta construida en tiempo de ejecución); se muestra antes de confirmar en vez de adivinar
   */
  limitations: {
    /**
     * Ej. dynamic-route, unparsed-file, unsupported-technology, file-too-large, secret-excluded
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
  /**
   * Conteos; entities, relations y evidence coinciden con discovery.json
   */
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
