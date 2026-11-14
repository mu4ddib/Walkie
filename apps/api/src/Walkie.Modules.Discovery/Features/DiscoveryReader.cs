using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Walkie.Modules.Discovery.Contracts;
using Walkie.Modules.Discovery.Persistence;

namespace Walkie.Modules.Discovery.Features;

/// <summary>Implementación de <see cref="IDiscoveryReader"/>: solo lee el schema <c>discovery</c>.</summary>
internal sealed class DiscoveryReader(DiscoveryDbContext db) : IDiscoveryReader
{
    public async Task<DiscoverySnapshotResponse?> SnapshotAsync(Guid snapshotId, CancellationToken cancellationToken)
    {
        var snapshot = await db.Snapshots.AsNoTracking().FirstOrDefaultAsync(s => s.Id == snapshotId, cancellationToken).ConfigureAwait(false);
        return snapshot is null ? null : SnapshotHandlers.Response(snapshot);
    }

    public async Task<IReadOnlyList<DiscoverySnapshotResponse>> SnapshotsOfSourceAsync(Guid appId, Guid sourceId, CancellationToken cancellationToken)
    {
        var snapshots = await db.Snapshots.AsNoTracking()
            .Where(s => s.AppId == appId && s.SourceId == sourceId)
            .OrderByDescending(s => s.ImportedAt).ThenByDescending(s => s.Id)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        return [.. snapshots.Select(s => SnapshotHandlers.Response(s))];
    }

    public async Task<IReadOnlyList<JsonElement>> EntitiesAsync(Guid snapshotId, string? kind, CancellationToken cancellationToken)
    {
        var data = await db.Entities.AsNoTracking()
            .Where(e => e.SnapshotId == snapshotId && (kind == null || e.Kind == kind))
            .OrderBy(e => e.Key)
            .Select(e => new { e.Key, e.Data })
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        return Parse(data.OrderBy(e => e.Key, StringComparer.Ordinal).Select(e => e.Data));
    }

    public async Task<IReadOnlyList<JsonElement>> RelationsAsync(Guid snapshotId, CancellationToken cancellationToken)
    {
        var data = await db.Relations.AsNoTracking().Where(r => r.SnapshotId == snapshotId)
            .Select(r => new { r.Key, r.Data }).ToListAsync(cancellationToken).ConfigureAwait(false);
        return Parse(data.OrderBy(r => r.Key, StringComparer.Ordinal).Select(r => r.Data));
    }

    public async Task<IReadOnlyList<JsonElement>> EvidenceAsync(Guid snapshotId, CancellationToken cancellationToken)
    {
        var data = await db.Evidence.AsNoTracking().Where(e => e.SnapshotId == snapshotId)
            .Select(e => new { e.Id, e.Data }).ToListAsync(cancellationToken).ConfigureAwait(false);
        return Parse(data.OrderBy(e => e.Id, StringComparer.Ordinal).Select(e => e.Data));
    }

    /// <summary>El orden ordinal se aplica en memoria: el de Postgres depende de la intercalación de la base.</summary>
    private static List<JsonElement> Parse(IEnumerable<string> documents) =>
        [.. documents.Select(d =>
        {
            using var document = JsonDocument.Parse(d);
            return document.RootElement.Clone();
        })];
}
