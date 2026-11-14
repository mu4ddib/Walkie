using Microsoft.EntityFrameworkCore;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Discovery.Contracts;
using Walkie.Modules.Discovery.Persistence;

namespace Walkie.Modules.Discovery.Features;

/// <summary>
/// Fuentes de una app con su último análisis (<c>GET /api/apps/{appId}/sources</c>, <c>walkie-discovery-sources</c>).
/// Solo las de esa app. Tres consultas fijas, sin una por fuente: las fuentes, los análisis (solo id, fuente y fecha)
/// y el último análisis de cada fuente.
/// </summary>
internal sealed class SourceHandlers(DiscoveryDbContext db, IAppDirectory apps)
{
    public async Task<DiscoverySourcesResponse?> SourcesAsync(Guid appId, CancellationToken ct)
    {
        if (!await apps.AppExistsAsync(appId, ct).ConfigureAwait(false))
        {
            return null;
        }

        var sources = await db.Sources.AsNoTracking().Where(s => s.AppId == appId).ToListAsync(ct).ConfigureAwait(false);
        var snapshots = await db.Snapshots.AsNoTracking()
            .Where(s => s.AppId == appId)
            .Select(s => new { s.Id, s.SourceId, s.ImportedAt })
            .ToListAsync(ct).ConfigureAwait(false);
        var bySource = snapshots
            .GroupBy(s => s.SourceId)
            .ToDictionary(g => g.Key, g => (Count: g.Count(), Latest: g.OrderByDescending(s => s.ImportedAt).ThenByDescending(s => s.Id).First()));
        var latestIds = bySource.Values.Select(v => v.Latest.Id).ToList();
        var latest = await db.Snapshots.AsNoTracking()
            .Where(s => latestIds.Contains(s.Id))
            .ToDictionaryAsync(s => s.Id, ct).ConfigureAwait(false);

        var items = sources
            .Where(s => bySource.ContainsKey(s.Id))
            .Select(s => new DiscoverySourceItem(
                new DiscoverySourceResponse(s.Id, s.Name),
                s.CreatedAt,
                s.UpdatedAt,
                bySource[s.Id].Count,
                SnapshotHandlers.Response(latest[bySource[s.Id].Latest.Id])))
            .OrderByDescending(i => i.LatestSnapshot.ImportedAt).ThenBy(i => i.Source.Id)
            .ToList();
        return new DiscoverySourcesResponse(appId, items);
    }
}
