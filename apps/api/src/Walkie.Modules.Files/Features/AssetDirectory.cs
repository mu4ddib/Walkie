using Microsoft.EntityFrameworkCore;
using Walkie.Modules.Files.Contracts;
using Walkie.Modules.Files.Persistence;
using Walkie.Modules.Files.Storage;

namespace Walkie.Modules.Files.Features;

internal sealed class AssetDirectory(FilesDbContext db, IFileStorage storage) : IAssetDirectory
{
    public async Task<IReadOnlySet<Guid>> ExistingInAppAsync(
        Guid appId, IReadOnlyCollection<Guid> assetIds, CancellationToken cancellationToken) =>
        (await db.Assets.Where(a => a.AppId == appId && assetIds.Contains(a.Id)).Select(a => a.Id)
            .ToListAsync(cancellationToken).ConfigureAwait(false)).ToHashSet();

    public async Task<AssetContent?> OpenInAppAsync(Guid appId, Guid assetId, CancellationToken cancellationToken)
    {
        var asset = await db.Assets.AsNoTracking()
            .SingleOrDefaultAsync(a => a.Id == assetId && a.AppId == appId, cancellationToken).ConfigureAwait(false);
        if (asset is null)
        {
            return null;
        }

        var content = await storage.GetAsync(asset.StorageKey, cancellationToken).ConfigureAwait(false);
        return content is null ? null : new AssetContent(asset.ContentType, content);
    }
}
