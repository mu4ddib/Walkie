namespace Walkie.Modules.Files.Domain;

/// <summary>Imagen subida a una app (ADR-0004). Los bytes viven en el almacenamiento S3; aquí, sus datos.</summary>
internal sealed class Asset
{
    /// <summary>5 MB (spec imagenes-portal, decisión 2).</summary>
    public const long MaxSize = 5 * 1024 * 1024;

    public Guid Id { get; init; } = Guid.CreateVersion7();
    public Guid AppId { get; init; }
    public required string ContentType { get; init; }
    public long Size { get; init; }
    public int Width { get; init; }
    public int Height { get; init; }

    /// <summary>Clave del objeto en el bucket (<c>apps/{appId}/{id}</c>).</summary>
    public required string StorageKey { get; init; }

    public required string CreatedBy { get; init; }
    public DateTimeOffset CreatedAt { get; init; }
}
