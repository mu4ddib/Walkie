/* Generado desde packages/schema/walkie-discovery-source-import.schema.json. No editar a mano: `pnpm gen:schema`. */

/**
 * Respuesta de POST /api/sources/import (spec walkie-live, tarea 10): crear una app nueva desde un proyecto local con su primer análisis. Con dryRun (status preview) no escribe nada y propone un nombre; sin él crea la app vacía (sin features, catálogo ni lienzos) y guarda el análisis (created), o devuelve lo ya creado por el mismo importId (existing). El paquete se valida igual que en walkie-discovery-upload.
 */
export type WalkieDiscoverySourceImportV0 = {
  /**
   * Identidad de la operación (UUID v7 del cliente): un reintento manda la misma
   */
  importId?: string;
  dryRun: boolean;
  status: 'preview' | 'created' | 'existing';
  app: {
    /**
     * Solo cuando se creó (lo genera la API)
     */
    id?: string;
    /**
     * En la vista previa, el propuesto (el de la fuente, con un número si ya existe) o el pedido
     */
    name: string;
    /**
     * Ya hay una app con ese nombre: hay que elegir otro antes de crear
     */
    nameTaken: boolean;
  };
  snapshot?: WalkieDiscoverySnapshotV0;
  summary: Summary;
  /**
   * source-in-other-apps (el proyecto ya está en otras apps) y pending-import (hay una creación sin terminar desde este proyecto)
   */
  warnings: Items[];
};
/**
 * Capacidades del analizador: cada detector, qué puede producir y si corrió. Un hallazgo solo puede venir de un detector que corrió; en un reanálisis, algo «ya no aparece» solo si un detector que lo puede producir corrió sobre su ruta (ADR-0014)
 *
 * @minItems 1
 */
export type Detectors = [
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
       * Items: calls: una pantalla o servicio llama a una api; reads/writes: un servicio usa una base; publishes/consumes: mensajería; exposes: un servicio publica una api; depends-on: dependencia declarada (compose, referencia de proyecto); navigates: de una pantalla a otra; contains: un servicio contiene un módulo
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
       * Items: calls: una pantalla o servicio llama a una api; reads/writes: un servicio usa una base; publishes/consumes: mensajería; exposes: un servicio publica una api; depends-on: dependencia declarada (compose, referencia de proyecto); navigates: de una pantalla a otra; contains: un servicio contiene un módulo
       */
      relations: (
        'calls' | 'reads' | 'writes' | 'publishes' | 'consumes' | 'exposes' | 'depends-on' | 'navigates' | 'contains'
      )[];
    };
  }[]
];
/**
 * Tecnologías detectadas (lenguajes, frameworks, motores), para mostrarlas antes de confirmar
 */
export type Technologies = {
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
export type Limitations = {
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
 * El primer análisis de la app (sin dryRun)
 */
export interface WalkieDiscoverySnapshotV0 {
  /**
   * Generado por la API
   */
  id: string;
  appId: string;
  source: Source;
  /**
   * Análisis anterior de la misma fuente, contra el que se calculan changed y missing
   */
  previousSnapshotId?: string;
  /**
   * formatVersion del paquete tal como llegó (antes de migrarlo)
   */
  formatVersion: number;
  analyzer: Analyzer;
  vcs?: Vcs;
  generatedAt: string;
  importedAt: string;
  /**
   * Claim sub de quien lo cargó
   */
  importedBy: string;
  /**
   * complete: todos los detectores corrieron sobre todo el proyecto (include = ** /*); partial: no. Un análisis parcial es válido: la revisión no marca como «ya no aparece» lo que quedó fuera
   */
  completeness: 'complete' | 'partial';
  detectors: Detectors;
  technologies: Technologies;
  limitations: Limitations;
  stats: Stats;
  /**
   * SHA-256 del archivo tal como se subió
   */
  packSha256: string;
  /**
   * Fingerprint del discovery.json en JSON canónico: dos análisis del mismo árbol dan el mismo, aunque cambie generatedAt
   */
  contentFingerprint: string;
}
/**
 * Fuente local de una app: el id viene del .walkiepack (.walkie/source.json del proyecto)
 */
export interface Source {
  id: string;
  name: string;
}
/**
 * Qué programa lo generó
 */
export interface Analyzer {
  /**
   * Ej. walkie-cli
   */
  name: string;
  /**
   * SemVer del analizador
   */
  version: string;
}
/**
 * Estado del control de versiones al analizar, si lo hay (leído de los archivos de .git, sin ejecutar git)
 */
export interface Vcs {
  kind: 'git';
  commit: string;
  branch?: string;
  /**
   * Hay cambios sin confirmar (si se pudo saber)
   */
  dirty?: boolean;
}
/**
 * Conteos; entities, relations y evidence coinciden con discovery.json
 */
export interface Stats {
  /**
   * Archivos leídos
   */
  files: number;
  entities: number;
  relations: number;
  evidence: number;
}
/**
 * Lo que trae el paquete, para mostrar antes de confirmar
 */
export interface Summary {
  /**
   * La app donde se carga (o se creó). Falta solo en la vista previa de crear una app nueva desde el proyecto (walkie-discovery-source-import)
   */
  appId?: string;
  source: Source;
  /**
   * La app ya tenía análisis de esta fuente
   */
  sourceExists: boolean;
  formatVersion: number;
  analyzer: Analyzer;
  vcs?: Vcs;
  generatedAt: string;
  /**
   * complete: todos los detectores corrieron sobre todo el proyecto (include = ** /*); partial: no. Un análisis parcial es válido: la revisión no marca como «ya no aparece» lo que quedó fuera
   */
  completeness: 'complete' | 'partial';
  detectors: Detectors;
  technologies: Technologies;
  limitations: Limitations;
  stats: Stats;
  /**
   * Entidades por tipo (solo los tipos presentes)
   */
  entities: {
    [k: string]: number;
  };
  packSha256: string;
  /**
   * SHA-256 del contenido de la entidad en JSON canónico (claves ordenadas, sin espacios), sin key, fingerprint, basis, confidence, derivedFrom ni evidence: cambia si cambia lo que describe, no si se mueve de línea (ADR-0014, DiscoveryFingerprint)
   */
  contentFingerprint: string;
  previous?: Brief;
}
/**
 * El último análisis de esta fuente en la app: con él se comparará (fechas, commit y si fue completo)
 */
export interface Brief {
  id: string;
  generatedAt: string;
  importedAt: string;
  /**
   * complete: todos los detectores corrieron sobre todo el proyecto (include = ** /*); partial: no. Un análisis parcial es válido: la revisión no marca como «ya no aparece» lo que quedó fuera
   */
  completeness: 'complete' | 'partial';
  vcs?: Vcs;
}
export interface Items {
  code: string;
  message: string;
  /**
   * Identidad estable entre análisis: sale de lo que define al componente, nunca de líneas ni de la ruta del archivo donde está (ADR-0014). api:<MÉTODO> <ruta normalizada> (parámetros como {}), service:<nombre>, database:<motor>/<nombre>, resource:<subtipo>/<nombre>, screen:<ámbito de la app>:<ruta normalizada>, module:<nombre>, feature:<ámbito de la app>:<nombre> (formatVersion 1; en la 0, screen:<ruta> y feature:<nombre>, que siguen siendo válidas en los registros de la API: un vínculo decidido antes conserva su clave). DiscoveryKeys (Walkie.Shared) las arma
   */
  entityKey?: string;
}
