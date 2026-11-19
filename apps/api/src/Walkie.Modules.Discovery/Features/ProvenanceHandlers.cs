using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Discovery.Contracts;
using Walkie.Modules.Discovery.Persistence;

namespace Walkie.Modules.Discovery.Features;

/// <summary>Un hallazgo resumido (sin evidencia ni contrato), en el análisis en el que se decidió.</summary>
internal sealed record ProvenanceEntity(string Key, string Kind, string Title, string Basis, string Confidence);

/// <summary>El último análisis de la fuente frente a la decisión: <c>same</c>, <c>changed</c> o <c>not-found</c>.</summary>
internal sealed record ProvenanceLatest(Guid SnapshotId, string Status);

/// <summary>Un vínculo activo hacia el elemento, con su hallazgo y su evidencia (<c>$defs/origin</c>).</summary>
internal sealed record ProvenanceOrigin(
    DiscoverySourceResponse Source,
    DiscoveryBindingResponse Binding,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] ProvenanceEntity? Entity,
    IReadOnlyList<JsonElement> Evidence,
    int EvidenceTotal,
    ProvenanceLatest Latest);

/// <summary>De dónde viene un elemento (<c>walkie-discovery-provenance.schema.json</c>).</summary>
internal sealed record ProvenanceResponse(Guid AppId, DiscoveryTarget Target, bool TargetExists, IReadOnlyList<ProvenanceOrigin> Bindings);

internal abstract record ProvenanceResult
{
    public sealed record Done(ProvenanceResponse Response) : ProvenanceResult;

    public sealed record Invalid(Dictionary<string, string[]> Errors) : ProvenanceResult;

    public sealed record NotFound : ProvenanceResult;
}

/// <summary>
/// <c>GET /api/apps/{appId}/bindings?target={kind}:{id}</c> (spec walkie-live, tarea 6; ADR-0012): de qué hallazgos
/// viene un elemento de la app. Lee los vínculos activos (linked o created) que apuntan a él, por el índice
/// <c>ix_bindings_app_target</c>, y de cada uno el hallazgo y hasta <see cref="MaxEvidence"/> evidencias del análisis
/// en el que se decidió. Solo lectura: no reescribe el elemento ni lo bloquea; si se borró, lo dice
/// (<c>targetExists</c>) en vez de presentarlo como un vínculo válido.
/// </summary>
internal sealed class ProvenanceHandlers(
    DiscoveryDbContext db, EvidenceHandlers evidence, IAppDirectory apps, ICatalogDirectory catalog, IFeatureDirectory features)
{
    public const int MaxEvidence = 20;
    private static readonly string[] Kinds = ["catalogItem", "module", "feature"];

    public async Task<ProvenanceResult> ForTargetAsync(Guid appId, string? target, CancellationToken ct)
    {
        var parts = target?.Split(':', 2);
        if (parts is not [var kind, var raw] || !Kinds.Contains(kind) || !Guid.TryParse(raw, out var targetId))
        {
            return new ProvenanceResult.Invalid(new Dictionary<string, string[]>
            {
                ["target"] = ["Usa target=catalogItem:{id}, module:{id} o feature:{id}."],
            });
        }

        if (!await apps.AppExistsAsync(appId, ct).ConfigureAwait(false))
        {
            return new ProvenanceResult.NotFound();
        }

        var title = await TitleAsync(appId, kind, targetId, ct).ConfigureAwait(false);
        var bindings = await db.Bindings.AsNoTracking()
            .Where(b => b.AppId == appId && b.TargetKind == kind && b.TargetId == targetId && (b.Decision == "linked" || b.Decision == "created"))
            .OrderBy(b => b.DecidedAt).ThenBy(b => b.EntityKey)
            .ToListAsync(ct).ConfigureAwait(false);
        var sourceIds = bindings.Select(b => b.SourceId).Distinct().ToList();
        var sources = await db.Sources.AsNoTracking()
            .Where(s => s.AppId == appId && sourceIds.Contains(s.Id))
            .ToDictionaryAsync(s => s.Id, s => s.Name, ct).ConfigureAwait(false);
        // Pocas fuentes por elemento (normalmente una): una consulta por fuente.
        var latestBySource = new Dictionary<Guid, Guid>();
        foreach (var sourceId in sourceIds)
        {
            latestBySource[sourceId] = await db.Snapshots.AsNoTracking()
                .Where(s => s.AppId == appId && s.SourceId == sourceId)
                .OrderByDescending(s => s.ImportedAt).ThenByDescending(s => s.Id)
                .Select(s => s.Id).FirstAsync(ct).ConfigureAwait(false);
        }

        var origins = new List<ProvenanceOrigin>();
        foreach (var binding in bindings)
        {
            var decidedIn = binding.SnapshotId!.Value;
            var decidedKey = binding.DecidedKey ?? binding.EntityKey; // una decisión de la versión 0 conserva su clave vieja ahí
            var entity = await db.Entities.AsNoTracking()
                .Where(e => e.SnapshotId == decidedIn && e.Key == decidedKey)
                .Select(e => new ProvenanceEntity(e.Key, e.Kind, e.Title, e.Basis, e.Confidence))
                .FirstOrDefaultAsync(ct).ConfigureAwait(false);
            var found = await evidence.EvidenceAsync(decidedIn, decidedKey, ct).ConfigureAwait(false);
            var latestId = latestBySource[binding.SourceId];
            var latestFingerprint = await db.Entities.AsNoTracking()
                .Where(e => e.SnapshotId == latestId && e.Key == binding.EntityKey)
                .Select(e => e.Fingerprint).FirstOrDefaultAsync(ct).ConfigureAwait(false);
            origins.Add(new ProvenanceOrigin(
                new DiscoverySourceResponse(binding.SourceId, sources[binding.SourceId]),
                ReviewHandlers.BindingResponse(binding),
                entity,
                [.. (found?.Evidence ?? []).Take(MaxEvidence)],
                found?.Evidence.Count ?? 0,
                new ProvenanceLatest(latestId, latestFingerprint is null ? "not-found" : latestFingerprint == binding.EntityFingerprint ? "same" : "changed")));
        }

        var known = title ?? bindings.Select(b => b.TargetTitle).LastOrDefault(t => t is not null);
        return new ProvenanceResult.Done(new ProvenanceResponse(appId, new DiscoveryTarget(kind, targetId, known), title is not null, origins));
    }

    /// <summary>El título actual del elemento, o null si ya no existe en la app.</summary>
    private async Task<string?> TitleAsync(Guid appId, string kind, Guid targetId, CancellationToken ct)
    {
        if (kind == "catalogItem")
        {
            var items = await catalog.ItemsOfAppAsync(appId, [targetId], ct).ConfigureAwait(false);
            return items.Count == 1 ? items[0].Title : null;
        }

        var summary = await features.DescribeAsync(targetId, ct).ConfigureAwait(false);
        return summary is not null && summary.AppId == appId && summary.Kind == kind ? summary.Name : null;
    }
}
