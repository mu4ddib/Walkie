namespace Walkie.Modules.Apps.Contracts;

/// <summary>Consulta pública del catálogo para otros módulos (Canvas valida los <c>ref</c> con ella).</summary>
public interface ICatalogDirectory
{
    /// <summary>Ids de los elementos del catálogo de la app a la que pertenece la feature.</summary>
    Task<IReadOnlySet<Guid>> CatalogItemIdsForFeatureAsync(Guid featureId, CancellationToken cancellationToken);

    /// <summary>De <paramref name="itemIds"/>, los elementos que existen en el catálogo de la app (Sharing).</summary>
    Task<IReadOnlyList<CatalogItemResponse>> ItemsOfAppAsync(
        Guid appId, IReadOnlyCollection<Guid> itemIds, CancellationToken cancellationToken);

    /// <summary>Todo el catálogo de la app, por id (Export: contexto para IA de la app).</summary>
    Task<IReadOnlyList<CatalogItemResponse>> AllItemsOfAppAsync(Guid appId, CancellationToken cancellationToken);
}
