/* Generado desde packages/schema/walkie-discovery-relation-evidence.schema.json. No editar a mano: `pnpm gen:schema`. */

/**
 * Una relación de un análisis con su evidencia resuelta (spec walkie-live-arquitectura, ADR-0016): para una relación inferida, la cadena entera (cada salto con su archivo, línea y nota). GET /api/snapshots/{snapshotId}/relation-evidence?key=…
 */
export interface WalkieDiscoveryRelationEvidenceV0 {
  snapshotId: string;
  relation: Relation;
  evidence: Evidence[];
}
export interface Relation {
  /**
   * <kind>:<from>-><to>
   */
  key: string;
  /**
   * calls: una pantalla o servicio llama a una api; reads/writes: un servicio usa una base, o una api lee o escribe la base de su DbContext (ADR-0016); publishes/consumes: mensajería; exposes: un servicio publica una api; depends-on: dependencia declarada (compose, referencia de proyecto); navigates: de una pantalla a otra; contains: un servicio contiene un módulo, o una app de front contiene sus pantallas (ADR-0016)
   */
  kind: 'calls' | 'reads' | 'writes' | 'publishes' | 'consumes' | 'exposes' | 'depends-on' | 'navigates' | 'contains';
  /**
   * Identidad estable entre análisis: sale de lo que define al componente, nunca de líneas ni de la ruta del archivo donde está (ADR-0014). api:<MÉTODO> <ruta normalizada> (parámetros como {}), service:<nombre>, database:<motor>/<nombre>, resource:<subtipo>/<nombre>, screen:<ámbito de la app>:<ruta normalizada>, module:<nombre>, feature:<ámbito de la app>:<nombre> (formatVersion 1; en la 0, screen:<ruta> y feature:<nombre>, que siguen siendo válidas en los registros de la API: un vínculo decidido antes conserva su clave). DiscoveryKeys (Walkie.Shared) las arma
   */
  from: string;
  /**
   * Identidad estable entre análisis: sale de lo que define al componente, nunca de líneas ni de la ruta del archivo donde está (ADR-0014). api:<MÉTODO> <ruta normalizada> (parámetros como {}), service:<nombre>, database:<motor>/<nombre>, resource:<subtipo>/<nombre>, screen:<ámbito de la app>:<ruta normalizada>, module:<nombre>, feature:<ámbito de la app>:<nombre> (formatVersion 1; en la 0, screen:<ruta> y feature:<nombre>, que siguen siendo válidas en los registros de la API: un vínculo decidido antes conserva su clave). DiscoveryKeys (Walkie.Shared) las arma
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
