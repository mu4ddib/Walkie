namespace Walkie.Modules.Apps.Domain;

/// <summary>
/// Bitácora de una eliminación (ADR-0017): qué se pidió, quién, y cómo va cada paso de la fase 2. Sobrevive a la app:
/// es el registro auditable de lo borrado y lo que permite retomar una eliminación que falló a mitad.
/// </summary>
internal sealed class Deletion
{
    public const string Pending = "pending";
    public const string Completed = "completed";
    public const string Cancelled = "cancelled";
    public const string AppKind = "app";
    public const string FeatureKind = "feature";

    /// <summary>Lo genera el cliente (UUID v7): el mismo id en un reintento devuelve esta eliminación.</summary>
    public Guid Id { get; init; }

    public required string Kind { get; init; }
    public Guid AppId { get; init; }
    public Guid? FeatureId { get; init; }

    /// <summary>Nombre de la app o la feature al pedirla (queda aunque se borre).</summary>
    public required string Name { get; init; }

    public required string RequestedBy { get; init; }
    public DateTimeOffset RequestedAt { get; init; }
    public required string Status { get; set; }

    /// <summary>Pasos hechos y el que falló: lista JSON de <c>{ step, status, error? }</c>.</summary>
    public string Steps { get; set; } = "[]";

    public string? Error { get; set; }
    public int Attempts { get; set; }

    /// <summary>Hasta cuándo la tiene tomada una ejecución (la de la solicitud o la de recuperación).</summary>
    public DateTimeOffset? LeaseUntil { get; set; }

    public DateTimeOffset? CompletedAt { get; set; }
}
