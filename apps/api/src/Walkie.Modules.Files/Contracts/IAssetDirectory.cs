namespace Walkie.Modules.Files.Contracts;

/// <summary>Consulta pública de imágenes para otros módulos (Canvas valida <c>assetId</c>).</summary>
public interface IAssetDirectory
{
    /// <summary>De <paramref name="assetIds"/>, los que existen y son de la app.</summary>
    Task<IReadOnlySet<Guid>> ExistingInAppAsync(Guid appId, IReadOnlyCollection<Guid> assetIds, CancellationToken cancellationToken);
}
