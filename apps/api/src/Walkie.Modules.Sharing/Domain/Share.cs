namespace Walkie.Modules.Sharing.Domain;

/// <summary>
/// Enlace de solo lectura a una feature (ADR-0005). Solo se guarda el hash SHA-256 del token:
/// con la base filtrada, los enlaces no sirven.
/// </summary>
internal sealed class Share
{
    /// <summary>Duraciones permitidas (spec enlace-solo-lectura, criterio 1).</summary>
    public static readonly IReadOnlySet<int> AllowedDays = new HashSet<int> { 7, 30, 90 };

    public Guid Id { get; init; } = Guid.CreateVersion7();
    public Guid FeatureId { get; init; }
    public required byte[] TokenHash { get; init; }
    public required string CreatedBy { get; init; }
    public required string CreatedByName { get; init; }
    public DateTimeOffset CreatedAt { get; init; }
    public DateTimeOffset ExpiresAt { get; init; }
    public DateTimeOffset? RevokedAt { get; set; }
    public DateTimeOffset? LastAccessedAt { get; set; }

    public bool IsActiveAt(DateTimeOffset now) => RevokedAt is null && ExpiresAt > now;
}
