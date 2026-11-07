using Microsoft.EntityFrameworkCore;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Apps.Persistence;

namespace Walkie.Modules.Apps.Features;

internal sealed class CatalogDirectory(AppsDbContext db) : ICatalogDirectory
{
    public async Task<IReadOnlySet<Guid>> CatalogItemIdsForFeatureAsync(Guid featureId, CancellationToken cancellationToken)
    {
        var ids = await db.Features
            .Where(f => f.Id == featureId)
            .Join(db.CatalogItems, f => f.AppId, i => i.AppId, (f, i) => i.Id)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        return ids.ToHashSet();
    }
}
