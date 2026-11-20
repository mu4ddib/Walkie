using Microsoft.EntityFrameworkCore;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Sharing.Persistence;

namespace Walkie.Modules.Sharing.Features;

/// <summary><c>shareId</c>: la app de la feature del enlace (autorización por app, ADR-0015).</summary>
internal sealed class ShareScope(SharingDbContext db, IFeatureDirectory features) : IAppScopeResolver
{
    public string RouteKey => "shareId";

    public async Task<Guid?> AppOfAsync(Guid id, CancellationToken cancellationToken) =>
        await db.Shares.AsNoTracking().Where(s => s.Id == id).Select(s => (Guid?)s.FeatureId)
            .SingleOrDefaultAsync(cancellationToken).ConfigureAwait(false) is { } featureId
            ? await features.AppOfFeatureAsync(featureId, cancellationToken).ConfigureAwait(false)
            : null;
}
