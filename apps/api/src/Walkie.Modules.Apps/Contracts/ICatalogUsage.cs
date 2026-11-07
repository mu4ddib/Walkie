namespace Walkie.Modules.Apps.Contracts;

/// <summary>
/// Qué lienzos usan un elemento del catálogo. Lo define Apps y lo implementa Canvas (que conoce los grafos),
/// así Apps no depende de Canvas.
/// </summary>
public interface ICatalogUsage
{
    /// <summary>Ids de las features cuyo lienzo tiene un nodo <c>ref</c> a <paramref name="itemId"/>.</summary>
    Task<IReadOnlyList<Guid>> FeaturesUsingAsync(Guid itemId, CancellationToken cancellationToken);
}
