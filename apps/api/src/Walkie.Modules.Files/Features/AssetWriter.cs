using Microsoft.EntityFrameworkCore;
using Walkie.Modules.Files.Contracts;
using Walkie.Modules.Files.Domain;
using Walkie.Modules.Files.Persistence;
using Walkie.Modules.Files.Storage;
using Walkie.Shared.Time;

namespace Walkie.Modules.Files.Features;

internal sealed class AssetWriter(FilesDbContext db, IFileStorage storage, TimeProvider clock) : IAssetWriter
{
    public long MaxSize => Asset.MaxSize;

    public string? Recognize(ReadOnlySpan<byte> bytes) => ImageInspector.Inspect(bytes)?.ContentType;

    public async Task<Guid?> StoreAsync(Guid appId, byte[] bytes, string userId, CancellationToken cancellationToken)
    {
        if (bytes.Length == 0 || bytes.Length > Asset.MaxSize || ImageInspector.Inspect(bytes) is not { } info)
        {
            return null;
        }

        var id = Guid.CreateVersion7();
        var stored = new Asset
        {
            Id = id,
            AppId = appId,
            ContentType = info.ContentType,
            Size = bytes.Length,
            Width = info.Width,
            Height = info.Height,
            StorageKey = $"apps/{appId}/{id}",
            CreatedBy = userId,
            CreatedAt = clock.GetUtcNowForDb(),
        };
        using (var content = new MemoryStream(bytes, writable: false))
        {
            await storage.PutAsync(stored.StorageKey, content, stored.ContentType, cancellationToken).ConfigureAwait(false);
        }

        db.Assets.Add(stored);
        await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        return id;
    }

    public async Task DeleteAsync(IReadOnlyCollection<Guid> assetIds, CancellationToken cancellationToken)
    {
        if (assetIds.Count == 0)
        {
            return;
        }

        var assets = await db.Assets.Where(a => assetIds.Contains(a.Id)).ToListAsync(cancellationToken).ConfigureAwait(false);
        foreach (var asset in assets)
        {
            await storage.DeleteAsync(asset.StorageKey, cancellationToken).ConfigureAwait(false);
        }

        db.Assets.RemoveRange(assets);
        await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
    }
}
