using System.Text.Json;

namespace Walkie.Modules.Canvas.Contracts;

/// <summary>
/// Módulos compartidos para otros módulos de la API (spec modulos-compartidos, ADR-0010): Sharing los muestra en un
/// enlace de solo lectura y Export los describe en el contexto para IA, el Markdown y el PDF.
/// </summary>
public interface IModuleDirectory
{
    /// <summary>
    /// Los módulos de la app que alcanza <paramref name="graph"/> (sus cajas y, a cualquier profundidad, las de esos
    /// módulos), cada uno con su resumen y su último lienzo; los que ya no existen (referencias pendientes) no están.
    /// </summary>
    Task<IReadOnlyList<ModuleGraph>> ReachableAsync(Guid appId, JsonElement graph, CancellationToken cancellationToken);
}

/// <summary>Un módulo con su resumen y su último lienzo guardado.</summary>
public sealed record ModuleGraph(ModuleSummary Summary, JsonElement Graph);
