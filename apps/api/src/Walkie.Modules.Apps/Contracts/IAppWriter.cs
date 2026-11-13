namespace Walkie.Modules.Apps.Contracts;

/// <summary>
/// Escritura de features y catálogo para otros módulos (Export: importar un archivo <c>.walkie</c>, spec
/// exportar-e-importar, ADR-0009). Crea con las mismas reglas que los endpoints y deja borrar lo creado si la
/// importación falla a mitad de camino.
/// </summary>
public interface IAppWriter
{
    /// <summary>Crea una app vacía (nombre ya dentro de su límite) y devuelve su id: importar una app (tarea 7).</summary>
    Task<Guid> CreateAppAsync(string name, string userId, CancellationToken cancellationToken);

    /// <summary>Nombres de todas las apps, para no repetir uno al importar.</summary>
    Task<IReadOnlyList<string>> AppNamesAsync(CancellationToken cancellationToken);

    /// <summary>Borra la app con sus features y su catálogo (deshacer una importación de app).</summary>
    Task DeleteAppAsync(Guid appId, CancellationToken cancellationToken);

    /// <summary>Crea la feature (nombre y descripción ya dentro de sus límites) y devuelve su id.</summary>
    Task<Guid> CreateFeatureAsync(Guid appId, string name, string? description, string userId, CancellationToken cancellationToken);

    /// <summary>
    /// Crea un módulo compartido vacío (ADR-0010) con el id que generó el cliente (así reintentar no duplica);
    /// <c>false</c> si ese id ya existe.
    /// </summary>
    Task<bool> CreateModuleAsync(Guid appId, Guid moduleId, string name, string? description, string userId, CancellationToken cancellationToken);

    /// <summary>Crea un elemento del catálogo con la definición de <paramref name="source"/> y devuelve su id (nuevo).</summary>
    Task<Guid> CreateCatalogItemAsync(Guid appId, CatalogItemResponse source, string userId, CancellationToken cancellationToken);

    /// <summary>Borra features (deshacer una importación).</summary>
    Task DeleteFeaturesAsync(IReadOnlyCollection<Guid> featureIds, CancellationToken cancellationToken);

    /// <summary>Borra elementos del catálogo (deshacer una importación).</summary>
    Task DeleteCatalogItemsAsync(IReadOnlyCollection<Guid> itemIds, CancellationToken cancellationToken);
}
