using System.Text.Json;
using System.Text.Json.Serialization;

namespace Walkie.Modules.Discovery.Contracts;

/// <summary>Fuente de un análisis (<c>$defs/source</c> de <c>walkie-discovery-snapshot</c>).</summary>
public sealed record DiscoverySourceResponse(Guid Id, string Name);

/// <summary>Un análisis cargado (<c>walkie-discovery-snapshot.schema.json</c>).</summary>
public sealed record DiscoverySnapshotResponse(
    Guid Id,
    Guid AppId,
    DiscoverySourceResponse Source,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Guid? PreviousSnapshotId,
    int FormatVersion,
    JsonElement Analyzer,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] JsonElement? Vcs,
    DateTimeOffset GeneratedAt,
    DateTimeOffset ImportedAt,
    string ImportedBy,
    string Completeness,
    JsonElement Detectors,
    JsonElement Technologies,
    JsonElement Limitations,
    JsonElement Stats,
    string PackSha256,
    string ContentFingerprint);

/// <summary>Lo que trae un paquete (<c>summary</c> de <c>walkie-discovery-upload</c>).</summary>
public sealed record DiscoveryUploadSummary(
    Guid AppId,
    DiscoverySourceResponse Source,
    bool SourceExists,
    int FormatVersion,
    JsonElement Analyzer,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] JsonElement? Vcs,
    DateTimeOffset GeneratedAt,
    string Completeness,
    JsonElement Detectors,
    JsonElement Technologies,
    JsonElement Limitations,
    JsonElement Stats,
    IReadOnlyDictionary<string, int> Entities,
    string PackSha256,
    string ContentFingerprint);

/// <summary>Respuesta de <c>POST /api/apps/{appId}/sources/snapshots</c> (<c>walkie-discovery-upload.schema.json</c>).</summary>
public sealed record DiscoveryUploadResponse(
    bool DryRun,
    string Status,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Duplicate,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] DiscoverySnapshotResponse? Snapshot,
    DiscoveryUploadSummary Summary);

/// <summary>
/// Lectura de lo guardado por Discovery, para otros módulos y para la revisión (tarea 4). Devuelve los documentos tal
/// como llegaron en el paquete (entidades, relaciones y evidencia de <c>walkie-discovery</c>), en orden estable.
/// </summary>
public interface IDiscoveryReader
{
    Task<DiscoverySnapshotResponse?> SnapshotAsync(Guid snapshotId, CancellationToken cancellationToken);

    /// <summary>Análisis de una fuente en una app, del más nuevo al más viejo.</summary>
    Task<IReadOnlyList<DiscoverySnapshotResponse>> SnapshotsOfSourceAsync(Guid appId, Guid sourceId, CancellationToken cancellationToken);

    /// <summary>Entidades de un análisis por clave; <paramref name="kind"/> filtra por tipo.</summary>
    Task<IReadOnlyList<JsonElement>> EntitiesAsync(Guid snapshotId, string? kind, CancellationToken cancellationToken);

    Task<IReadOnlyList<JsonElement>> RelationsAsync(Guid snapshotId, CancellationToken cancellationToken);

    Task<IReadOnlyList<JsonElement>> EvidenceAsync(Guid snapshotId, CancellationToken cancellationToken);
}
