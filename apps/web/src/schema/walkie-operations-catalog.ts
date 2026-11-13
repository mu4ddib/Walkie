/* Generado desde packages/schema/walkie-operations.schema.json. No editar a mano: `pnpm gen:schema`. */

/**
 * Única definición de las operaciones (spec interacciones, ADR-0011): la web la genera en src/schema/walkie-operations.ts y la API la embebe para el export. Los ids son los del enum `operation` de walkie-graph.
 */
export interface WalkieOperationsCatalog {
  $schema?: string;
  /**
   * Texto de cada tipo de retorno
   */
  results: {
    [k: string]: string;
  };
  /**
   * Nombre de cada patrón de intercambio
   */
  patterns: {
    [k: string]: string;
  };
  /**
   * Tecnologías sugeridas por familia de componentes
   */
  technologies: {
    [k: string]: string[];
  };
  /**
   * @minItems 1
   */
  operations: [Operation, ...Operation[]];
}
export interface Operation {
  /**
   * Id del enum `operation` del grafo
   */
  id: string;
  /**
   * Nombre en el inspector («Consultar»)
   */
  name: string;
  /**
   * Verbo en el lienzo («consulta»)
   */
  verb: string;
  group: string;
  /**
   * El primero es el de por defecto
   *
   * @minItems 1
   */
  patterns: [
    'request-response' | 'one-way' | 'pub-sub' | 'stream',
    ...('request-response' | 'one-way' | 'pub-sub' | 'stream')[]
  ];
  returns: null | {
    /**
     * «Añadir resultado», «Añadir respuesta»…
     */
    action: string;
    /**
     * Verbo del retorno («devuelve»)
     */
    verb: string;
    /**
     * @minItems 1
     */
    types: [
      'success' | 'empty' | 'affected' | 'ack' | 'nack' | 'hit' | 'miss' | 'content' | 'error' | 'message' | 'end',
      ...(
        'success' | 'empty' | 'affected' | 'ack' | 'nack' | 'hit' | 'miss' | 'content' | 'error' | 'message' | 'end'
      )[]
    ];
  };
  /**
   * Admite retorno aunque el patrón sea unidireccional (confirmaciones de mensajería)
   */
  oneWayReturns?: boolean;
  sections: (
    'http' | 'grpc' | 'command' | 'params' | 'entities' | 'result' | 'errors' | 'policy' | 'messaging' | 'correlation'
  )[];
  /**
   * Acceso a datos que implica (para señalar contradicciones)
   */
  access?: 'read' | 'write';
}
