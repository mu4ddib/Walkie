/* Generado desde packages/schema/walkie-discovery-provenance.schema.json. No editar a mano: `pnpm gen:schema`. */

/**
 * Vínculo de un hallazgo con Walkie (spec walkie-live, ADR-0012 y ADR-0014): la única confirmación que existe. Lo decide una persona y se guarda en Walkie, nunca en el .walkiepack. Une la clave estable de una entidad de una fuente con un elemento del catálogo, un módulo o una feature (linked: ya existía; created: lo creó una aplicación) o la descarta (rejected). Persiste entre análisis de la misma fuente y no cambia el elemento al que apunta.
 */
export type WalkieDiscoveryBindingV0 = {
  sourceId: string;
  /**
   * Identidad estable entre análisis: sale de lo que define al componente, nunca de líneas ni de la ruta del archivo donde está (ADR-0014). api:<MÉTODO> <ruta normalizada> (parámetros como {}), service:<nombre>, database:<motor>/<nombre>, resource:<subtipo>/<nombre>, screen:<ruta normalizada>, module:<nombre>, feature:<nombre>. DiscoveryKeys (Walkie.Shared) las arma
   */
  entityKey: string;
  decision: 'linked' | 'created' | 'rejected';
  target?: Target;
  /**
   * Fingerprint de la entidad cuando se decidió: si cambia en un análisis posterior, la revisión la marca changed
   */
  entityFingerprint: string;
  /**
   * Análisis en el que se decidió
   */
  snapshotId: string;
  /**
   * Aplicación que lo escribió (bitácora, ADR-0012)
   */
  applyId?: string;
  /**
   * Por qué se descartó o vinculó así
   */
  note?: string;
  /**
   * Claim sub de quien decidió (ADR-0003)
   */
  decidedBy: string;
  decidedAt: string;
  /**
   * Concurrencia optimista: una operación con versión vieja responde 409
   */
  version: number;
};

/**
 * Respuesta de GET /api/apps/{appId}/bindings?target={kind}:{id} (spec walkie-live, tarea 6; ADR-0012): de qué hallazgos de Walkie Live viene un elemento de la app. Una entrada por vínculo activo (linked o created) de cualquier fuente de la app, con el hallazgo y su evidencia tal como estaban en el análisis en el que se decidió, y si el último análisis de esa fuente lo sigue viendo. La procedencia vive aquí, fuera del grafo y del elemento: no bloquea editarlo ni se reescribe con análisis nuevos.
 */
export interface WalkieDiscoveryProvenanceV0 {
  appId: string;
  target: Target;
  /**
   * false si el elemento ya no existe en la app (se borró): los vínculos siguen guardados, pero no apuntan a nada
   */
  targetExists: boolean;
  bindings: Origin[];
}
/**
 * Elemento de Walkie al que apunta un vínculo (referencia por id, como un catalogId o un moduleId en el grafo; sin copia de su contenido)
 */
