namespace Walkie.Modules.Apps.Domain;

/// <summary>Funcionalidad con un único objetivo de usuario. Tiene un lienzo (módulo Canvas).</summary>
internal sealed class Feature
{
    public const int NameMaxLength = 120;
    public const int DescriptionMaxLength = 500;

    public Guid Id { get; init; } = Guid.CreateVersion7();
    public Guid AppId { get; init; }
    public required string Name { get; set; }

    /// <summary>Para qué sirve la feature; vacía si no se ha escrito.</summary>
    public string Description { get; set; } = "";

    /// <summary>Claim <c>sub</c> de quien la creó (ADR-0003).</summary>
    public required string CreatedBy { get; init; }

    public DateTimeOffset CreatedAt { get; init; } = DateTimeOffset.UtcNow;

    /// <summary>Último cambio de nombre o descripción (el del lienzo lo lleva Canvas).</summary>
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}
