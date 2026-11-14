/* Generado desde packages/schema/walkie-discovery-evidence.schema.json. No editar a mano: `pnpm gen:schema`. */

/**
 * Respuesta de GET /api/snapshots/{snapshotId}/evidence?entityKey=… (spec walkie-live, tarea 5): la evidencia que cita un hallazgo y sus relaciones, para el inspector de la revisión, sin descargar la evidencia del análisis entero. Si el hallazgo ya no aparece (missing), viene del análisis anterior (foundIn). Los textos vienen de un paquete subido por una persona: se muestran como texto. Se agrega porque la revisión solo trae evidenceCount.
 */
export interface WalkieDiscoveryEntityEvidenceV0 {
  /**
   * El análisis que se está revisando
   */
  snapshotId: string;
  /**
   * El análisis donde está el hallazgo: el mismo, o el anterior si ya no aparece
   */
  foundIn: string;
  /**
   * Identidad estable entre análisis: sale de lo que define al componente, nunca de líneas ni de la ruta del archivo donde está (ADR-0014). api:<MÉTODO> <ruta normalizada> (parámetros como {}), service:<nombre>, database:<motor>/<nombre>, resource:<subtipo>/<nombre>, screen:<ruta normalizada>, module:<nombre>, feature:<nombre>. DiscoveryKeys (Walkie.Shared) las arma
   */
  entityKey: string;
  evidence: Evidence[];
  /**
   * Relaciones en las que participa (hasta 100, por clave)
   *
   * @maxItems 100
   */
  relations: Relation[];
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
export interface Relation {
  /**
   * <kind>:<from>-><to>
   */
  key: string;
  /**
   * calls: una pantalla o servicio llama a una api; reads/writes: un servicio usa una base; publishes/consumes: mensajería; exposes: un servicio publica una api; depends-on: dependencia declarada (compose, referencia de proyecto); navigates: de una pantalla a otra; contains: un servicio contiene un módulo
   */
  kind: 'calls' | 'reads' | 'writes' | 'publishes' | 'consumes' | 'exposes' | 'depends-on' | 'navigates' | 'contains';
  /**
   * Identidad estable entre análisis: sale de lo que define al componente, nunca de líneas ni de la ruta del archivo donde está (ADR-0014). api:<MÉTODO> <ruta normalizada> (parámetros como {}), service:<nombre>, database:<motor>/<nombre>, resource:<subtipo>/<nombre>, screen:<ruta normalizada>, module:<nombre>, feature:<nombre>. DiscoveryKeys (Walkie.Shared) las arma
   */
  from: string;
  /**
   * Identidad estable entre análisis: sale de lo que define al componente, nunca de líneas ni de la ruta del archivo donde está (ADR-0014). api:<MÉTODO> <ruta normalizada> (parámetros como {}), service:<nombre>, database:<motor>/<nombre>, resource:<subtipo>/<nombre>, screen:<ruta normalizada>, module:<nombre>, feature:<nombre>. DiscoveryKeys (Walkie.Shared) las arma
   */
  to: string;
  /**
   * observed: declarado tal cual en el código o la configuración (un archivo OpenAPI, un MapGet con ruta literal, un servicio de compose); inferred: deducido por convención o heurística (un módulo por proyecto, una feature por pantalla). Ninguno es una confirmación
   */
  basis: 'observed' | 'inferred';
  /**
   * high: sin ambigüedad (solo en lo observado); medium: convención clara; low: heurística. La revisión nunca aplica sola lo que no es high
   */
  confidence: 'high' | 'medium' | 'low';
  /**
   * @minItems 1
   *
   * Items: Id de una evidencia en este archivo (el analizador lo deriva de detector, ruta y ancla)
   */
  evidence: [string, ...string[]];
}
