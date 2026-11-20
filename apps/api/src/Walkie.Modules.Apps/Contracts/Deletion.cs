using System.Text.Json.Serialization;

namespace Walkie.Modules.Apps.Contracts;

/// <summary>Una feature (no un módulo) que se elimina, en su app (ADR-0017).</summary>
public sealed record FeatureDeletionTarget(Guid AppId, Guid FeatureId);

/// <summary>Una app que se elimina con todas sus features y módulos (incluidos los marcados al eliminarla).</summary>
public sealed record AppDeletionTarget(Guid AppId, IReadOnlyList<Guid> FeatureIds);

/// <summary>
/// Lo que se perdería al eliminar y lo que lo impide. Cada módulo suma sus conteos (<see cref="Add"/>) y sus bloqueos;
/// Apps arma la respuesta (<c>walkie-deletion-impact.schema.json</c>).
/// </summary>
public sealed class DeletionImpact
{
    public SortedDictionary<string, int> Counts { get; } = new(StringComparer.Ordinal);

    public List<DeletionBlocker> Blockers { get; } = [];

    /// <summary>Versión del lienzo de la feature al describirla (0 si no tiene): la eliminación la exige igual.</summary>
    public int? CanvasVersion { get; set; }

    public void Add(string key, int count) => Counts[key] = Counts.GetValueOrDefault(key) + count;
}

/// <summary>Algo que impide eliminar (409): un portal que la apunta, una operación de Walkie Live en curso…</summary>
public sealed record DeletionBlocker(string Code, string Message, IReadOnlyList<DeletionReference> References);

public sealed record DeletionReference(string Kind, Guid Id, string Name);

/// <summary>
/// Lo que un módulo guarda de una app o una feature, para eliminarlo (ADR-0017). Apps define el contrato y cada módulo
/// lo implementa sobre sus propias tablas; Apps nunca escribe en las de otro. Los borrados son <b>idempotentes</b>: la
/// eliminación puede retomarse desde el principio después de un fallo.
/// </summary>
public interface IDeletionParticipant
{
    /// <summary>Nombre estable del paso en la bitácora (ej. <c>sharing</c>).</summary>
    string Step { get; }

    /// <summary>Orden de la fase 2: primero lo que da acceso (enlaces), al final lo que otros pasos necesitan leer.</summary>
    int Order { get; }

    Task DescribeFeatureAsync(FeatureDeletionTarget target, DeletionImpact impact, CancellationToken cancellationToken);

    Task DeleteFeatureAsync(FeatureDeletionTarget target, CancellationToken cancellationToken);

    Task DescribeAppAsync(AppDeletionTarget target, DeletionImpact impact, CancellationToken cancellationToken);

    Task DeleteAppAsync(AppDeletionTarget target, CancellationToken cancellationToken);
}

/// <summary>Puntos de prueba de una eliminación (antes de cada paso); en producción no hace nada.</summary>
public interface IDeletionCheckpoints
{
    Task ReachedAsync(Guid deletionId, string step, CancellationToken cancellationToken);
}

/// <summary>Impacto de eliminar (<c>walkie-deletion-impact.schema.json</c>).</summary>
public sealed record DeletionImpactResponse(
    string Kind,
    Guid Id,
    string Name,
    bool Reversible,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] int? CanvasVersion,
    IReadOnlyDictionary<string, int> Counts,
    IReadOnlyList<DeletionBlocker> Blockers);

/// <summary>Estado de una eliminación (<c>walkie-deletion.schema.json</c>).</summary>
public sealed record DeletionResponse(
    Guid Id,
    string Kind,
    Guid AppId,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Guid? FeatureId,
    string Name,
    string Status,
    DateTimeOffset RequestedAt,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] DateTimeOffset? CompletedAt,
    IReadOnlyList<DeletionStepResult> Steps,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Error);

public sealed record DeletionStepResult(
    string Step,
    string Status,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Error);
