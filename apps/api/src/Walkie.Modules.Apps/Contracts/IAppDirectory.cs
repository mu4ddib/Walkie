namespace Walkie.Modules.Apps.Contracts;

/// <summary>Consulta pública de apps para otros módulos (Files sube imágenes a una app).</summary>
public interface IAppDirectory
{
    Task<bool> AppExistsAsync(Guid appId, CancellationToken cancellationToken);

    /// <summary>Nombre de la app; <c>null</c> si no existe (Export: contexto para IA de la app).</summary>
    Task<string?> AppNameAsync(Guid appId, CancellationToken cancellationToken);
}
