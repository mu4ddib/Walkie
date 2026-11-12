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

    /// <summary>Borra los lienzos de esas features (deshacer una importación).</summary>
    Task DeleteAsync(IReadOnlyCollection<Guid> featureIds, CancellationToken cancellationToken);
}
