namespace Walkie.Modules.Apps.Domain;

/// <summary>Funcionalidad con un único objetivo de usuario. Tiene un lienzo (módulo Canvas).</summary>
internal sealed class Feature
{
    public const int NameMaxLength = 120;

    public Guid Id { get; init; } = Guid.CreateVersion7();
    public Guid AppId { get; init; }
    public required string Name { get; set; }

    /// <summary>Claim <c>sub</c> de quien la creó (ADR-0003).</summary>
    public required string CreatedBy { get; init; }

    public DateTimeOffset CreatedAt { get; init; } = DateTimeOffset.UtcNow;
}
