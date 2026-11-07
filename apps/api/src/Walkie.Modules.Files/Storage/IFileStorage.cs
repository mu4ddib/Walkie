namespace Walkie.Modules.Files.Storage;

/// <summary>Dónde viven los bytes de los archivos (ADR-0004). Hoy S3 (RustFS en desarrollo y CI).</summary>
internal interface IFileStorage
{
    Task PutAsync(string key, Stream content, string contentType, CancellationToken cancellationToken);

    /// <summary>El contenido del objeto; <c>null</c> si no existe.</summary>
    Task<Stream?> GetAsync(string key, CancellationToken cancellationToken);

    /// <summary>Crea el bucket si no existe (al arrancar).</summary>
    Task EnsureReadyAsync(CancellationToken cancellationToken);
}
