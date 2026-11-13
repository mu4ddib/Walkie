using System.IO.Compression;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using Walkie.Modules.Apps.Contracts;

namespace Walkie.Modules.Export.Features;

/// <summary>Una feature del archivo: sus datos y su último lienzo guardado.</summary>
internal sealed record PackageFeature(Guid Id, string Name, string? Description, JsonElement Graph);

/// <summary>Una imagen de pantalla del archivo: su asset de origen, su tipo y sus bytes.</summary>
internal sealed record PackageImage(Guid AssetId, string ContentType, byte[] Bytes);

/// <summary>
/// Archivo <c>.walkie</c> (spec exportar-e-importar, tareas 5 a 7): un <c>.zip</c> con <c>manifest.json</c>
/// (<c>packages/schema/walkie-package.schema.json</c>), el lienzo de cada feature en <c>features/&lt;id&gt;/canvas.json</c>
/// (<c>walkie-graph</c>), los elementos del catálogo que usan en <c>catalog.json</c> (<c>walkie-catalog-item</c>) y las
/// imágenes de sus pantallas en <c>img/</c>. Una lista de features, no una sola: el mismo formato sirve para una app, que
/// además trae todo su catálogo y, si se acomodó, la distribución del mapa en <c>map.json</c> (tarea 7).
/// </summary>
internal static class WalkiePackage
{
    public const string ManifestPath = "manifest.json";
    public const string CatalogPath = "catalog.json";
    public const string MapPath = "map.json";

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    public static string CanvasPath(Guid featureId) => $"features/{featureId}/canvas.json";

    /// <summary>Lienzo de un módulo compartido en el archivo (spec modulos-compartidos).</summary>
    public static string ModuleCanvasPath(Guid moduleId) => $"modules/{moduleId}/canvas.json";

    public static string ImagePath(Guid assetId, string contentType) => contentType switch
    {
        "image/jpeg" => $"img/{assetId}.jpg",
        "image/webp" => $"img/{assetId}.webp",
        _ => $"img/{assetId}.png",
    };

    /// <summary>El manifest, para el <c>.zip</c> y para las pruebas.</summary>
    public static PackageManifest Manifest(
        string scope,
        Guid appId,
        string appName,
        IReadOnlyList<PackageFeature> features,
        IReadOnlyList<CatalogItemResponse> catalog,
        IReadOnlyList<PackageImage> images,
        DateTimeOffset exportedAt,
        bool withMap = false,
        IReadOnlyList<PackageFeature>? modules = null) =>
        new(
            "walkie-package",
            0,
            Walkie.Shared.WalkieInfo.SchemaVersion,
            exportedAt,
            scope,
            new PackageApp(appId, appName),
            [.. features.Select(f => new PackageManifestFeature(
                f.Id,
                f.Name,
                string.IsNullOrWhiteSpace(f.Description) ? null : f.Description,
                CanvasPath(f.Id),
                f.Graph.TryGetProperty("version", out var v) && v.TryGetInt32(out var n) ? n : 0))],
            new PackageCatalog(CatalogPath, catalog.Count),
            [.. images.Select(i => new PackageManifestImage(i.AssetId, ImagePath(i.AssetId, i.ContentType), i.ContentType))],
            withMap ? new PackageMap(MapPath) : null,
            modules is { Count: > 0 }
                ? [.. modules.Select(m => new PackageManifestFeature(
                    m.Id,
                    m.Name,
                    string.IsNullOrWhiteSpace(m.Description) ? null : m.Description,
                    ModuleCanvasPath(m.Id),
                    m.Graph.TryGetProperty("version", out var v) && v.TryGetInt32(out var n) ? n : 0))]
                : null);

    /// <summary>Los bytes del <c>.zip</c>: manifest, lienzos, catálogo, mapa (si hay) e imágenes, en orden estable.</summary>
    public static byte[] Zip(
        PackageManifest manifest,
        IReadOnlyList<PackageFeature> features,
        IReadOnlyList<CatalogItemResponse> catalog,
        IReadOnlyList<PackageImage> images,
        JsonElement? mapPositions = null,
        IReadOnlyList<PackageFeature>? modules = null)
    {
        using var buffer = new MemoryStream();
        using (var zip = new ZipArchive(buffer, ZipArchiveMode.Create, leaveOpen: true))
        {
            Write(zip, ManifestPath, JsonSerializer.SerializeToUtf8Bytes(manifest, Json));
            foreach (var feature in features.OrderBy(f => f.Id))
            {
                Write(zip, CanvasPath(feature.Id), JsonSerializer.SerializeToUtf8Bytes(feature.Graph, Json));
            }

            foreach (var module in (modules ?? []).OrderBy(m => m.Id))
            {
                Write(zip, ModuleCanvasPath(module.Id), JsonSerializer.SerializeToUtf8Bytes(module.Graph, Json));
            }

            Write(zip, CatalogPath, JsonSerializer.SerializeToUtf8Bytes(catalog.OrderBy(i => i.Id), Json));
            if (manifest.Map is not null && mapPositions is { } positions)
            {
                Write(zip, MapPath, JsonSerializer.SerializeToUtf8Bytes(positions, Json));
            }

            foreach (var image in images.OrderBy(i => i.AssetId))
            {
                Write(zip, ImagePath(image.AssetId, image.ContentType), image.Bytes);
            }
        }

        return buffer.ToArray();
    }

    private static void Write(ZipArchive zip, string name, byte[] bytes)
    {
        using var entry = zip.CreateEntry(name, CompressionLevel.Optimal).Open();
        entry.Write(bytes);
    }
}

internal sealed record PackageManifest(
    string Format,
    int FormatVersion,
    int SchemaVersion,
    DateTimeOffset ExportedAt,
    string Scope,
    PackageApp App,
    IReadOnlyList<PackageManifestFeature> Features,
    PackageCatalog Catalog,
    IReadOnlyList<PackageManifestImage> Images,
    PackageMap? Map = null,
    IReadOnlyList<PackageManifestFeature>? Modules = null);

/// <summary>Dónde está la distribución del mapa en el archivo de una app.</summary>
internal sealed record PackageMap(string Path);

internal sealed record PackageApp(Guid Id, string Name);

internal sealed record PackageManifestFeature(Guid Id, string Name, string? Description, string Canvas, int CanvasVersion);

internal sealed record PackageCatalog(string Path, int Count);

internal sealed record PackageManifestImage(Guid AssetId, string Path, string ContentType);
