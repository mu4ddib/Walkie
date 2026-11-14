namespace Walkie.Modules.Discovery.Domain;

/// <summary>
/// Fuente local de una app (ADR-0012): un proyecto analizado, con el id estable que su analizador guarda en
/// <c>.walkie/source.json</c>. La misma fuente puede estar en varias apps; la clave es (app, fuente).
/// </summary>
internal sealed class Source
{
    public const int NameMaxLength = 120;

    public Guid AppId { get; init; }

    public Guid Id { get; init; }

    /// <summary>Último nombre que trajo un paquete de esta fuente.</summary>
    public required string Name { get; set; }

    public required string CreatedBy { get; init; }

    public DateTimeOffset CreatedAt { get; init; }

    public DateTimeOffset UpdatedAt { get; set; }
}

/// <summary>
/// Un análisis cargado (ADR-0014, <c>walkie-discovery-snapshot.schema.json</c>): la procedencia de un
/// <c>.walkiepack</c>. Inmutable: <see cref="Persistence.DiscoveryDbContext"/> rechaza modificarlo o borrarlo.
/// </summary>
internal sealed class Snapshot
{
    public Guid Id { get; init; } = Guid.CreateVersion7();

    public Guid AppId { get; init; }

    public Guid SourceId { get; init; }

    /// <summary>Análisis anterior de la misma fuente en la app (contra el que se calcularán changed y missing).</summary>
    public Guid? PreviousSnapshotId { get; init; }

    /// <summary><c>formatVersion</c> con la que llegó el paquete (antes de migrarlo).</summary>
    public int FormatVersion { get; init; }

    public required string AnalyzerName { get; init; }

    public required string AnalyzerVersion { get; init; }

    public DateTimeOffset GeneratedAt { get; init; }

    public DateTimeOffset ImportedAt { get; init; }

    /// <summary>Claim <c>sub</c> de quien lo cargó (ADR-0003).</summary>
    public required string ImportedBy { get; init; }

    /// <summary><c>complete</c> o <c>partial</c>.</summary>
    public required string Completeness { get; init; }

    /// <summary>SHA-256 en hexadecimal del archivo tal como se subió.</summary>
    public required string PackSha256 { get; init; }

    /// <summary><c>DiscoveryFingerprint.Content</c> del <c>discovery.json</c>.</summary>
    public required string ContentFingerprint { get; init; }

    /// <summary>El <c>manifest.json</c> ya migrado a la versión actual (detectores, alcance, tecnologías, limitaciones…), como <c>jsonb</c>.</summary>
    public required string Manifest { get; init; }
}

/// <summary>Una entidad de un análisis, tal como vino (<c>$defs/entity</c> de <c>walkie-discovery</c>), con sus campos de búsqueda.</summary>
internal sealed class DiscoveredEntity
{
    public Guid SnapshotId { get; init; }

    /// <summary>Clave estable (ADR-0014): la identidad entre análisis.</summary>
    public required string Key { get; init; }

    public required string Kind { get; init; }

    public required string Title { get; init; }

    public required string Basis { get; init; }

    public required string Confidence { get; init; }

    public required string Fingerprint { get; init; }

    /// <summary>La entidad completa como <c>jsonb</c>.</summary>
    public required string Data { get; init; }
}

/// <summary>Una relación de un análisis (<c>$defs/relation</c>).</summary>
internal sealed class DiscoveredRelation
{
    public Guid SnapshotId { get; init; }

    public required string Key { get; init; }

    public required string Kind { get; init; }

    public required string FromKey { get; init; }

    public required string ToKey { get; init; }

    public required string Basis { get; init; }

    public required string Confidence { get; init; }

    public required string Data { get; init; }
}

/// <summary>Una evidencia de un análisis (<c>$defs/evidence</c>): archivo relativo, ancla, líneas, detector y confianza.</summary>
internal sealed class DiscoveredEvidence
{
    public Guid SnapshotId { get; init; }

    public required string Id { get; init; }

    public required string Detector { get; init; }

    public required string Path { get; init; }

    public required string Data { get; init; }
}
