using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Walkie.Modules.Discovery.Contracts;
using Walkie.Modules.Discovery.Persistence;

namespace Walkie.Modules.Discovery.Features;

/// <summary>
/// Lee lo que necesita <see cref="ArchitectureProjection"/> (spec walkie-live-arquitectura): de cada hallazgo, solo los
/// campos que agrupan (Postgres los saca del <c>jsonb</c>; el resto no viaja); las relaciones sin su <c>jsonb</c>; las
/// limitaciones del manifest; y las decisiones activas de la fuente. Tres consultas, sin N+1, en una transacción de
/// lectura repetible. No escribe nada.
/// </summary>
internal sealed class ArchitectureHandlers(DiscoveryDbContext db)
{
    public const int MaxPageSize = 500;

    public async Task<DiscoveryArchitecture?> OverviewAsync(Guid snapshotId, CancellationToken ct)
    {
        if (await LoadAsync(snapshotId, ct).ConfigureAwait(false) is not { } data)
        {
            return null;
        }

        return ArchitectureProjection.Overview(snapshotId, data.Completeness, data.Entities, data.Relations, Limitations(data.Manifest), data.Decisions);
    }

    public async Task<DiscoveryArchitectureGroup?> GroupAsync(Guid snapshotId, string groupKey, int page, int pageSize, CancellationToken ct)
    {
        if (await LoadAsync(snapshotId, ct).ConfigureAwait(false) is not { } data)
        {
            return null;
        }

        return ArchitectureProjection.Group(groupKey, page, pageSize, data.Entities, data.Relations, data.Decisions);
    }

    private sealed record Data(
        string Completeness, string Manifest, List<ArchitectureEntityRow> Entities, List<ArchitectureRelationRow> Relations, Dictionary<string, string> Decisions);

    private async Task<Data?> LoadAsync(Guid snapshotId, CancellationToken ct)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.RepeatableRead, ct).ConfigureAwait(false);
        var snapshot = await db.Snapshots.AsNoTracking().Where(s => s.Id == snapshotId)
            .Select(s => new { s.AppId, s.SourceId, s.Completeness, s.Manifest })
            .SingleOrDefaultAsync(ct).ConfigureAwait(false);
        if (snapshot is null)
        {
            return null;
        }

        var entities = await db.Database.SqlQuery<ArchitectureEntityRow>($"""
            SELECT key AS "Key", kind AS "Kind", title AS "Title", basis AS "Basis", confidence AS "Confidence",
                   data->>'app' AS "App", data->>'technology' AS "Technology", data->>'route' AS "Route",
                   CASE WHEN kind IN ('module', 'feature') THEN (data->'members')::text END AS "Members",
                   CASE WHEN kind = 'feature' THEN data->>'description' END AS "Description"
            FROM discovery.entities WHERE snapshot_id = {snapshotId}
            """).ToListAsync(ct).ConfigureAwait(false);
        var relations = await db.Relations.AsNoTracking().Where(r => r.SnapshotId == snapshotId)
            .Select(r => new ArchitectureRelationRow(r.Key, r.Kind, r.FromKey, r.ToKey, r.Basis, r.Confidence))
            .ToListAsync(ct).ConfigureAwait(false);
        var decisions = await db.Bindings.AsNoTracking()
            .Where(b => b.AppId == snapshot.AppId && b.SourceId == snapshot.SourceId && b.Decision != null)
            .Select(b => new { b.EntityKey, b.Decision })
            .ToDictionaryAsync(b => b.EntityKey, b => b.Decision!, StringComparer.Ordinal, ct).ConfigureAwait(false);
        await transaction.CommitAsync(ct).ConfigureAwait(false);

        // El orden de Postgres depende de la intercalación: se ordena aquí (ordinal), como el resto del módulo.
        entities.Sort((a, b) => string.CompareOrdinal(a.Key, b.Key));
        relations.Sort((a, b) => string.CompareOrdinal(a.Key, b.Key));
        return new Data(snapshot.Completeness, snapshot.Manifest, entities, relations, decisions);
    }

    /// <summary>Las limitaciones del manifest, tal como las dejó el analizador (texto no confiable: la web lo muestra como texto).</summary>
    private static List<ArchitectureLimitationRow> Limitations(string manifest)
    {
        using var document = JsonDocument.Parse(manifest);
        if (!document.RootElement.TryGetProperty("limitations", out var list) || list.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        return [.. list.EnumerateArray().Select(l => new ArchitectureLimitationRow(
            l.GetProperty("code").GetString()!,
            l.TryGetProperty("message", out var message) ? message.GetString() ?? "" : "",
            l.TryGetProperty("path", out var path) ? path.GetString() : null,
            l.TryGetProperty("detector", out var detector) ? detector.GetString() : null,
            l.TryGetProperty("incomplete", out var incomplete) && incomplete.ValueKind == JsonValueKind.True))];
    }
}
