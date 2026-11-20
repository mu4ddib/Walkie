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
    IReadOnlyList<ArchitectureLimitation> Limitations);

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
    int Incomplete);

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
    int MemberCount);

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
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Decision);

public sealed record ArchitectureRelation(string Key, string Kind, string From, string To, string Basis, string Confidence, string Semantic);

/// <summary>Una relación con su evidencia resuelta (<c>walkie-discovery-relation-evidence.schema.json</c>).</summary>
public sealed record RelationEvidence(Guid SnapshotId, System.Text.Json.JsonElement Relation, IReadOnlyList<System.Text.Json.JsonElement> Evidence);
