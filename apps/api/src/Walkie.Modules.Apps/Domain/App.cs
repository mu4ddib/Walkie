namespace Walkie.Modules.Apps.Domain;

/// <summary>Aplicación documentada. Contiene features (y, en la fase 2, el catálogo).</summary>
internal sealed class App
{
    public const int NameMaxLength = 120;

    public Guid Id { get; init; } = Guid.CreateVersion7();
    public required string Name { get; set; }

    /// <summary>Claim <c>sub</c> de quien la creó (ADR-0003).</summary>
    public required string CreatedBy { get; init; }

    public DateTimeOffset CreatedAt { get; init; } = DateTimeOffset.UtcNow;
    public List<Feature> Features { get; } = [];
}
