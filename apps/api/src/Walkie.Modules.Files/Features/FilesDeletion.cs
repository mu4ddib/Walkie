using Microsoft.EntityFrameworkCore;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Files.Persistence;
using Walkie.Modules.Files.Storage;

namespace Walkie.Modules.Files.Features;

/// <summary>
/// Imágenes al eliminar una app (ADR-0017): todas las suyas, bytes en S3 y filas. Las de una feature las decide Canvas
/// (solo las que usaba su lienzo y ningún otro) y las borra con <see cref="Contracts.IAssetWriter"/>.
/// </summary>
internal sealed class FilesDeletion(FilesDbContext db, IFileStorage storage) : IDeletionParticipant
{
    public string Step => "files";

    public int Order => 40;

    public Task DescribeFeatureAsync(FeatureDeletionTarget target, DeletionImpact impact, CancellationToken cancellationToken) => Task.CompletedTask;

    public Task DeleteFeatureAsync(FeatureDeletionTarget target, CancellationToken cancellationToken) => Task.CompletedTask;

    public async Task DescribeAppAsync(AppDeletionTarget target, DeletionImpact impact, CancellationToken cancellationToken) =>
        impact.Add("images", await db.Assets.CountAsync(a => a.AppId == target.AppId, cancellationToken).ConfigureAwait(false));

    /// <summary>Primero los bytes, después la fila: si un borrado en S3 falla, la fila queda y el reintento lo repite.</summary>
    public async Task DeleteAppAsync(AppDeletionTarget target, CancellationToken cancellationToken)
    {
        var assets = await db.Assets.Where(a => a.AppId == target.AppId).Select(a => new { a.Id, a.StorageKey })
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        foreach (var asset in assets)
        {
            await storage.DeleteAsync(asset.StorageKey, cancellationToken).ConfigureAwait(false);
            await db.Assets.Where(a => a.Id == asset.Id).ExecuteDeleteAsync(cancellationToken).ConfigureAwait(false);
        }
    }
}
