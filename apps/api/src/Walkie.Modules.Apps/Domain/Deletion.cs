namespace Walkie.Modules.Apps.Domain;

/// <summary>
/// Bitácora de una eliminación (ADR-0017): qué se pidió, quién, y cómo va cada paso de la fase 2. Sobrevive a la app:
/// es el registro auditable de lo borrado y lo que permite retomar una eliminación que falló a mitad.
/// </summary>
internal sealed class Deletion
{
    public const string Pending = "pending";
    public const string Completed = "completed";

    /// <summary>Solo histórico: versiones anteriores revertían la marca así. Hoy el impacto se revisa con el candado tomado y ya no se usa.</summary>
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

    /// <summary>
    /// La versión del lienzo que vio quien la pidió (solo feature). Es parte de la identidad de la solicitud: el mismo
    /// <see cref="Id"/> con otra versión no es un reintento.
    /// </summary>
    public int? CanvasVersion { get; init; }

    /// <summary>
    /// Ficha de la ejecución que la tiene (fencing): cada ejecución que toma el candado de la app pone una nueva, y toda
    /// escritura de la bitácora y el paso final exigen la suya. Un ejecutor que perdió el candado no puede terminarla.
    /// </summary>
    public Guid? OwnerToken { get; set; }

    /// <summary>Después de un fallo, no se retoma antes de esta hora (espera entre reintentos). No es un candado.</summary>
    public DateTimeOffset? RetryAt { get; set; }

    public DateTimeOffset? CompletedAt { get; set; }
}
