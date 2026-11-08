namespace Walkie.Modules.Files.Contracts;

/// <summary>Consulta pública de imágenes para otros módulos (Canvas valida <c>assetId</c>; Sharing sirve las de un enlace).</summary>
public interface IAssetDirectory
{
    /// <summary>De <paramref name="assetIds"/>, los que existen y son de la app.</summary>
    Task<IReadOnlySet<Guid>> ExistingInAppAsync(Guid appId, IReadOnlyCollection<Guid> assetIds, CancellationToken cancellationToken);

    /// <summary>Los bytes de la imagen si es de la app (Sharing); <c>null</c> si no existe o es de otra app.</summary>
    Task<AssetContent?> OpenInAppAsync(Guid appId, Guid assetId, CancellationToken cancellationToken);
}

/// <summary>Contenido de una imagen: quien lo recibe cierra el stream.</summary>
public sealed record AssetContent(string ContentType, Stream Content);
