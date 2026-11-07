namespace Walkie.Modules.Apps.Contracts;

/// <summary>Consulta pública del módulo Apps para otros módulos (sin exponer su DbContext).</summary>
public interface IFeatureDirectory
{
    Task<bool> FeatureExistsAsync(Guid featureId, CancellationToken cancellationToken);

    /// <summary>App de la feature; <c>null</c> si la feature no existe.</summary>
    Task<Guid?> AppOfFeatureAsync(Guid featureId, CancellationToken cancellationToken);

    /// <summary>Ids de las features de la app (para validar los <c>portal</c>).</summary>
    Task<IReadOnlySet<Guid>> FeatureIdsOfAppAsync(Guid appId, CancellationToken cancellationToken);
}
