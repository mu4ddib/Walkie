using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Discovery.Contracts;
using Walkie.Modules.Discovery.Domain;
using Walkie.Modules.Discovery.Persistence;
using Walkie.Shared.Discovery;
using Walkie.Shared.Packages;
using Walkie.Shared.Time;

namespace Walkie.Modules.Discovery.Features;

internal abstract record UploadResult
{
    public sealed record Done(DiscoveryUploadResponse Response) : UploadResult;

    public sealed record Invalid(Dictionary<string, string[]> Errors) : UploadResult;

    public sealed record AppNotFound : UploadResult;
}

/// <summary>
/// Recibe un <c>.walkiepack</c> (spec walkie-live, tarea 3; ADR-0012 y ADR-0014). Primero valida todo sin escribir:
/// <list type="number">
/// <item>la app;</item>
/// <item>el zip (<see cref="SafeZip"/>: solo <c>manifest.json</c> y <c>discovery.json</c>, nombres limpios y sin
/// repetir, tamaños declarados y leídos con tope);</item>
/// <item>formato y versiones, antes del schema; las versiones anteriores se migran
/// (<see cref="DiscoveryFormat.Upgrade"/>);</item>
/// <item>el contrato completo con <see cref="DiscoveryPackValidator"/>, sin reglas propias;</item>
/// <item>los límites de procesamiento.</item>
/// </list>
/// Después busca duplicados (mismo archivo, o mismo contenido que el último análisis de la fuente) y, si no es
/// <c>dryRun</c>, guarda el análisis completo en una sola transacción del módulo. No toca ningún otro módulo: ni
/// lienzos, ni catálogo, ni módulos, ni features.
/// </summary>
internal sealed class SnapshotHandlers(DiscoveryDbContext db, IAppDirectory apps, TimeProvider clock)
{
    private static readonly SafeZipOptions ZipOptions = new()
    {
        FormatName = ".walkiepack",
        // Más que las dos permitidas, para que una entrada repetida o inesperada reciba su propio error.
        MaxEntries = 16,
        MaxUncompressedBytes = DiscoveryLimits.MaxUncompressedBytes,
        RejectDuplicateNames = true,
        RejectUnsafeNames = true,
        AllowedEntries = new HashSet<string>([DiscoveryFormat.ManifestPath, DiscoveryFormat.DiscoveryPath], StringComparer.Ordinal),
    };

    public async Task<UploadResult> UploadAsync(Guid appId, byte[] file, bool dryRun, string userId, CancellationToken ct)
    {
        if (!await apps.AppExistsAsync(appId, ct).ConfigureAwait(false))
        {
            return new UploadResult.AppNotFound();
        }

        var errors = new Dictionary<string, string[]>(StringComparer.Ordinal);
        var package = Read(file, errors);
        if (package is null)
        {
            return new UploadResult.Invalid(errors);
        }

        var (manifest, discovery, formatVersion) = package.Value;
        var packSha256 = Convert.ToHexStringLower(SHA256.HashData(file));
        var contentFingerprint = DiscoveryFingerprint.Content(discovery);
        var sourceId = Guid.Parse(manifest.GetProperty("source").GetProperty("id").GetString()!);
        var sourceName = manifest.GetProperty("source").GetProperty("name").GetString()!;

        var sourceExists = await db.Sources.AsNoTracking().AnyAsync(s => s.AppId == appId && s.Id == sourceId, ct).ConfigureAwait(false);
        var (existing, duplicate) = await DuplicateAsync(appId, sourceId, packSha256, contentFingerprint, ct).ConfigureAwait(false);
        var summary = Summary(appId, sourceId, sourceName, sourceExists, formatVersion, manifest, discovery, packSha256, contentFingerprint);

        if (dryRun)
        {
            return new UploadResult.Done(new DiscoveryUploadResponse(true, "preview", duplicate, existing is null ? null : Response(existing), summary));
        }

        if (existing is not null)
        {
            return new UploadResult.Done(new DiscoveryUploadResponse(false, "existing", duplicate, Response(existing), summary));
        }

        try
        {
            var created = await SaveAsync(appId, sourceId, sourceName, formatVersion, manifest, discovery, packSha256, contentFingerprint, userId, ct)
                .ConfigureAwait(false);
            return new UploadResult.Done(new DiscoveryUploadResponse(false, "created", null, Response(created), summary));
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            // Dos subidas del mismo archivo a la vez: la otra ganó. Se responde la que quedó guardada.
            db.ChangeTracker.Clear();
            var (again, reason) = await DuplicateAsync(appId, sourceId, packSha256, contentFingerprint, ct).ConfigureAwait(false);
            if (again is null)
            {
                throw;
            }

            return new UploadResult.Done(new DiscoveryUploadResponse(false, "existing", reason, Response(again), summary with { SourceExists = true }));
        }
    }

