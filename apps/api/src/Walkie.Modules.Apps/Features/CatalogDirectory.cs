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

    public async Task<IReadOnlyList<CatalogItemResponse>> ItemsOfAppAsync(
        Guid appId, IReadOnlyCollection<Guid> itemIds, CancellationToken cancellationToken)
    {
        var items = await db.CatalogItems.AsNoTracking()
            .Where(i => i.AppId == appId && itemIds.Contains(i.Id))
            .OrderBy(i => i.Id)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        return items.ConvertAll(CatalogHandlers.ToResponse);
    }

    public async Task<IReadOnlyList<CatalogItemResponse>> AllItemsOfAppAsync(Guid appId, CancellationToken cancellationToken)
    {
        var items = await db.CatalogItems.AsNoTracking()
            .Where(i => i.AppId == appId)
            .OrderBy(i => i.Id)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        return items.ConvertAll(CatalogHandlers.ToResponse);
    }
}
