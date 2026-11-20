using Microsoft.EntityFrameworkCore;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Discovery.Persistence;

namespace Walkie.Modules.Discovery.Features;

/// <summary><c>snapshotId</c>: la app de un análisis (autorización por app, ADR-0015).</summary>
internal sealed class SnapshotScope(DiscoveryDbContext db) : IAppScopeResolver
{
    public string RouteKey => "snapshotId";

    public async Task<Guid?> AppOfAsync(Guid id, CancellationToken cancellationToken) =>
        await db.Snapshots.AsNoTracking().Where(s => s.Id == id).Select(s => (Guid?)s.AppId)
            .SingleOrDefaultAsync(cancellationToken).ConfigureAwait(false);
}
