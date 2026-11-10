namespace Walkie.Modules.Canvas.Domain;

/// <summary>
/// Distribución del mapa de una app (spec mapa-de-la-app): posición de cada feature (y de cada elemento del catálogo
/// compartido) como <c>jsonb</c>, con <see cref="Version"/> para concurrencia optimista. Sin FK al módulo Apps.
/// </summary>
internal sealed class AppMapLayout
{
    public Guid AppId { get; init; }

    /// <summary>Mapa clave → <c>{ x, y }</c> serializado (<c>$defs/layout/positions</c> del schema).</summary>
    public required string Positions { get; set; }

    public int Version { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }

    /// <summary>Claim <c>sub</c> de quien guardó por última vez.</summary>
    public required string UpdatedBy { get; set; }
}
