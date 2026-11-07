namespace Walkie.Modules.Apps.Domain;

/// <summary>
/// Elemento reutilizable del catálogo de una app (ADR-0002, <c>packages/schema/walkie-catalog-item.schema.json</c>).
/// Los lienzos lo usan con nodos <c>ref</c>. El tipo no cambia después de crearlo.
/// </summary>
internal sealed class CatalogItem
{
    public const int TitleMaxLength = 120;
    public const int TextMaxLength = 2000;

    public static readonly string[] Types = ["api", "service", "database"];
    public static readonly string[] HttpMethods = ["GET", "POST", "PUT", "PATCH", "DELETE"];

    public Guid Id { get; init; } = Guid.CreateVersion7();
    public Guid AppId { get; init; }
    public required string Type { get; init; }
    public required string Title { get; set; }
    public string? Description { get; set; }

    /// <summary>Solo en <c>api</c>.</summary>
    public string? HttpMethod { get; set; }

    /// <summary>Solo en <c>api</c>.</summary>
    public string? HttpPath { get; set; }

    /// <summary>Concurrencia optimista: un guardado con versión vieja responde 409.</summary>
    public int Version { get; set; } = 1;

    public required string CreatedBy { get; init; }
    public DateTimeOffset CreatedAt { get; init; }
    public required string UpdatedBy { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
