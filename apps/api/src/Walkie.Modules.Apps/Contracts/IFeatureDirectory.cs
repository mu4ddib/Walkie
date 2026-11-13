namespace Walkie.Modules.Apps.Contracts;

/// <summary>Consulta pública del módulo Apps para otros módulos (sin exponer su DbContext).</summary>
public interface IFeatureDirectory
{
    Task<bool> FeatureExistsAsync(Guid featureId, CancellationToken cancellationToken);

    /// <summary>App de la feature; <c>null</c> si la feature no existe.</summary>
    Task<Guid?> AppOfFeatureAsync(Guid featureId, CancellationToken cancellationToken);

    /// <summary>Ids de las features de la app (para validar los <c>portal</c>), sin los módulos (ADR-0010).</summary>
    Task<IReadOnlySet<Guid>> FeatureIdsOfAppAsync(Guid appId, CancellationToken cancellationToken);

    /// <summary>Nombre de cada feature de la app, por id (Export: destinos de los <c>portal</c>), sin los módulos.</summary>
    Task<IReadOnlyDictionary<Guid, string>> FeatureNamesOfAppAsync(Guid appId, CancellationToken cancellationToken);

    /// <summary>La feature con su app y los nombres de ambas (Sharing); <c>null</c> si no existe.</summary>
    Task<FeatureSummary?> DescribeAsync(Guid featureId, CancellationToken cancellationToken);

    /// <summary>Las features de la app con su descripción, por nombre e id (Export: contexto para IA de la app), sin los módulos.</summary>
    Task<IReadOnlyList<FeatureSummary>> FeaturesOfAppAsync(Guid appId, CancellationToken cancellationToken);

    /// <summary>Los módulos compartidos de la app (ADR-0010), por nombre e id.</summary>
    Task<IReadOnlyList<FeatureSummary>> ModulesOfAppAsync(Guid appId, CancellationToken cancellationToken);
}

/// <summary>La feature con su app; <c>Description</c> es su propósito (lo usa el contexto para IA).</summary>
/// <c>Kind</c>: <c>feature</c> o <c>module</c> (ADR-0010).
public sealed record FeatureSummary(
    Guid Id, Guid AppId, string AppName, string Name, string? Description = null, string Kind = "feature");
