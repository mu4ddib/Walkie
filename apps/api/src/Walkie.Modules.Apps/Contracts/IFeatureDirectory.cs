namespace Walkie.Modules.Apps.Contracts;

/// <summary>Consulta pública del módulo Apps para otros módulos (sin exponer su DbContext).</summary>
public interface IFeatureDirectory
{
    Task<bool> FeatureExistsAsync(Guid featureId, CancellationToken cancellationToken);
}
