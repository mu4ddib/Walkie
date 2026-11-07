namespace Walkie.Modules.Files.Storage;

/// <summary>Sección <c>Storage</c> de la configuración. Las claves llegan por variables de entorno.</summary>
public sealed class StorageOptions
{
    public const string Section = "Storage";

    /// <summary>URL del servicio S3 (ej. <c>http://localhost:9000</c>, RustFS); vacía = S3 de AWS en <see cref="Region"/>.</summary>
    public string? Endpoint { get; set; }

    public string Region { get; set; } = "us-east-1";
    public string Bucket { get; set; } = "walkie-assets";
    public string AccessKey { get; set; } = "";
    public string SecretKey { get; set; } = "";
}
