using System.Text.Json.Serialization;

namespace Walkie.Modules.Discovery.Contracts;

/// <summary>Arquitectura descubierta de un análisis (<c>walkie-discovery-architecture.schema.json</c>, ADR-0016).</summary>
public sealed record DiscoveryArchitecture(
    Guid SnapshotId,
    string Completeness,
    ArchitectureTotals Totals,
    IReadOnlyList<ArchitectureGroup> Groups,
    IReadOnlyList<ArchitectureLink> Links,
    IReadOnlyList<ArchitectureProposal> Proposals,
    IReadOnlyList<ArchitectureLimitation> Limitations)
{
    /// <summary>El análisis anterior de la misma fuente, para abrir su arquitectura.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public Guid? PreviousSnapshotId { get; init; }
}

/// <summary>
/// El estado de un hallazgo en Walkie, el mismo de la revisión (spec walkie-live-documentacion): nuevo, coincide,
/// vinculado, creado, descartado, cambió…, si cambió respecto del análisis anterior, a qué elemento documentado
/// apunta (con su título actual) y si ese elemento se borró. La arquitectura descubierta sigue mostrando todo lo
/// decidido: decidir no borra la evidencia.
/// </summary>
public sealed record ArchitectureState(
    string Status,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Change,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] DiscoveryTarget? Target,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] bool? TargetMissing,
    bool NeedsReview);

public sealed record ArchitectureTotals(int Entities, int Relations);

public sealed record ArchitectureGroup(
    string Key,
    string Kind,
    string Title,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Technology,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? EntityKey,
    IReadOnlyDictionary<string, int> Counts,
    IReadOnlyDictionary<string, int> Internal,
    int Limitations,
    int Incomplete)
{
    /// <summary>Hallazgos del grupo por estado (solo los que hay): qué falta decidir y qué ya está en Walkie.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public IReadOnlyDictionary<string, int>? States { get; init; }
}

public sealed record ArchitectureLink(string From, string To, string Kind, string Semantic, int Total, int Observed, int Inferred, int Low, LinkBreakdown ByBasis);

/// <summary>Las relaciones de un vínculo en categorías disjuntas (base × confianza), para contar exacto lo que deja ver un filtro.</summary>
public sealed record LinkBreakdown(ConfidenceCounts Observed, ConfidenceCounts Inferred);

public sealed record ConfidenceCounts(int High, int Medium, int Low);

public sealed record ArchitectureProposal(
    string Key,
    string Title,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? App,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Group,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Description,
    string Confidence,
    string Strength,
    int Screens,
    int Apis,
    int Navigation,
    int Requests,
    int Unresolved,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Decision,
    IReadOnlyList<string> Members,
    int MemberCount)
{
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public ArchitectureState? State { get; init; }
}

public sealed record ArchitectureLimitation(
    string Code,
    string Message,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Path,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Detector,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Group,
    bool Incomplete);

/// <summary>Lo que hay dentro de un grupo (<c>walkie-discovery-architecture-group.schema.json</c>).</summary>
public sealed record DiscoveryArchitectureGroup(
    string Key,
    int Page,
    int PageSize,
    int Total,
    IReadOnlyList<ArchitectureEntity> Entities,
    IReadOnlyList<ArchitectureRelation> Relations,
    IReadOnlyList<ArchitectureEntity> Neighbors);

public sealed record ArchitectureEntity(
    string Key,
    string Kind,
    string Title,
    string Basis,
    string Confidence,
    string Group,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Route,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Decision)
{
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public ArchitectureState? State { get; init; }
}

public sealed record ArchitectureRelation(string Key, string Kind, string From, string To, string Basis, string Confidence, string Semantic);

/// <summary>Una relación con su evidencia resuelta (<c>walkie-discovery-relation-evidence.schema.json</c>).</summary>
public sealed record RelationEvidence(Guid SnapshotId, System.Text.Json.JsonElement Relation, IReadOnlyList<System.Text.Json.JsonElement> Evidence);
