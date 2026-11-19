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

/// <summary>Lo esencial de un análisis para compararlo: fechas, completitud y commit.</summary>
public sealed record DiscoverySnapshotBrief(
    Guid Id,
    DateTimeOffset GeneratedAt,
    DateTimeOffset ImportedAt,
    string Completeness,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] JsonElement? Vcs);

/// <summary>La app que se crea desde un proyecto local (o se crearía, en la vista previa).</summary>
public sealed record DiscoveryNewApp(
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Guid? Id,
    string Name,
    bool NameTaken);

/// <summary>Respuesta de <c>POST /api/sources/import</c> (<c>walkie-discovery-source-import.schema.json</c>).</summary>
public sealed record DiscoverySourceImportResponse(
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Guid? ImportId,
    bool DryRun,
    string Status,
    DiscoveryNewApp App,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] DiscoverySnapshotResponse? Snapshot,
    DiscoveryUploadSummary Summary,
    IReadOnlyList<DiscoveryApplyWarning> Warnings);

/// <summary>Respuesta de <c>GET /api/discovery</c> (<c>walkie-discovery-status.schema.json</c>): Discovery está encendido.</summary>
public sealed record DiscoveryStatusResponse(bool Enabled, int FormatVersion, long MaxPackBytes);

/// <summary>Lo que trae un paquete (<c>summary</c> de <c>walkie-discovery-upload</c>).</summary>
public sealed record DiscoveryUploadSummary(
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Guid? AppId,
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
    string ContentFingerprint)
{
    /// <summary>El último análisis de esta fuente en la app (con el que se comparará), si ya había uno.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public DiscoverySnapshotBrief? Previous { get; init; }
}

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
