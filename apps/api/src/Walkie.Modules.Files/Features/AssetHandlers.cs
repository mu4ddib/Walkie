using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Files.Contracts;
using Walkie.Modules.Files.Domain;
using Walkie.Modules.Files.Persistence;
using Walkie.Modules.Files.Storage;
using Walkie.Shared.Time;

namespace Walkie.Modules.Files.Features;

/// <summary>Subir y leer imágenes de una app, separado del mapeo HTTP.</summary>
internal sealed class AssetHandlers(FilesDbContext db, IFileStorage storage, IAppDirectory apps, TimeProvider clock)
{
    public async Task<UploadResult> UploadAsync(Guid appId, IFormFile? file, string userId, CancellationToken ct)
    {
        if (!await apps.AppExistsAsync(appId, ct).ConfigureAwait(false))
        {
            return new UploadResult.NotFound();
        }

        if (file is null || file.Length == 0)
        {
            return Invalid("Falta la imagen (campo file).");
        }

        if (file.Length > Asset.MaxSize)
        {
            return Invalid("La imagen no puede pesar más de 5 MB.");
        }

        // Se lee entera (≤ 5 MB) para reconocer el tipo por el contenido y subir los mismos bytes.
        using var buffer = new MemoryStream((int)file.Length);
        await file.CopyToAsync(buffer, ct).ConfigureAwait(false);
        var info = ImageInspector.Inspect(buffer.GetBuffer().AsSpan(0, (int)buffer.Length));
        if (info is null)
        {
            return Invalid("Solo se aceptan imágenes PNG, JPEG o WebP.");
        }

        var id = Guid.CreateVersion7();
        var stored = new Asset
        {
            Id = id,
            AppId = appId,
            ContentType = info.ContentType,
            Size = buffer.Length,
            Width = info.Width,
            Height = info.Height,
            StorageKey = $"apps/{appId}/{id}",
            CreatedBy = userId,
            CreatedAt = clock.GetUtcNowForDb(),
        };

        buffer.Position = 0;
        await storage.PutAsync(stored.StorageKey, buffer, stored.ContentType, ct).ConfigureAwait(false);
        db.Assets.Add(stored);
        await db.SaveChangesAsync(ct).ConfigureAwait(false);
        return new UploadResult.Created(ToResponse(stored));
    }

    /// <summary>Datos y contenido; <c>null</c> si no existe.</summary>
    public async Task<(AssetResponse Asset, Stream Content)?> GetAsync(Guid assetId, CancellationToken ct)
    {
        var asset = await db.Assets.AsNoTracking().SingleOrDefaultAsync(a => a.Id == assetId, ct).ConfigureAwait(false);
        if (asset is null)
        {
            return null;
        }

        var content = await storage.GetAsync(asset.StorageKey, ct).ConfigureAwait(false);
        return content is null ? null : (ToResponse(asset), content);
    }

    private static UploadResult.Invalid Invalid(string message) =>
        new(new Dictionary<string, string[]> { ["file"] = [message] });

    private static AssetResponse ToResponse(Asset a) => new(a.Id, a.AppId, a.ContentType, a.Size, a.Width, a.Height);
}

internal abstract record UploadResult
{
    public sealed record Created(AssetResponse Asset) : UploadResult;
    public sealed record NotFound : UploadResult;
    public sealed record Invalid(Dictionary<string, string[]> Errors) : UploadResult;
}
