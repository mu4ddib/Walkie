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

    /// <summary>
    /// Errores de <paramref name="item"/> según las reglas oficiales del catálogo (las mismas que
    /// <c>POST /api/apps/{appId}/catalog</c>), por campo; vacío si es válido. Para validar antes de escribir (Discovery).
    /// </summary>
    IReadOnlyDictionary<string, string[]> ValidateCatalogItem(CreateCatalogItemRequest item);

    /// <summary>
    /// Cómo quedaría <paramref name="item"/> en el catálogo con ese id (versión 1), con la misma limpieza que al crearlo,
    /// sin escribir nada: la vista previa de Discovery muestra exactamente lo que se creará.
    /// </summary>
    CatalogItemResponse PreviewCatalogItem(Guid appId, Guid itemId, CreateCatalogItemRequest item);

    /// <summary>
    /// Crea un elemento del catálogo con el id que generó el cliente (Discovery, spec walkie-live tarea 6), con las mismas
    /// reglas y la misma limpieza que el endpoint: <paramref name="item"/> ya pasó <see cref="ValidateCatalogItem"/>.
    /// Idempotente por id: si ya existe en esa app y con ese tipo (un reintento del mismo plan), no escribe nada.
    /// </summary>
    Task<CatalogItemCreation> CreateCatalogItemAsync(
        Guid appId, Guid itemId, CreateCatalogItemRequest item, string userId, CancellationToken cancellationToken);

    /// <summary>
    /// Borra un elemento creado por una operación que se deshace, solo si nadie lo tocó: sigue en su versión 1 y ningún
    /// lienzo lo usa. Si no, lo deja y dice por qué (compensar nunca pierde un cambio de una persona).
    /// </summary>
    Task<CatalogItemRemoval> DeleteUntouchedCatalogItemAsync(Guid appId, Guid itemId, CancellationToken cancellationToken);

    /// <summary>
    /// Crea una feature o un módulo (<paramref name="kind"/>: <c>feature</c> o <c>module</c>) con el id que generó el
    /// cliente (Discovery, spec walkie-live tarea 9). Idempotente por id: si ya existe en esa app y con ese tipo (un
    /// reintento del mismo plan), no escribe nada. Nombre y descripción ya dentro de sus límites.
    /// </summary>
    Task<FeatureCreation> CreateFeatureAsync(
        Guid appId, Guid featureId, string kind, string name, string? description, string userId, CancellationToken cancellationToken);

    /// <summary>
    /// Borra una feature o un módulo creado por una operación que se deshace, solo si nadie le cambió el nombre ni la
    /// descripción (<paramref name="name"/> y <paramref name="description"/> son los que se crearon). Su lienzo lo
    /// borra antes <c>ICanvasWriter</c>, con sus propias reglas: este método no lo mira.
    /// </summary>
    Task<FeatureRemoval> DeleteUntouchedFeatureAsync(Guid appId, Guid featureId, string name, string? description, CancellationToken cancellationToken);

    /// <summary>Borra features (deshacer una importación).</summary>
    Task DeleteFeaturesAsync(IReadOnlyCollection<Guid> featureIds, CancellationToken cancellationToken);

    /// <summary>Borra elementos del catálogo (deshacer una importación).</summary>
    Task DeleteCatalogItemsAsync(IReadOnlyCollection<Guid> itemIds, CancellationToken cancellationToken);
}