    /// <summary>Zip, documentos, versiones, contrato y límites. Null (con los errores por ruta) si algo no sirve.</summary>
    private static (JsonElement Manifest, JsonElement Discovery, int FormatVersion)? Read(byte[] file, Dictionary<string, string[]> errors)
    {
        using var zip = SafeZip.Open(file, ZipOptions, errors);
        if (zip is null)
        {
            return null;
        }

        if (zip.ReadJson(DiscoveryFormat.ManifestPath, errors) is not { } manifest)
        {
            return null;
        }

        // Formato y versiones antes que nada: una versión futura no se lee como si fuera de esta.
        var versionErrors = DiscoveryPackValidator.ValidateVersions(manifest);
        if (versionErrors.Count > 0)
        {
            Merge(errors, versionErrors);
            return null;
        }

        if (zip.ReadJson(DiscoveryFormat.DiscoveryPath, errors) is not { } discovery)
        {
            return null;
        }

        if (discovery.ValueKind != JsonValueKind.Object)
        {
            errors[DiscoveryFormat.DiscoveryPath] = ["Tiene que ser un objeto JSON."];
            return null;
        }

        var formatVersion = manifest.GetProperty("formatVersion").GetInt32();
        if (formatVersion < DiscoveryFormat.CurrentVersion)
        {
            var (upgradedManifest, upgradedDiscovery) = DiscoveryFormat.Upgrade(
                formatVersion, JsonNode.Parse(manifest.GetRawText())!.AsObject(), JsonNode.Parse(discovery.GetRawText())!.AsObject());
            manifest = JsonSerializer.SerializeToElement(upgradedManifest);
            discovery = JsonSerializer.SerializeToElement(upgradedDiscovery);
        }

        // Límites antes del validador: así un paquete enorme no se recorre entero.
        foreach (var (name, max) in new[] { ("entities", DiscoveryLimits.MaxEntities), ("relations", DiscoveryLimits.MaxRelations), ("evidence", DiscoveryLimits.MaxEvidence) })
        {
            if (discovery.TryGetProperty(name, out var array) && array.ValueKind == JsonValueKind.Array && array.GetArrayLength() > max)
            {
                errors[$"{DiscoveryFormat.DiscoveryPath}/{name}"] = [string.Create(CultureInfo.InvariantCulture,
                    $"Trae {array.GetArrayLength()} y el máximo es {max}: analiza una parte del proyecto (walkie scan <carpeta> o --detectors).")];
            }
        }

        if (errors.Count > 0)
        {
            return null;
        }

        var contractErrors = DiscoveryPackValidator.Validate(manifest, discovery);
        if (contractErrors.Count > 0)
        {
            Merge(errors, contractErrors);
            return null;
        }

        return (manifest, discovery, formatVersion);
    }

    /// <summary>
    /// El análisis que ya representa a este paquete (ADR-0014): el mismo archivo en la fuente, o un último análisis de
    /// la fuente con el mismo contenido (otro <c>generatedAt</c> del mismo árbol).
    /// </summary>
    private async Task<(Snapshot? Existing, string? Duplicate)> DuplicateAsync(
        Guid appId, Guid sourceId, string packSha256, string contentFingerprint, CancellationToken ct)
    {
        var samePack = await db.Snapshots.AsNoTracking()
            .FirstOrDefaultAsync(s => s.AppId == appId && s.SourceId == sourceId && s.PackSha256 == packSha256, ct).ConfigureAwait(false);
        if (samePack is not null)
        {
            return (samePack, "pack");
        }

        var latest = await Latest(appId, sourceId).AsNoTracking().FirstOrDefaultAsync(ct).ConfigureAwait(false);
        return latest?.ContentFingerprint == contentFingerprint ? (latest, "content") : (null, null);
    }

