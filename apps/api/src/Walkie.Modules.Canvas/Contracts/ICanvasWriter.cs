using System.Text.Json;

namespace Walkie.Modules.Canvas.Contracts;

/// <summary>
/// Escritura de lienzos para otros módulos (Export: importar un archivo <c>.walkie</c>, spec exportar-e-importar,
/// ADR-0009), con la misma validación que <c>PUT /api/features/{id}/canvas</c>.
/// </summary>
public interface ICanvasWriter
{
    /// <summary>Errores del grafo contra el schema y su integridad (sin mirar la base); vacío si es válido.</summary>
    IReadOnlyDictionary<string, string[]> Validate(JsonElement graph);

    /// <summary>
    /// Guarda el primer lienzo de una feature nueva (con <c>version</c> 0 en el grafo); devuelve los errores (schema,
    /// integridad o referencias de otra app) o un diccionario vacío si se guardó.
    /// </summary>
    Task<IReadOnlyDictionary<string, string[]>> CreateAsync(Guid featureId, JsonElement graph, string userId, CancellationToken cancellationToken);

    /// <summary>
    /// Errores de unas posiciones del mapa (<c>positions</c> de <c>walkie-app-map</c>) con <paramref name="prefix"/>
    /// delante; vacío si son válidas.
    /// </summary>
    IReadOnlyDictionary<string, string[]> ValidateMapPositions(JsonElement positions, string prefix);

    /// <summary>Guarda la primera distribución del mapa de una app nueva (versión 1).</summary>
    Task CreateMapAsync(Guid appId, JsonElement positions, string userId, CancellationToken cancellationToken);

    /// <summary>Borra la distribución del mapa de la app (deshacer una importación de app).</summary>
    Task DeleteMapAsync(Guid appId, CancellationToken cancellationToken);

    /// <summary>
    /// Guarda el primer lienzo de una feature o un módulo creado por Discovery (spec walkie-live tarea 9) por el mismo
    /// camino que el <c>PUT</c>, sin pisar nunca uno existente: si la feature ya tiene lienzo (un reintento, o una
    /// persona que ya lo abrió y guardó), no escribe nada y responde <see cref="InitialCanvas.AlreadyExists"/>.
    /// </summary>
    Task<(InitialCanvas Outcome, IReadOnlyDictionary<string, string[]> Errors)> CreateInitialAsync(
        Guid featureId, JsonElement graph, string userId, CancellationToken cancellationToken);

    /// <summary>
    /// Borra el lienzo de una feature o un módulo creado por una operación que se deshace, solo si nadie lo tocó: sigue
    /// en su versión 1 y ningún otro lienzo apunta a esa feature (portal) ni a ese módulo (caja <c>module</c>). Con
    /// <paramref name="checkOnly"/> solo dice si se podría (<see cref="CanvasRemoval.Deleted"/>) sin borrar nada.
    /// </summary>
    Task<CanvasRemoval> DeleteUntouchedAsync(Guid featureId, CancellationToken cancellationToken, bool checkOnly = false);

    /// <summary>Borra los lienzos de esas features (deshacer una importación).</summary>
    Task DeleteAsync(IReadOnlyCollection<Guid> featureIds, CancellationToken cancellationToken);
}

/// <summary>Resultado de <see cref="ICanvasWriter.CreateInitialAsync"/>.</summary>
public enum InitialCanvas
{
    /// <summary>Se guardó ahora (versión 1).</summary>
    Created,

    /// <summary>Ya tenía un lienzo: no se escribió nada (nunca se pisa).</summary>
    AlreadyExists,

    /// <summary>El grafo no es válido o la feature no existe: no se escribió nada; los errores dicen por qué.</summary>
    Invalid,
}

/// <summary>Resultado de <see cref="ICanvasWriter.DeleteUntouchedAsync"/>.</summary>
public enum CanvasRemoval
{
    /// <summary>Se borró (o no había lienzo).</summary>
    Deleted,

    /// <summary>Se dejó: alguien lo guardó después de crearlo (versión mayor que 1).</summary>
    Edited,

    /// <summary>Se dejó: otro lienzo apunta a esta feature o a este módulo.</summary>
    InUse,
}
