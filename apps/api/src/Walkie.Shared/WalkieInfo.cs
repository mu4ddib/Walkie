namespace Walkie.Shared;

/// <summary>Constantes compartidas entre módulos.</summary>
public static class WalkieInfo
{
    /// <summary>
    /// Versión de <c>packages/schema/walkie-graph.schema.json</c> que entiende la API.
    /// Debe coincidir con <c>properties.schemaVersion.const</c> del schema.
    /// </summary>
    public const int SchemaVersion = 0;
}
