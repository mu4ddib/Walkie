namespace Walkie.Modules.Apps.Contracts;

/// <summary>
/// Escritura de features y catálogo para otros módulos (Export: importar un archivo <c>.walkie</c>, spec
/// exportar-e-importar, ADR-0009). Crea con las mismas reglas que los endpoints y deja borrar lo creado si la
/// importación falla a mitad de camino.
/// </summary>
public interface IAppWriter
{
    /// <summary>Crea la feature (nombre y descripción ya dentro de sus límites) y devuelve su id.</summary>
    Task<Guid> CreateFeatureAsync(Guid appId, string name, string? description, string userId, CancellationToken cancellationToken);

    /// <summary>Crea un elemento del catálogo con la definición de <paramref name="source"/> y devuelve su id (nuevo).</summary>
    Task<Guid> CreateCatalogItemAsync(Guid appId, CatalogItemResponse source, string userId, CancellationToken cancellationToken);

    /// <summary>Borra features (deshacer una importación).</summary>
    Task DeleteFeaturesAsync(IReadOnlyCollection<Guid> featureIds, CancellationToken cancellationToken);

    /// <summary>Borra elementos del catálogo (deshacer una importación).</summary>
    Task DeleteCatalogItemsAsync(IReadOnlyCollection<Guid> itemIds, CancellationToken cancellationToken);
}