export interface Target {
  /**
   * catalogItem: walkie-catalog-item; module y feature: filas de apps.features (ADR-0010)
   */
  kind: 'catalogItem' | 'module' | 'feature';
  id: string;
  /**
   * Último nombre conocido (informativo, como el title de un ref)
   */
  title?: string;
}
export interface Origin {
  source: {
    id: string;
    name: string;
  };
  binding: WalkieDiscoveryBindingV0;
  /**
   * El hallazgo en el análisis en el que se decidió (sin evidencia ni contrato)
   */
  entity?: {
    /**
     * Identidad estable entre análisis: sale de lo que define al componente, nunca de líneas ni de la ruta del archivo donde está (ADR-0014). api:<MÉTODO> <ruta normalizada> (parámetros como {}), service:<nombre>, database:<motor>/<nombre>, resource:<subtipo>/<nombre>, screen:<ruta normalizada>, module:<nombre>, feature:<nombre>. DiscoveryKeys (Walkie.Shared) las arma
     */
    key: string;
    /**
     * api, service, database y resource se proponen como elementos del catálogo; screen como pantalla de una feature; module como módulo compartido (ADR-0010) y feature como feature con su lienzo inicial
     */
    kind: 'api' | 'service' | 'database' | 'resource' | 'screen' | 'module' | 'feature';
    title: string;
    /**
     * observed: declarado tal cual en el código o la configuración (un archivo OpenAPI, un MapGet con ruta literal, un servicio de compose); inferred: deducido por convención o heurística (un módulo por proyecto, una feature por pantalla). Ninguno es una confirmación
     */
    basis: 'observed' | 'inferred';
    /**
     * high: sin ambigüedad (solo en lo observado); medium: convención clara; low: heurística. La revisión nunca aplica sola lo que no es high
     */
    confidence: 'high' | 'medium' | 'low';
  };
  /**
   * Evidencia del hallazgo en ese análisis (hasta 20; rutas relativas, líneas, detector y confianza)
   *
   * @maxItems 20
   */
  evidence:
    | []
    | [Evidence]
    | [Evidence, Evidence]
    | [Evidence, Evidence, Evidence]
    | [Evidence, Evidence, Evidence, Evidence]
    | [Evidence, Evidence, Evidence, Evidence, Evidence]
    | [Evidence, Evidence, Evidence, Evidence, Evidence, Evidence]
    | [Evidence, Evidence, Evidence, Evidence, Evidence, Evidence, Evidence]
    | [Evidence, Evidence, Evidence, Evidence, Evidence, Evidence, Evidence, Evidence]
    | [Evidence, Evidence, Evidence, Evidence, Evidence, Evidence, Evidence, Evidence, Evidence]
    | [Evidence, Evidence, Evidence, Evidence, Evidence, Evidence, Evidence, Evidence, Evidence, Evidence]
    | [Evidence, Evidence, Evidence, Evidence, Evidence, Evidence, Evidence, Evidence, Evidence, Evidence, Evidence]
    | [
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence
      ]
    | [
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence
      ]
    | [
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence
      ]
    | [
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence
      ]
    | [
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence
      ]
    | [
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence
      ]
    | [
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence
      ]
    | [
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence
      ]
    | [
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence,
        Evidence
      ];
  evidenceTotal: number;
  /**
   * El último análisis de la fuente frente a la decisión. not-found no significa que se haya borrado: ese análisis puede no haber mirado donde estaba
   */
  latest: {
    snapshotId: string;
    status: 'same' | 'changed' | 'not-found';
  };
}
export interface Evidence {
  /**
   * Id de una evidencia en este archivo (el analizador lo deriva de detector, ruta y ancla)
   */
  id: string;
  /**
   * Detector que produjo el hallazgo (ej. openapi, compose, csproj, package-json, aspnetcore-endpoints, efcore, react-router, angular-router)
   */
  detector: string;
  /**
   * Ruta relativa a la raíz del proyecto, con /: nunca absoluta, sin .. ni \
   */
  path: string;
  /**
   * Ancla estable dentro del archivo (ej. PedidosEndpoints.MapPedidos, services.db, paths./api/pedidos/{pedidoId}.get): sobrevive a que cambien las líneas
   */
  symbol?: string;
  /**
   * Informativas: cambian con cualquier edición y no forman parte de ninguna identidad
   */
  lines?: {
    start: number;
    end: number;
  };
  /**
   * high: sin ambigüedad (solo en lo observado); medium: convención clara; low: heurística. La revisión nunca aplica sola lo que no es high
   */
  confidence: 'high' | 'medium' | 'low';
  /**
   * Por qué el detector concluye esto (ej. «MapGet con ruta literal»)
   */
  note?: string;
  /**
   * Fragmento del código, solo si el manifest dice includeSnippets; nunca un archivo completo
   */
  snippet?: string;
}
