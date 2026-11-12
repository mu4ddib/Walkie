namespace Walkie.Modules.Files.Contracts;

/// <summary>
/// Escritura de imágenes para otros módulos (Export: importar un archivo <c>.walkie</c>, spec exportar-e-importar,
/// ADR-0009). Mismas reglas que una subida: tipo reconocido por el contenido y hasta 5 MB.
/// </summary>
public interface IAssetWriter
{
    /// <summary>Tipo MIME de la imagen (PNG, JPEG o WebP) reconocido por su contenido; <c>null</c> si no es una.</summary>
    string? Recognize(ReadOnlySpan<byte> bytes);

    /// <summary>Tamaño máximo de una imagen (bytes).</summary>
    long MaxSize { get; }

    /// <summary>Guarda la imagen en la app y devuelve su id; <c>null</c> si no es una imagen válida.</summary>
    Task<Guid?> StoreAsync(Guid appId, byte[] bytes, string userId, CancellationToken cancellationToken);

    /// <summary>Borra imágenes (datos y bytes): deshacer una importación que falló.</summary>
    Task DeleteAsync(IReadOnlyCollection<Guid> assetIds, CancellationToken cancellationToken);
}
