namespace Walkie.Modules.Apps.Contracts;

/// <summary>Consulta pública de apps para otros módulos (Files sube imágenes a una app).</summary>
public interface IAppDirectory
{
    Task<bool> AppExistsAsync(Guid appId, CancellationToken cancellationToken);
}