    private async Task<Snapshot> SaveAsync(Guid appId, Guid sourceId, string sourceName, int formatVersion, JsonElement manifest,
        JsonElement discovery, string packSha256, string contentFingerprint, string userId, CancellationToken ct)
    {
        var now = clock.GetUtcNowForDb();
        var source = await db.Sources.FirstOrDefaultAsync(s => s.AppId == appId && s.Id == sourceId, ct).ConfigureAwait(false);
        if (source is null)
        {
            db.Sources.Add(new Source { AppId = appId, Id = sourceId, Name = sourceName, CreatedBy = userId, CreatedAt = now, UpdatedAt = now });
        }
        else if (source.Name != sourceName)
        {
            source.Name = sourceName;
            source.UpdatedAt = now;
        }

        var previous = await Latest(appId, sourceId).AsNoTracking().Select(s => (Guid?)s.Id).FirstOrDefaultAsync(ct).ConfigureAwait(false);
        var analyzer = manifest.GetProperty("analyzer");
        var snapshot = new Snapshot
        {
            AppId = appId,
            SourceId = sourceId,
            PreviousSnapshotId = previous,
            FormatVersion = formatVersion,
            AnalyzerName = analyzer.GetProperty("name").GetString()!,
            AnalyzerVersion = analyzer.GetProperty("version").GetString()!,
            GeneratedAt = DateTimeOffset.Parse(manifest.GetProperty("generatedAt").GetString()!, CultureInfo.InvariantCulture),
            ImportedAt = now,
            ImportedBy = userId,
            Completeness = manifest.GetProperty("completeness").GetString()!,
            PackSha256 = packSha256,
            ContentFingerprint = contentFingerprint,
            Manifest = manifest.GetRawText(),
        };
        db.Snapshots.Add(snapshot);

        db.Entities.AddRange(discovery.GetProperty("entities").EnumerateArray().Select(e => new DiscoveredEntity
        {
            SnapshotId = snapshot.Id,
            Key = e.GetProperty("key").GetString()!,
            Kind = e.GetProperty("kind").GetString()!,
            Title = e.GetProperty("title").GetString()!,
            Basis = e.GetProperty("basis").GetString()!,
            Confidence = e.GetProperty("confidence").GetString()!,
            Fingerprint = e.GetProperty("fingerprint").GetString()!,
            Data = e.GetRawText(),
        }));
        db.Relations.AddRange(discovery.GetProperty("relations").EnumerateArray().Select(r => new DiscoveredRelation
        {
            SnapshotId = snapshot.Id,
            Key = r.GetProperty("key").GetString()!,
            Kind = r.GetProperty("kind").GetString()!,
            FromKey = r.GetProperty("from").GetString()!,
            ToKey = r.GetProperty("to").GetString()!,
            Basis = r.GetProperty("basis").GetString()!,
            Confidence = r.GetProperty("confidence").GetString()!,
            Data = r.GetRawText(),
        }));
        db.Evidence.AddRange(discovery.GetProperty("evidence").EnumerateArray().Select(e => new DiscoveredEvidence
        {
            SnapshotId = snapshot.Id,
            Id = e.GetProperty("id").GetString()!,
            Detector = e.GetProperty("detector").GetString()!,
            Path = e.GetProperty("path").GetString()!,
            Data = e.GetRawText(),
        }));

        // Un solo SaveChanges: una transacción de Postgres. Si algo falla, no queda nada del análisis a medias.
        await db.SaveChangesAsync(ct).ConfigureAwait(false);
        return snapshot;
    }

    private IQueryable<Snapshot> Latest(Guid appId, Guid sourceId) =>
        db.Snapshots.Where(s => s.AppId == appId && s.SourceId == sourceId).OrderByDescending(s => s.ImportedAt).ThenByDescending(s => s.Id);

    private static DiscoveryUploadSummary Summary(Guid appId, Guid sourceId, string sourceName, bool sourceExists, int formatVersion,
        JsonElement manifest, JsonElement discovery, string packSha256, string contentFingerprint) =>
        new(
            appId,
            new DiscoverySourceResponse(sourceId, sourceName),
            sourceExists,
            formatVersion,
            manifest.GetProperty("analyzer").Clone(),
            manifest.TryGetProperty("vcs", out var vcs) ? vcs.Clone() : null,
            DateTimeOffset.Parse(manifest.GetProperty("generatedAt").GetString()!, CultureInfo.InvariantCulture),
            manifest.GetProperty("completeness").GetString()!,
            manifest.GetProperty("detectors").Clone(),
            manifest.GetProperty("technologies").Clone(),
            manifest.GetProperty("limitations").Clone(),
            manifest.GetProperty("stats").Clone(),
            discovery.GetProperty("entities").EnumerateArray()
                .GroupBy(e => e.GetProperty("kind").GetString()!, StringComparer.Ordinal)
                .OrderBy(g => g.Key, StringComparer.Ordinal)
                .ToDictionary(g => g.Key, g => g.Count(), StringComparer.Ordinal),
            packSha256,
            contentFingerprint);

    internal static DiscoverySnapshotResponse Response(Snapshot snapshot, string? sourceName = null)
    {
        using var document = JsonDocument.Parse(snapshot.Manifest);
        var manifest = document.RootElement;
        return new DiscoverySnapshotResponse(
            snapshot.Id,
            snapshot.AppId,
            new DiscoverySourceResponse(snapshot.SourceId, sourceName ?? manifest.GetProperty("source").GetProperty("name").GetString()!),
            snapshot.PreviousSnapshotId,
            snapshot.FormatVersion,
            manifest.GetProperty("analyzer").Clone(),
            manifest.TryGetProperty("vcs", out var vcs) ? vcs.Clone() : null,
            snapshot.GeneratedAt,
            snapshot.ImportedAt,
            snapshot.ImportedBy,
            snapshot.Completeness,
            manifest.GetProperty("detectors").Clone(),
            manifest.GetProperty("technologies").Clone(),
            manifest.GetProperty("limitations").Clone(),
            manifest.GetProperty("stats").Clone(),
            snapshot.PackSha256,
            snapshot.ContentFingerprint);
    }

    private static void Merge(Dictionary<string, string[]> errors, Dictionary<string, string[]> more)
    {
        foreach (var (path, messages) in more)
        {
            errors[path] = messages;
        }
    }
}
