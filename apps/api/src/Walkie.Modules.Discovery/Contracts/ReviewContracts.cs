using System.Text.Json.Serialization;
using Walkie.Modules.Apps.Contracts;

namespace Walkie.Modules.Discovery.Contracts;

/// <summary>Elemento de Walkie al que apunta un vínculo (<c>$defs/target</c> de <c>walkie-discovery-binding</c>).</summary>
public sealed record DiscoveryTarget(
    string Kind,
    Guid Id,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Title = null);

/// <summary>Vínculo guardado (<c>walkie-discovery-binding.schema.json</c>).</summary>
public sealed record DiscoveryBindingResponse(
    Guid SourceId,
    string EntityKey,
    string Decision,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] DiscoveryTarget? Target,
    string EntityFingerprint,
    Guid SnapshotId,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Guid? ApplyId,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Note,
    string DecidedBy,
    DateTimeOffset DecidedAt,
    int Version);

/// <summary>Con qué coincide y por qué (<c>match</c> y <c>candidates</c> de la revisión).</summary>
public sealed record DiscoveryMatch(DiscoveryTarget Target, string Reason);

/// <summary>Lo que Walkie sugiere para un hallazgo.</summary>
public sealed record DiscoveryProposal(
    string Op,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] DiscoveryTarget? Target = null);

/// <summary>Un hallazgo de la revisión (<c>$defs/item</c> de <c>walkie-discovery-review</c>).</summary>
public sealed record DiscoveryReviewItem(
    string Key,
    string Kind,
    string Title,
    string Basis,
    string Confidence,
    string Status,
    string Fingerprint,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] DiscoveryBindingResponse? Binding,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] DiscoveryMatch? Match,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<DiscoveryMatch>? Candidates,
    int EvidenceCount,
    DiscoveryProposal Proposal,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] bool? TargetMissing = null);

public sealed record DiscoveryReviewCounts(int New, int Matched, int Linked, int Created, int Rejected, int Changed, int Missing);

public sealed record DiscoveryReviewPage(int Index, int Size, int Total);

/// <summary>Una página de la revisión calculada (<c>walkie-discovery-review.schema.json</c>). No se guarda.</summary>
public sealed record DiscoveryReviewResponse(
    Guid SnapshotId,
    Guid SourceId,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Guid? PreviousSnapshotId,
    DiscoveryReviewCounts Counts,
    DiscoveryReviewPage Page,
    IReadOnlyList<DiscoveryReviewItem> Items);

/// <summary>
/// Un elemento creado o vinculado en el resultado de aplicar. <c>Item</c>: solo al crear en el catálogo, el elemento tal
/// como queda (<c>walkie-catalog-item</c>).
/// </summary>
public sealed record DiscoveryAppliedTarget(
    string EntityKey,
    DiscoveryTarget Target,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] CatalogItemResponse? Item = null);

public sealed record DiscoveryApplyWarning(
    string Code,
    string Message,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? EntityKey = null);

/// <summary>Resultado de aplicar (<c>walkie-discovery-apply-result.schema.json</c>).</summary>
public sealed record DiscoveryApplyResult(
    Guid ApplyId,
    bool DryRun,
    string Status,
    IReadOnlyList<DiscoveryAppliedTarget> Created,
    IReadOnlyList<DiscoveryAppliedTarget> Linked,
    IReadOnlyList<string> Rejected,
    IReadOnlyList<string> Reset,
    IReadOnlyList<DiscoveryTarget> Unchanged,
    IReadOnlyList<DiscoveryApplyWarning> Warnings);

/// <summary>Una fuente de una app con su último análisis.</summary>
public sealed record DiscoverySourceItem(
    DiscoverySourceResponse Source,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    int SnapshotCount,
    DiscoverySnapshotResponse LatestSnapshot);

/// <summary>Fuentes de una app (<c>walkie-discovery-sources.schema.json</c>).</summary>
public sealed record DiscoverySourcesResponse(Guid AppId, IReadOnlyList<DiscoverySourceItem> Sources);
