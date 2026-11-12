using Microsoft.EntityFrameworkCore;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Apps.Domain;
using Walkie.Modules.Apps.Persistence;
using Walkie.Shared.Time;

namespace Walkie.Modules.Apps.Features;

internal sealed class AppWriter(AppsDbContext db, TimeProvider clock) : IAppWriter
{
    public async Task<Guid> CreateAppAsync(string name, string userId, CancellationToken cancellationToken)
    {
        var app = new App { Name = name.Trim(), CreatedBy = userId, CreatedAt = clock.GetUtcNowForDb() };
        db.Apps.Add(app);
        await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        return app.Id;
    }

    public async Task<IReadOnlyList<string>> AppNamesAsync(CancellationToken cancellationToken) =>
        await db.Apps.AsNoTracking().Select(a => a.Name).ToListAsync(cancellationToken).ConfigureAwait(false);

    public async Task DeleteAppAsync(Guid appId, CancellationToken cancellationToken)
    {
        await db.CatalogItems.Where(i => i.AppId == appId).ExecuteDeleteAsync(cancellationToken).ConfigureAwait(false);
        await db.Features.Where(f => f.AppId == appId).ExecuteDeleteAsync(cancellationToken).ConfigureAwait(false);
        await db.Apps.Where(a => a.Id == appId).ExecuteDeleteAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task<Guid> CreateFeatureAsync(
        Guid appId, string name, string? description, string userId, CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNowForDb();
        var feature = new Feature
        {
            AppId = appId,
            Name = name.Trim(),
            Description = description?.Trim() ?? "",
            CreatedBy = userId,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Features.Add(feature);
        await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        return feature.Id;
    }

    public async Task<Guid> CreateCatalogItemAsync(
        Guid appId, CatalogItemResponse source, string userId, CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNowForDb();
        var item = new CatalogItem
        {
            AppId = appId,
            Type = source.Type,
            Title = source.Title.Trim(),
            Description = string.IsNullOrWhiteSpace(source.Description) ? null : source.Description.Trim(),
            Http = source.Http?.GetRawText(),
            Database = source.Database?.GetRawText(),
            Resource = source.Resource?.GetRawText(),
            Runtime = source.Runtime,
            CreatedBy = userId,
            CreatedAt = now,
            UpdatedBy = userId,
            UpdatedAt = now,
        };
        db.CatalogItems.Add(item);
        await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        return item.Id;
    }

    public async Task DeleteFeaturesAsync(IReadOnlyCollection<Guid> featureIds, CancellationToken cancellationToken) =>
        await db.Features.Where(f => featureIds.Contains(f.Id)).ExecuteDeleteAsync(cancellationToken).ConfigureAwait(false);

    public async Task DeleteCatalogItemsAsync(IReadOnlyCollection<Guid> itemIds, CancellationToken cancellationToken) =>
        await db.CatalogItems.Where(i => itemIds.Contains(i.Id)).ExecuteDeleteAsync(cancellationToken).ConfigureAwait(false);
}
