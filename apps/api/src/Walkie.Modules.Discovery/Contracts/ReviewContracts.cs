using System.Text.Json;
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
    int Version,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? DecidedKey = null);

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
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] bool? TargetMissing = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] DiscoveryBindingResponse? LegacyBinding = null)
{
    /// <summary>Respecto del análisis anterior: <c>added</c>, <c>modified</c> o <c>unchanged</c> (solo con anterior).</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Change { get; init; }

    /// <summary>Solo en <c>unverified</c>: por qué no se puede concluir que desapareció (qué no cubrió este análisis).</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Coverage { get; init; }

    /// <summary>Pide una decisión de una persona (sin decidir, sugerido, cambiado, desaparecido o con una decisión vieja ambigua).</summary>
    public bool NeedsReview { get; init; }
}

public sealed record DiscoveryReviewCounts(int New, int Matched, int Linked, int Created, int Rejected, int Changed, int Missing, int Unverified);

/// <summary>
/// Cómo cambió el análisis respecto del anterior de la misma fuente (tarea 10): hallazgos que aparecen (<c>added</c>),
/// que cambiaron de contenido (<c>modified</c>) o que siguen iguales (<c>unchanged</c>), y cuántos piden una decisión.
/// Los que ya no aparecen están en <c>counts.missing</c> (con cobertura suficiente) y <c>counts.unverified</c> (sin ella).
/// </summary>
public sealed record DiscoveryReviewComparison(int Added, int Modified, int Unchanged, int NeedsReview);

public sealed record DiscoveryReviewPage(int Index, int Size, int Total);

/// <summary>Una página de la revisión calculada (<c>walkie-discovery-review.schema.json</c>). No se guarda.</summary>
public sealed record DiscoveryReviewResponse(
    Guid SnapshotId,
    Guid SourceId,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Guid? PreviousSnapshotId,
    DiscoveryReviewCounts Counts,
    DiscoveryReviewPage Page,
    IReadOnlyList<DiscoveryReviewItem> Items)
{
    /// <summary>El análisis anterior de la fuente (fechas, commit y completitud), con el que se compara.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public DiscoverySnapshotBrief? Previous { get; init; }

    /// <summary>La comparación con el anterior; sin análisis anterior, todo es nuevo y no viene.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public DiscoveryReviewComparison? Comparison { get; init; }
}

/// <summary>
/// Un elemento creado o vinculado en el resultado de aplicar. <c>Item</c>: solo al crear en el catálogo, el elemento tal
/// como queda (<c>walkie-catalog-item</c>).
/// </summary>
public sealed record DiscoveryAppliedTarget(
    string EntityKey,
    DiscoveryTarget Target,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] CatalogItemResponse? Item = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<string>? Includes = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] DiscoveryCanvasDraft? Canvas = null);

/// <summary>
/// El lienzo inicial de un módulo o una feature que se crea (tarea 9): sus cajas, conexiones e interfaces por clave del
/// borrador, lo que se dejó fuera y por qué, y —cuando la solicitud trae los ids y las posiciones— el grafo tal como se
/// guardará (<c>walkie-graph</c>).
/// </summary>
public sealed record DiscoveryCanvasDraft(
    IReadOnlyList<DiscoveryDraftNode> Nodes,
    IReadOnlyList<DiscoveryDraftEdge> Edges,
    IReadOnlyList<DiscoveryDraftInterface> Interfaces,
    IReadOnlyList<DiscoveryDraftOmission> Omitted,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] JsonElement? Graph = null);

/// <summary>Una caja del borrador: pantalla propia, <c>ref</c> a un elemento del catálogo o caja de un módulo.</summary>
public sealed record DiscoveryDraftNode(
    string Key,
    string Type,
    string Title,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Route = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Guid? CatalogId = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Guid? ModuleId = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Guid? TargetFeatureId = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Guid? Existing = null);

/// <summary>Una conexión del borrador, de una relación observada (<c>navigates</c> o <c>calls</c>).</summary>
public sealed record DiscoveryDraftEdge(
    string Key,
    string From,
    string To,
    string Kind,
    string Operation,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] DiscoveryInterfaceRef? ToInterface = null);

/// <summary>Una interfaz de un módulo existente en un extremo de una conexión (id estable y último nombre).</summary>
public sealed record DiscoveryInterfaceRef(string Id, string Name);

/// <summary>Una interfaz del módulo que se crea, implementada por la caja <see cref="Node"/>.</summary>
public sealed record DiscoveryDraftInterface(string Key, string Name, string Kind, string Node);

/// <summary>Algo del hallazgo que no entra al lienzo, con un código estable y el porqué.</summary>
public sealed record DiscoveryDraftOmission(string Key, string Code, string Message);

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
    IReadOnlyList<DiscoveryApplyWarning> Warnings)
{
    /// <summary>Pantallas incorporadas a features existentes (<c>attach</c>, ADR-0018); null si no hay.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public IReadOnlyList<DiscoveryAttached>? Attached { get; init; }
}

/// <summary>Una pantalla que se incorpora a una feature existente: lo que su lienzo ya tiene y lo que se agrega.</summary>
public sealed record DiscoveryAttached(string EntityKey, DiscoveryTarget Target, int CanvasVersion, DiscoveryCanvasExisting Existing, DiscoveryCanvasDraft Canvas);

/// <summary>Lo que el lienzo existente ya tiene (no cambia).</summary>
public sealed record DiscoveryCanvasExisting(int Nodes, int Edges, int Tours);

/// <summary>Una fuente de una app con su último análisis.</summary>
public sealed record DiscoverySourceItem(
    DiscoverySourceResponse Source,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    int SnapshotCount,
    DiscoverySnapshotResponse LatestSnapshot);

/// <summary>Fuentes de una app (<c>walkie-discovery-sources.schema.json</c>).</summary>
public sealed record DiscoverySourcesResponse(Guid AppId, IReadOnlyList<DiscoverySourceItem> Sources);
