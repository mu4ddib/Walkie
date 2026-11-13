using System.IO.Compression;
using System.Text;
using System.Text.Json;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Canvas.Contracts;
using Walkie.Modules.Files.Contracts;

namespace Walkie.Modules.Export.Features;

/// <summary>El <c>.zip</c> de una feature: su <c>.md</c> y las imágenes de sus pantallas (spec export-markdown, criterios 2 y 9).</summary>
internal sealed class ExportHandlers(
    IAppDirectory apps,
    IFeatureDirectory features,
    ICatalogDirectory catalog,
    ICanvasReader canvas,
    IAssetDirectory assets,
    IModuleDirectory modules,
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
        var used = await modules.ReachableAsync(feature.AppId, graph, ct).ConfigureAwait(false);
        var items = await CatalogOfAsync(feature.AppId, used.Select(m => m.Graph).Prepend(graph), ct).ConfigureAwait(false);
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
            items,
            featureNames,
            images.ToDictionary(i => i.Key, i => i.Value.Path),
            clock.GetUtcNow(),
            used));

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
        var used = await modules.ReachableAsync(feature.AppId, graph, ct).ConfigureAwait(false);
        var items = await CatalogOfAsync(feature.AppId, used.Select(m => m.Graph).Prepend(graph), ct).ConfigureAwait(false);
        var featureNames = NodeIds(graph, "portal", "targetFeatureId").Count == 0
            ? new Dictionary<Guid, string>()
            : await features.FeatureNamesOfAppAsync(feature.AppId, ct).ConfigureAwait(false);

        var context = MarkdownDocument.BuildAiContext(new AiContextInput(
            feature.Id,
            feature.AppName,
            feature.Name,
            feature.Description,
            graph,
            items,
            featureNames,
            clock.GetUtcNow(),
            used));
        return (Slugs.From(feature.Name), context);
    }

    /// <summary>
    /// Contexto para IA de toda la app (spec exportar-e-importar, tarea 2): cada feature con su último lienzo guardado y
    /// todo el catálogo; <c>null</c> si la app no existe.
    /// </summary>
    public async Task<(string Slug, AppAiContext Context)?> AppAiContextAsync(Guid appId, CancellationToken ct)
    {
        if (await apps.AppNameAsync(appId, ct).ConfigureAwait(false) is not { } appName)
        {
            return null;
        }

        var list = await features.FeaturesOfAppAsync(appId, ct).ConfigureAwait(false);
        var graphs = new List<(FeatureSummary, System.Text.Json.JsonElement)>();
        var used = new Dictionary<Guid, IReadOnlyList<ModuleGraph>>();
        foreach (var feature in list)
        {
            var graph = await canvas.GraphOfFeatureAsync(feature.Id, ct).ConfigureAwait(false);
            graphs.Add((feature, graph));
            used[feature.Id] = await modules.ReachableAsync(appId, graph, ct).ConfigureAwait(false);
        }

        var items = await catalog.AllItemsOfAppAsync(appId, ct).ConfigureAwait(false);
        var context = MarkdownDocument.BuildAppAiContext(new AppAiContextInput(appId, appName, graphs, items, clock.GetUtcNow(), used));
        return (Slugs.From(appName, "app"), context);
    }

    /// <summary>
    /// PDF de la última versión guardada (spec exportar-e-importar, tarea 4; ADR-0008), con la imagen del lienzo que manda
    /// el navegador (si la hay) y las imágenes de las pantallas; <c>null</c> si la feature no existe.
    /// </summary>
    public async Task<(string FileName, byte[] Content)?> PdfAsync(Guid featureId, PdfImage? canvasImage, CancellationToken ct)
    {
        if (await AiContextAsync(featureId, ct).ConfigureAwait(false) is not { } ai
            || await features.AppOfFeatureAsync(featureId, ct).ConfigureAwait(false) is not { } appId)
        {
            return null;
        }

        // La imagen de cada pantalla, por id de nodo (dos pantallas con la misma imagen la piden una vez).
        var graph = await canvas.GraphOfFeatureAsync(featureId, ct).ConfigureAwait(false);
        var images = await ImagesAsync(appId, [graph], ct).ConfigureAwait(false);
        var screens = new Dictionary<string, PdfImage>(StringComparer.Ordinal);
        foreach (var node in graph.GetProperty("nodes").EnumerateObject().Select(n => n.Value))
        {
            if (node.GetProperty("type").GetString() == "screen"
                && node.TryGetProperty("assetId", out var value) && Guid.TryParse(value.GetString(), out var assetId)
                && images.TryGetValue(assetId, out var image))
            {
                screens[node.GetProperty("id").GetString()!] = image;
            }
        }

        return ($"{ai.Slug}.pdf", MarkdownDocument.RenderPdf(ai.Context, canvasImage, screens));
    }

    /// <summary>
    /// Archivo <c>.walkie</c> de una feature (spec exportar-e-importar, tarea 5): su último lienzo guardado, los elementos
    /// del catálogo que usa y las imágenes de sus pantallas; <c>null</c> si la feature no existe.
    /// </summary>
    public async Task<(string FileName, byte[] Content)?> WalkieAsync(Guid featureId, CancellationToken ct)
    {
        if (await features.DescribeAsync(featureId, ct).ConfigureAwait(false) is not { } feature)
        {
            return null;
        }

        var graph = await canvas.GraphOfFeatureAsync(featureId, ct).ConfigureAwait(false);
        var modules = await ModulesUsedAsync(feature.AppId, graph, ct).ConfigureAwait(false);
        var graphs = modules.Select(m => m.Graph).Prepend(graph).ToList();
        var refs = graphs.SelectMany(g => NodeIds(g, "ref", "catalogId").Keys).Distinct().ToList();
        var items = refs.Count == 0 ? [] : await catalog.ItemsOfAppAsync(feature.AppId, refs, ct).ConfigureAwait(false);
        var images = await ImagesAsync(feature.AppId, graphs, ct).ConfigureAwait(false);
        var package = new List<PackageFeature> { new(feature.Id, feature.Name, feature.Description, graph) };
        var list = images.Select(i => new PackageImage(i.Key, i.Value.ContentType, i.Value.Bytes)).ToList();

        var manifest = WalkiePackage.Manifest("feature", feature.AppId, feature.AppName, package, items, list, clock.GetUtcNow(), modules: modules);
        return ($"{Slugs.From(feature.Name)}.walkie", WalkiePackage.Zip(manifest, package, items, list, modules: modules));
    }

    /// <summary>
    /// Los módulos compartidos que usa el lienzo y los que esos contienen (spec modulos-compartidos), con su último
    /// lienzo; los que ya no existen (referencias pendientes) quedan fuera.
    /// </summary>
    private async Task<List<PackageFeature>> ModulesUsedAsync(Guid appId, JsonElement graph, CancellationToken ct)
    {
        var appModules = (await features.ModulesOfAppAsync(appId, ct).ConfigureAwait(false)).ToDictionary(m => m.Id);
        var found = new Dictionary<Guid, PackageFeature>();
        var pending = new Queue<Guid>(NodeIds(graph, "module", "moduleId").Keys);
        while (pending.TryDequeue(out var id))
        {
            if (found.ContainsKey(id) || !appModules.TryGetValue(id, out var module))
            {
                continue;
            }

            var inner = await canvas.GraphOfFeatureAsync(id, ct).ConfigureAwait(false);
            found[id] = new PackageFeature(id, module.Name, module.Description, inner);
            foreach (var next in NodeIds(inner, "module", "moduleId").Keys)
            {
                pending.Enqueue(next);
            }
        }

        return [.. found.Values.OrderBy(m => m.Id)];
    }

    /// <summary>
    /// Archivo <c>.walkie</c> de la app completa (spec exportar-e-importar, tarea 7): todas sus features con su último
    /// lienzo, todo el catálogo (también lo que ningún lienzo usa), las imágenes de las pantallas y la distribución del
    /// mapa si se acomodó; <c>null</c> si la app no existe.
    /// </summary>
    public async Task<(string FileName, byte[] Content)?> AppWalkieAsync(Guid appId, CancellationToken ct)
    {
        if (await apps.AppNameAsync(appId, ct).ConfigureAwait(false) is not { } appName)
        {
            return null;
        }

        var package = new List<PackageFeature>();
        foreach (var feature in await features.FeaturesOfAppAsync(appId, ct).ConfigureAwait(false))
        {
            var graph = await canvas.GraphOfFeatureAsync(feature.Id, ct).ConfigureAwait(false);
            package.Add(new PackageFeature(feature.Id, feature.Name, feature.Description, graph));
        }

        // Todos los módulos compartidos de la app (spec modulos-compartidos), también los que nadie usa.
        var modules = new List<PackageFeature>();
        foreach (var module in await features.ModulesOfAppAsync(appId, ct).ConfigureAwait(false))
        {
            var graph = await canvas.GraphOfFeatureAsync(module.Id, ct).ConfigureAwait(false);
            modules.Add(new PackageFeature(module.Id, module.Name, module.Description, graph));
        }

        var items = await catalog.AllItemsOfAppAsync(appId, ct).ConfigureAwait(false);
        var images = await ImagesAsync(appId, package.Concat(modules).Select(f => f.Graph), ct).ConfigureAwait(false);
        var list = images.Select(i => new PackageImage(i.Key, i.Value.ContentType, i.Value.Bytes)).ToList();
        var map = await canvas.MapPositionsAsync(appId, ct).ConfigureAwait(false);

        var manifest = WalkiePackage.Manifest(
            "app", appId, appName, package, items, list, clock.GetUtcNow(), withMap: map is not null, modules: modules);
        return ($"{Slugs.From(appName, "app")}.walkie", WalkiePackage.Zip(manifest, package, items, list, map, modules));
    }

    /// <summary>Los elementos del catálogo que usan los <c>ref</c> de los lienzos (la feature y sus módulos), por id.</summary>
    private async Task<Dictionary<Guid, CatalogItemResponse>> CatalogOfAsync(Guid appId, IEnumerable<JsonElement> graphs, CancellationToken ct)
    {
        var refs = graphs.SelectMany(g => NodeIds(g, "ref", "catalogId").Keys).Distinct().ToList();
        return refs.Count == 0
            ? []
            : (await catalog.ItemsOfAppAsync(appId, refs, ct).ConfigureAwait(false)).ToDictionary(i => i.Id);
    }

    /// <summary>Las imágenes de las pantallas de los lienzos, por asset (una vez cada una); las que ya no están, fuera.</summary>
    private async Task<Dictionary<Guid, PdfImage>> ImagesAsync(Guid appId, IEnumerable<JsonElement> graphs, CancellationToken ct)
    {
        var images = new Dictionary<Guid, PdfImage>();
        foreach (var assetId in graphs.SelectMany(g => NodeIds(g, "screen", "assetId").Keys).Distinct().Order())
        {
            if (await assets.OpenInAppAsync(appId, assetId, ct).ConfigureAwait(false) is not { } stored)
            {
                continue;
            }

            await using (stored.Content.ConfigureAwait(false))
            {
                using var bytes = new MemoryStream();
                await stored.Content.CopyToAsync(bytes, ct).ConfigureAwait(false);
                images[assetId] = new PdfImage(bytes.ToArray(), stored.ContentType);
            }
        }

        return images;
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
