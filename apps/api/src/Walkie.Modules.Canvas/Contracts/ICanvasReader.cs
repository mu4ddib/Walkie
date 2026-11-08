using System.Text.Json;

namespace Walkie.Modules.Canvas.Contracts;

/// <summary>Lectura pública del lienzo para otros módulos (Sharing muestra el de un enlace).</summary>
public interface ICanvasReader
{
    /// <summary>El último grafo guardado de la feature, o el vacío con versión 0 si nunca se guardó.</summary>
    Task<JsonElement> GraphOfFeatureAsync(Guid featureId, CancellationToken cancellationToken);
}
