using Microsoft.EntityFrameworkCore;
using Walkie.Modules.Files.Contracts;
using Walkie.Modules.Files.Persistence;

namespace Walkie.Modules.Files.Features;

internal sealed class AssetDirectory(FilesDbContext db) : IAssetDirectory
{
    public async Task<IReadOnlySet<Guid>> ExistingInAppAsync(
        Guid appId, IReadOnlyCollection<Guid> assetIds, CancellationToken cancellationToken) =>
        (await db.Assets.Where(a => a.AppId == appId && assetIds.Contains(a.Id)).Select(a => a.Id)
            .ToListAsync(cancellationToken).ConfigureAwait(false)).ToHashSet();
}
