namespace Walkie.Modules.Canvas.Domain;

/// <summary>
/// Lienzo de una feature: el grafo completo (<c>packages/schema/walkie-graph.schema.json</c>)
/// guardado como <c>jsonb</c>, con <see cref="Version"/> para concurrencia optimista.
/// </summary>
internal sealed class CanvasDocument
{
    /// <summary>Id de la feature (módulo Apps). Sin FK entre módulos: la relación se respeta en la aplicación.</summary>
    public Guid FeatureId { get; init; }

    /// <summary>Grafo serializado. La API lo valida contra el schema antes de guardarlo.</summary>
    public required string Graph { get; set; }

    /// <summary>Sube en 1 en cada guardado; un guardado con versión vieja falla (409).</summary>
    public int Version { get; set; }

    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;

    /// <summary>Claim <c>sub</c> de quien guardó por última vez (ADR-0003).</summary>
    public required string UpdatedBy { get; set; }
}
