using System.Text.Json;

namespace Walkie.Modules.Canvas.Contracts;

/// <summary>Lectura pública del lienzo para otros módulos (Sharing muestra el de un enlace).</summary>
public interface ICanvasReader
{
    /// <summary>El último grafo guardado de la feature, o el vacío con versión 0 si nunca se guardó.</summary>
    Task<JsonElement> GraphOfFeatureAsync(Guid featureId, CancellationToken cancellationToken);

    /// <summary>
    /// Posiciones guardadas del mapa de la app (<c>positions</c> de <c>walkie-app-map</c>: id de feature o
    /// <c>catalog:&lt;id&gt;</c> → x, y); <c>null</c> si nunca se acomodó.
    /// </summary>
    Task<JsonElement?> MapPositionsAsync(Guid appId, CancellationToken cancellationToken);
}
