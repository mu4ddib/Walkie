namespace Walkie.Modules.Apps.Contracts;

/// <summary>Consulta pública del catálogo para otros módulos (Canvas valida los <c>ref</c> con ella).</summary>
public interface ICatalogDirectory
{
    /// <summary>Ids de los elementos del catálogo de la app a la que pertenece la feature.</summary>
    Task<IReadOnlySet<Guid>> CatalogItemIdsForFeatureAsync(Guid featureId, CancellationToken cancellationToken);
}
