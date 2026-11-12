using System.IO.Compression;
using System.Text;
using System.Text.Json;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Canvas.Contracts;
using Walkie.Modules.Files.Contracts;

namespace Walkie.Modules.Export.Features;

/// <summary>El <c>.zip</c> de una feature: su <c>.md</c> y las imágenes de sus pantallas (spec export-markdown, criterios 2 y 9).</summary>
internal sealed class ExportHandlers(
    IFeatureDirectory features,
    ICatalogDirectory catalog,
    ICanvasReader canvas,
    IAssetDirectory assets,
    TimeProvider clock)
{
    /// <summary>Nombre del archivo y bytes del zip, con la última versión guardada; <c>null</c> si la feature no existe.</summary>
    public async Task<(string FileName, byte[] Content)?> ExportAsync(Guid featureId, CancellationToken ct)
    {
        if (await features.DescribeAsync(featureId, ct).ConfigureAwait(false) is not { } feature)
        {
            return null;
        }

        var graph = await canvas.GraphOfFeatureAsync(featureId, ct).ConfigureAwait(false);
        var refs = NodeIds(graph, "ref", "catalogId").Keys.ToList();
        var items = refs.Count == 0 ? [] : await catalog.ItemsOfAppAsync(feature.AppId, refs, ct).ConfigureAwait(false);
        var featureNames = NodeIds(graph, "portal", "targetFeatureId").Count == 0
            ? new Dictionary<Guid, string>()
            : await features.FeatureNamesOfAppAsync(feature.AppId, ct).ConfigureAwait(false);

        // Una imagen por asset (dos pantallas con la misma imagen comparten archivo); la ruta usa el título de la primera.
        var images = new Dictionary<Guid, (string Path, byte[] Bytes)>();
        foreach (var (assetId, screenTitle) in NodeIds(graph, "screen", "assetId").OrderBy(a => a.Key))
        {
            if (await assets.OpenInAppAsync(feature.AppId, assetId, ct).ConfigureAwait(false) is not { } image)
            {
                continue;
            }

            await using (image.Content.ConfigureAwait(false))
            {
                using var bytes = new MemoryStream();
                await image.Content.CopyToAsync(bytes, ct).ConfigureAwait(false);
                images[assetId] = (Slugs.ImagePath(screenTitle, assetId, image.ContentType), bytes.ToArray());
            }
        }

        var markdown = MarkdownDocument.Render(new ExportInput(
            feature.AppName,
            feature.Name,
            graph,
            items.ToDictionary(i => i.Id),
            featureNames,
            images.ToDictionary(i => i.Key, i => i.Value.Path),
            clock.GetUtcNow()));

        var slug = Slugs.From(feature.Name);
        return ($"{slug}.zip", Zip($"{slug}.md", markdown, images.Values));
    }

    /// <summary>
    /// Contexto para IA de la última versión guardada (spec exportar-e-importar, tarea 1) y el slug para los nombres de
    /// archivo; <c>null</c> si la feature no existe. Sin imágenes: es texto para un modelo de lenguaje.
    /// </summary>
    public async Task<(string Slug, AiContext Context)?> AiContextAsync(Guid featureId, CancellationToken ct)
    {
        if (await features.DescribeAsync(featureId, ct).ConfigureAwait(false) is not { } feature)
        {
            return null;
        }

        var graph = await canvas.GraphOfFeatureAsync(featureId, ct).ConfigureAwait(false);
        var refs = NodeIds(graph, "ref", "catalogId").Keys.ToList();
        var items = refs.Count == 0 ? [] : await catalog.ItemsOfAppAsync(feature.AppId, refs, ct).ConfigureAwait(false);
        var featureNames = NodeIds(graph, "portal", "targetFeatureId").Count == 0
            ? new Dictionary<Guid, string>()
            : await features.FeatureNamesOfAppAsync(feature.AppId, ct).ConfigureAwait(false);

        var context = MarkdownDocument.BuildAiContext(new AiContextInput(
            feature.Id,
            feature.AppName,
            feature.Name,
            feature.Description,
            graph,
            items.ToDictionary(i => i.Id),
            featureNames,
            clock.GetUtcNow()));
        return (Slugs.From(feature.Name), context);
    }

    private static byte[] Zip(string markdownName, string markdown, IEnumerable<(string Path, byte[] Bytes)> images)
    {
        using var buffer = new MemoryStream();
        using (var zip = new ZipArchive(buffer, ZipArchiveMode.Create, leaveOpen: true))
        {
            Write(zip, markdownName, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false).GetBytes(markdown));
            foreach (var (path, bytes) in images.OrderBy(i => i.Path, StringComparer.Ordinal))
            {
                Write(zip, path, bytes);
            }
        }

        return buffer.ToArray();
    }

    private static void Write(ZipArchive zip, string name, byte[] bytes)
    {
        using var entry = zip.CreateEntry(name, CompressionLevel.Optimal).Open();
        entry.Write(bytes);
    }

    /// <summary>De los nodos de tipo <paramref name="type"/>, el id en <paramref name="property"/> y el título del nodo.</summary>
    private static Dictionary<Guid, string> NodeIds(JsonElement graph, string type, string property)
    {
        var ids = new Dictionary<Guid, string>();
        foreach (var node in graph.GetProperty("nodes").EnumerateObject().Select(n => n.Value)
                     .OrderBy(n => n.GetProperty("id").GetString(), StringComparer.Ordinal))
        {
            if (node.GetProperty("type").GetString() == type
                && node.TryGetProperty(property, out var value)
                && Guid.TryParse(value.GetString(), out var id))
            {
                ids.TryAdd(id, node.GetProperty("title").GetString()!);
            }
        }

        return ids;
    }
}
