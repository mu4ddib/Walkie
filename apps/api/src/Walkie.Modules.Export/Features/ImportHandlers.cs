using System.IO.Compression;
using System.Text.Json;
using System.Text.Json.Nodes;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Canvas.Contracts;
using Walkie.Modules.Files.Contracts;
using Walkie.Shared;
using Walkie.Shared.Schemas;

namespace Walkie.Modules.Export.Features;

/// <summary>Resumen de una importación (o de lo que haría, con <c>dryRun</c>).</summary>
internal sealed record ImportSummary(
    bool DryRun,
    IReadOnlyList<ImportedFeature> Features,
    int NewCatalogItems,
    int ExistingCatalogItems,
    int Images,
    IReadOnlyList<string> Warnings,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)]
    ImportedApp? App = null,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)]
    IReadOnlyList<ImportedModule>? Modules = null);

/// <summary>Un módulo compartido del archivo (spec modulos-compartidos): se crea o, si ya está en la app, se reutiliza.</summary>
internal sealed record ImportedModule(
    string SourceName,
    string Name,
    bool Reused,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)]
    Guid? Id);

/// <summary>La app nueva de una importación de app (tarea 7): su nombre de origen, el final y su id (si ya se creó).</summary>
internal sealed record ImportedApp(
    string SourceName,
    string Name,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)]
    Guid? Id);

/// <summary>Una feature del archivo: su nombre de origen, el que queda en la app y su id (si ya se importó).</summary>
internal sealed record ImportedFeature(
    string SourceName,
    string Name,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)]
    Guid? Id);

internal abstract record ImportResult
{
    public sealed record Done(ImportSummary Summary) : ImportResult;

    public sealed record Invalid(Dictionary<string, string[]> Errors) : ImportResult;

    public sealed record AppNotFound : ImportResult;
}

/// <summary>
/// Importar un archivo <c>.walkie</c> en una app (spec exportar-e-importar, tarea 6; ADR-0009). Primero lee y valida
/// todo sin escribir (zip, manifest, lienzos, catálogo, imágenes y referencias); con <c>dryRun</c> devuelve solo el
/// resumen. Después crea catálogo, imágenes, features y lienzos con ids nuevos y, si algo falla, borra lo creado: todo o
/// nada.
/// </summary>
internal sealed class ImportHandlers(
    IAppDirectory apps,
    IFeatureDirectory features,
    ICatalogDirectory catalog,
    IAppWriter appWriter,
    IAssetWriter assetWriter,
    ICanvasWriter canvasWriter)
{
    public const long MaxFileBytes = 50L * 1024 * 1024;
    public const int MaxEntries = 2000;
    public const long MaxUncompressedBytes = 200L * 1024 * 1024;

    private const int FeatureNameMaxLength = 120;
    private const int FeatureDescriptionMaxLength = 500;

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<ImportResult> ImportAsync(Guid appId, byte[] file, bool dryRun, string userId, CancellationToken ct)
    {
        if (!await apps.AppExistsAsync(appId, ct).ConfigureAwait(false))
        {
            return new ImportResult.AppNotFound();
        }

        var errors = new Dictionary<string, string[]>();
        var package = Read(file, errors);
        if (package is null)
        {
            return new ImportResult.Invalid(errors);
        }

        var existingItems = (await catalog.AllItemsOfAppAsync(appId, ct).ConfigureAwait(false)).Select(i => i.Id).ToHashSet();
        var existingFeatures = await features.FeatureNamesOfAppAsync(appId, ct).ConfigureAwait(false);
        var existingModules = (await features.ModulesOfAppAsync(appId, ct).ConfigureAwait(false)).ToDictionary(m => m.Id, m => m.Name);
        var plan = MakePlan(package, existingItems, existingFeatures, existingModules, allCatalog: false, errors);
        if (errors.Count > 0)
        {
            return new ImportResult.Invalid(errors);
        }

        if (dryRun)
        {
            return new ImportResult.Done(plan.Summary(dryRun: true, ids: null, created: null));
        }

        var created = new Created();
        try
        {
            if (await WriteAsync(appId, package, plan, created, userId, ct).ConfigureAwait(false) is { } failed)
            {
                await UndoAsync(created).ConfigureAwait(false);
                return new ImportResult.Invalid(failed);
            }
        }
        catch
        {
            await UndoAsync(created).ConfigureAwait(false);
            throw;
        }

        return new ImportResult.Done(plan.Summary(dryRun: false, ids: created.Features, created: created));
    }

    /// <summary>
    /// Importar una app completa (spec exportar-e-importar, tarea 7): crea una app nueva con el nombre del archivo
    /// («(importada)» si ya hay una así), todas sus features, todo su catálogo, sus imágenes y la distribución del mapa.
    /// Mismas validaciones y la misma compensación que <see cref="ImportAsync"/>; si algo falla, se borra la app entera.
    /// </summary>
    public async Task<ImportResult> ImportAppAsync(byte[] file, bool dryRun, string userId, CancellationToken ct)
    {
        var errors = new Dictionary<string, string[]>();
        var package = Read(file, errors);
        if (package is null)
        {
            return new ImportResult.Invalid(errors);
        }

        var plan = MakePlan(package, new HashSet<Guid>(), new Dictionary<Guid, string>(), new Dictionary<Guid, string>(), allCatalog: true, errors);
        if (errors.Count > 0)
        {
            return new ImportResult.Invalid(errors);
        }

        var appNames = new HashSet<string>(await appWriter.AppNamesAsync(ct).ConfigureAwait(false), StringComparer.OrdinalIgnoreCase);
        var sourceName = package.Manifest.App.Name.Trim();
        var appName = UniqueName(sourceName.Length == 0 ? "App importada" : sourceName, appNames);
        if (dryRun)
        {
            return new ImportResult.Done(plan.Summary(dryRun: true, ids: null, created: null) with
            {
                App = new ImportedApp(package.Manifest.App.Name, appName, null),
            });
        }

        var created = new Created();
        Guid appId;
        try
        {
            appId = await appWriter.CreateAppAsync(appName, userId, ct).ConfigureAwait(false);
            created.App = appId;
            if (await WriteAsync(appId, package, plan, created, userId, ct).ConfigureAwait(false) is { } failed)
            {
                await UndoAsync(created).ConfigureAwait(false);
                return new ImportResult.Invalid(failed);
            }

            if (package.Map is { } map && MapPositions(map, created) is { } positions)
            {
                await canvasWriter.CreateMapAsync(appId, positions, userId, ct).ConfigureAwait(false);
            }
        }
        catch
        {
            await UndoAsync(created).ConfigureAwait(false);
            throw;
        }

        return new ImportResult.Done(plan.Summary(dryRun: false, ids: created.Features, created: created) with
        {
            App = new ImportedApp(package.Manifest.App.Name, appName, appId),
        });
    }

    /// <summary>
    /// Las posiciones del mapa con los ids de la app nueva (features y <c>catalog:&lt;id&gt;</c>); las de algo que no se
    /// importó, fuera. <c>null</c> si no queda ninguna.
    /// </summary>
    private static JsonElement? MapPositions(JsonElement map, Created created)
    {
        var positions = new JsonObject();
        foreach (var entry in map.EnumerateObject())
        {
            var key = entry.Name.StartsWith("catalog:", StringComparison.Ordinal)
                ? Guid.TryParse(entry.Name["catalog:".Length..], out var item) && created.ItemIds.TryGetValue(item, out var newItem)
                    ? $"catalog:{newItem}"
                    : null
                : Guid.TryParse(entry.Name, out var feature) && created.FeatureIds.TryGetValue(feature, out var newFeature)
                    ? newFeature.ToString()
                    : null;
            if (key is not null)
            {
                positions[key] = JsonNode.Parse(entry.Value.GetRawText());
            }
        }

        if (positions.Count == 0)
        {
            return null;
        }

        using var document = JsonDocument.Parse(positions.ToJsonString());
        return document.RootElement.Clone();
    }

    // ---------- Lectura y validación (sin base) ----------

    private sealed record Package(
        PackageManifest Manifest,
        IReadOnlyList<(PackageManifestFeature Feature, JsonElement Graph)> Features,
        IReadOnlyList<CatalogItemResponse> Catalog,
        IReadOnlyDictionary<Guid, byte[]> Images,
        JsonElement? Map,
        IReadOnlyList<(PackageManifestFeature Module, JsonElement Graph)> Modules)
    {
        /// <summary>Los lienzos del archivo, de features y de módulos, con su ruta.</summary>
        public IEnumerable<(PackageManifestFeature Owner, JsonElement Graph)> AllGraphs =>
            Features.Select(f => (f.Feature, f.Graph)).Concat(Modules.Select(m => (m.Module, m.Graph)));
    }

    private Package? Read(byte[] file, Dictionary<string, string[]> errors)
    {
        ZipArchive zip;
        try
        {
            zip = new ZipArchive(new MemoryStream(file, writable: false), ZipArchiveMode.Read);
        }
        catch (InvalidDataException)
        {
            errors["file"] = ["No es un archivo .walkie válido: no se pudo abrir como .zip."];
            return null;
        }

        using (zip)
        {
            if (zip.Entries.Count > MaxEntries)
            {
                errors["file"] = [$"El archivo tiene demasiadas entradas (más de {MaxEntries})."];
                return null;
            }

            if (zip.Entries.Sum(e => e.Length) > MaxUncompressedBytes)
            {
                errors["file"] = ["El contenido del archivo descomprimido pasa de 200 MB."];
                return null;
            }

            var entries = new Dictionary<string, ZipArchiveEntry>(StringComparer.Ordinal);
            foreach (var entry in zip.Entries)
            {
                entries.TryAdd(entry.FullName, entry);
            }

            if (ReadJson(entries, WalkiePackage.ManifestPath, errors) is not { } manifestJson)
            {
                return null;
            }

            if (ManifestHeaderErrors(manifestJson) is { } header)
            {
                errors[WalkiePackage.ManifestPath] = [header];
                return null;
            }

            var manifestErrors = WalkieSchemas.Errors(WalkieSchemas.Package, manifestJson, WalkiePackage.ManifestPath);
            if (manifestErrors.Count > 0)
            {
                Merge(errors, manifestErrors);
                return null;
            }

            var manifest = manifestJson.Deserialize<PackageManifest>(Json)!;
            var graphs = new List<(PackageManifestFeature, JsonElement)>();
            var seen = new HashSet<Guid>();
            for (var i = 0; i < manifest.Features.Count; i++)
            {
                var feature = manifest.Features[i];
                if (!seen.Add(feature.Id))
                {
                    errors[$"{WalkiePackage.ManifestPath}/features/{i}/id"] = ["Hay dos features con el mismo id."];
                    continue;
                }

                if (string.IsNullOrWhiteSpace(feature.Name))
                {
                    errors[$"{WalkiePackage.ManifestPath}/features/{i}/name"] = ["La feature no tiene nombre."];
                }

                if (ReadJson(entries, feature.Canvas, errors) is not { } graph)
                {
                    continue;
                }

                var graphErrors = canvasWriter.Validate(graph);
                foreach (var (path, messages) in graphErrors)
                {
                    errors[feature.Canvas + (path == "/" ? "" : path)] = messages;
                }

                graphs.Add((feature, graph));
            }

            // Módulos compartidos (spec modulos-compartidos): sus lienzos se validan igual que los de las features.
            var modules = new List<(PackageManifestFeature, JsonElement)>();
            var moduleList = manifest.Modules ?? [];
            for (var i = 0; i < moduleList.Count; i++)
            {
                var module = moduleList[i];
                if (!seen.Add(module.Id))
                {
                    errors[$"{WalkiePackage.ManifestPath}/modules/{i}/id"] = ["Hay dos features o módulos con el mismo id."];
                    continue;
                }

                if (string.IsNullOrWhiteSpace(module.Name))
                {
                    errors[$"{WalkiePackage.ManifestPath}/modules/{i}/name"] = ["El módulo no tiene nombre."];
                }

                if (ReadJson(entries, module.Canvas, errors) is not { } graph)
                {
                    continue;
                }

                foreach (var (path, messages) in canvasWriter.Validate(graph))
                {
                    errors[module.Canvas + (path == "/" ? "" : path)] = messages;
                }

                modules.Add((module, graph));
            }

            var items = new List<CatalogItemResponse>();
            if (ReadJson(entries, manifest.Catalog.Path, errors) is { } catalogJson)
            {
                if (catalogJson.ValueKind != JsonValueKind.Array)
                {
                    errors[manifest.Catalog.Path] = ["catalog.json tiene que ser un arreglo de elementos del catálogo."];
                }
                else
                {
                    var index = 0;
                    foreach (var item in catalogJson.EnumerateArray())
                    {
                        var itemErrors = WalkieSchemas.Errors(WalkieSchemas.CatalogItem, item, $"{manifest.Catalog.Path}/{index}");
                        if (itemErrors.Count > 0)
                        {
                            Merge(errors, itemErrors);
                        }
                        else
                        {
                            items.Add(item.Deserialize<CatalogItemResponse>(Json)!);
                        }

                        index++;
                    }
                }
            }

            var images = new Dictionary<Guid, byte[]>();
            foreach (var image in manifest.Images)
            {
                if (!entries.TryGetValue(image.Path, out var entry))
                {
                    errors[image.Path] = ["Falta la imagen en el archivo."];
                    continue;
                }

                if (entry.Length > assetWriter.MaxSize)
                {
                    errors[image.Path] = ["La imagen pasa de 5 MB."];
                    continue;
                }

                var bytes = ReadBytes(entry, assetWriter.MaxSize);
                if (bytes is null || assetWriter.Recognize(bytes) is null)
                {
                    errors[image.Path] = ["No es una imagen PNG, JPEG o WebP válida."];
                    continue;
                }

                images[image.AssetId] = bytes;
            }

            // La distribución del mapa (solo en el archivo de una app): mismas reglas que al guardarla en la app.
            JsonElement? map = null;
            if (manifest.Map is { } mapEntry && ReadJson(entries, mapEntry.Path, errors) is { } positions)
            {
                var mapErrors = canvasWriter.ValidateMapPositions(positions, mapEntry.Path);
                if (mapErrors.Count > 0)
                {
                    Merge(errors, new Dictionary<string, string[]>(mapErrors));
                }
                else
                {
                    map = positions;
                }
            }

            return errors.Count > 0 ? null : new Package(manifest, graphs, items, images, map, modules);
        }
    }

    /// <summary>Formato y versiones, antes del schema: así un archivo de otra versión da un mensaje claro.</summary>
    private static string? ManifestHeaderErrors(JsonElement manifest)
    {
        if (manifest.ValueKind != JsonValueKind.Object
            || !manifest.TryGetProperty("format", out var format)
            || format.ValueKind != JsonValueKind.String
            || format.GetString() != "walkie-package")
        {
            return "No es un archivo de Walkie: manifest.json no dice format = walkie-package.";
        }

        if (!manifest.TryGetProperty("formatVersion", out var formatVersion)
            || !formatVersion.TryGetInt32(out var fv)
            || fv != 0)
        {
            return $"El archivo usa una versión del formato ({Raw(manifest, "formatVersion")}) que esta versión de Walkie no conoce; "
                + "solo se importa la versión 0.";
        }

        if (!manifest.TryGetProperty("schemaVersion", out var schemaVersion)
            || !schemaVersion.TryGetInt32(out var sv)
            || sv != WalkieInfo.SchemaVersion)
        {
            return $"Los lienzos del archivo usan la versión {Raw(manifest, "schemaVersion")} del schema y esta versión de Walkie "
                + $"usa la {WalkieInfo.SchemaVersion}.";
        }

        return null;
    }

    private static string Raw(JsonElement manifest, string property) =>
        manifest.TryGetProperty(property, out var value) ? value.GetRawText() : "sin indicar";

    private static JsonElement? ReadJson(Dictionary<string, ZipArchiveEntry> entries, string path, Dictionary<string, string[]> errors)
    {
        if (!entries.TryGetValue(path, out var entry))
        {
            errors[path] = ["Falta en el archivo."];
            return null;
        }

        if (ReadBytes(entry, MaxUncompressedBytes) is not { } bytes)
        {
            errors[path] = ["No se pudo leer del archivo."];
            return null;
        }

        try
        {
            using var document = JsonDocument.Parse(bytes);
            return document.RootElement.Clone();
        }
        catch (JsonException)
        {
            errors[path] = ["No es JSON válido."];
            return null;
        }
    }

    /// <summary>Los bytes de la entrada, sin creerle al tamaño que declara: corta al pasar de <paramref name="max"/>.</summary>
    private static byte[]? ReadBytes(ZipArchiveEntry entry, long max)
    {
        try
        {
            using var stream = entry.Open();
            using var buffer = new MemoryStream();
            var chunk = new byte[81920];
            int read;
            while ((read = stream.Read(chunk, 0, chunk.Length)) > 0)
            {
                if (buffer.Length + read > max)
                {
                    return null;
                }

                buffer.Write(chunk, 0, read);
            }

            return buffer.ToArray();
        }
        catch (InvalidDataException)
        {
            return null;
        }
    }

    private static void Merge(Dictionary<string, string[]> errors, Dictionary<string, string[]> more)
    {
        foreach (var (key, value) in more)
        {
            errors[key] = value;
        }
    }

    // ---------- Plan (lee la app de destino, no escribe) ----------

    private sealed record FeaturePlan(PackageManifestFeature Source, JsonElement Graph, string Name, string? Description);

    /// <summary>Un módulo del archivo: se crea con <c>Name</c> o, con <c>Reused</c>, ya está en la app con su id.</summary>
    private sealed record ModulePlan(PackageManifestFeature Source, JsonElement Graph, string Name, string? Description, bool Reused);

    private sealed record Plan(
        IReadOnlyList<FeaturePlan> Features,
        IReadOnlyList<CatalogItemResponse> NewItems,
        int ExistingItems,
        int Images,
        IReadOnlySet<Guid> ExistingFeatures,
        List<string> Warnings,
        IReadOnlyList<ModulePlan> Modules)
    {
        public ImportSummary Summary(bool dryRun, List<Guid>? ids, Created? created) => new(
            dryRun,
            [.. Features.Select((f, i) => new ImportedFeature(f.Source.Name, f.Name, ids?[i]))],
            NewItems.Count,
            ExistingItems,
            Images,
            Warnings,
            Modules: Modules.Count == 0
                ? null
                : [.. Modules.Select(m => new ImportedModule(
                    m.Source.Name,
                    m.Name,
                    m.Reused,
                    m.Reused ? m.Source.Id : created?.ModuleIds.GetValueOrDefault(m.Source.Id) is { } id && id != Guid.Empty ? id : null))]);
    }

    /// <summary>
    /// Qué se va a crear en una app que ya tiene <paramref name="existingItems"/> y <paramref name="existingFeatures"/>.
    /// Con <paramref name="allCatalog"/> (una app nueva) se crea todo el catálogo del archivo; si no, solo lo que usan
    /// los lienzos.
    /// </summary>
    private static Plan MakePlan(
        Package package,
        HashSet<Guid> existingItems,
        IReadOnlyDictionary<Guid, string> existingFeatures,
        IReadOnlyDictionary<Guid, string> existingModules,
        bool allCatalog,
        Dictionary<string, string[]> errors)
    {
        var packageModules = package.Modules.Select(m => m.Module.Id).ToHashSet();
        var packageItems = package.Catalog.Select(i => i.Id).ToHashSet();
        var packageFeatures = package.Features.Select(f => f.Feature.Id).ToHashSet();
        var warnings = new List<string>();

        var takenNames = new HashSet<string>(existingFeatures.Values, StringComparer.OrdinalIgnoreCase);
        var plans = new List<FeaturePlan>();
        foreach (var (feature, graph) in package.AllGraphs)
        {
            foreach (var (nodeId, node) in Nodes(graph))
            {
                var type = node.GetProperty("type").GetString();
                var path = $"{feature.Canvas}/nodes/{nodeId}";
                if (type == "ref" && Id(node, "catalogId") is { } catalogId
                    && !packageItems.Contains(catalogId) && !existingItems.Contains(catalogId))
                {
                    errors[$"{path}/catalogId"] = ["El elemento del catálogo no está en el archivo ni en esta app."];
                }
                else if (type == "screen" && Id(node, "assetId") is { } assetId && !package.Images.ContainsKey(assetId))
                {
                    warnings.Add($"«{feature.Name}»: la pantalla «{Title(node)}» queda sin imagen (no viene en el archivo).");
                }
                else if (type == "portal" && Id(node, "targetFeatureId") is { } target
                         && !packageFeatures.Contains(target) && !existingFeatures.ContainsKey(target))
                {
                    warnings.Add($"«{feature.Name}»: el portal «{Title(node)}» queda sin destino (la feature no está en el archivo ni en esta app).");
                }
                else if (type == "module" && Id(node, "moduleId") is { } moduleId
                         && !packageModules.Contains(moduleId) && !existingModules.ContainsKey(moduleId))
                {
                    warnings.Add($"«{feature.Name}»: la caja del módulo «{Title(node)}» queda pendiente (el módulo no está en el archivo ni en esta app).");
                }
            }
        }

        foreach (var (feature, graph) in package.Features)
        {
            var name = UniqueName(feature.Name.Trim(), takenNames);
            takenNames.Add(name);
            var description = feature.Description?.Trim();
            if (description is { Length: > FeatureDescriptionMaxLength })
            {
                description = description[..FeatureDescriptionMaxLength];
                warnings.Add($"«{feature.Name}»: la descripción se recortó a {FeatureDescriptionMaxLength} caracteres.");
            }

            plans.Add(new FeaturePlan(feature, graph, name, description));
        }

        // Solo los elementos que algún lienzo usa (en una app nueva, todos); los que ya están en la app (misma app de
        // origen) se reutilizan.
        var used = package.AllGraphs.SelectMany(f => Nodes(f.Graph))
            .Where(n => n.Node.GetProperty("type").GetString() == "ref")
            .Select(n => Id(n.Node, "catalogId"))
            .OfType<Guid>()
            .ToHashSet();
        var newItems = package.Catalog
            .Where(i => (allCatalog || used.Contains(i.Id)) && !existingItems.Contains(i.Id))
            .ToList();
        var reused = used.Count(existingItems.Contains);
        var images = UsedImages(package).Count;

        // Un módulo que ya está en la app (mismo id: exportado de ella) se reutiliza; si no, se crea con nombre propio.
        var moduleNames = new HashSet<string>(existingModules.Values, StringComparer.OrdinalIgnoreCase);
        var modules = new List<ModulePlan>();
        foreach (var (module, graph) in package.Modules)
        {
            if (existingModules.TryGetValue(module.Id, out var current))
            {
                modules.Add(new ModulePlan(module, graph, current, null, Reused: true));
                continue;
            }

            var name = UniqueName(module.Name.Trim(), moduleNames);
            moduleNames.Add(name);
            var description = module.Description?.Trim();
            modules.Add(new ModulePlan(module, graph, name, description is { Length: > FeatureDescriptionMaxLength } ? description[..FeatureDescriptionMaxLength] : description, Reused: false));
        }

        return new Plan(plans, newItems, reused, images, existingFeatures.Keys.ToHashSet(), warnings, modules);
    }

    /// <summary>Las imágenes del archivo que alguna pantalla usa (las demás no se suben).</summary>
    private static Dictionary<Guid, byte[]> UsedImages(Package package)
    {
        var used = package.AllGraphs.SelectMany(f => Nodes(f.Graph))
            .Where(n => n.Node.GetProperty("type").GetString() == "screen")
            .Select(n => Id(n.Node, "assetId"))
            .OfType<Guid>()
            .ToHashSet();
        return package.Images.Where(i => used.Contains(i.Key)).ToDictionary(i => i.Key, i => i.Value);
    }

    /// <summary>El nombre, o «Nombre (importada)», «Nombre (importada 2)»… si ya está; dentro de los 120 caracteres.</summary>
    internal static string UniqueName(string name, IReadOnlySet<string> taken)
    {
        name = Truncate(name, FeatureNameMaxLength);
        if (!taken.Contains(name))
        {
            return name;
        }

        for (var n = 1; ; n++)
        {
            var suffix = n == 1 ? " (importada)" : $" (importada {n})";
            var candidate = Truncate(name, FeatureNameMaxLength - suffix.Length).TrimEnd() + suffix;
            if (!taken.Contains(candidate))
            {
                return candidate;
            }
        }
    }

    private static string Truncate(string text, int max) => text.Length <= max ? text : text[..max];

    // ---------- Escritura con compensación ----------

    /// <summary>Lo que lleva creado una importación, para deshacerlo si falla.</summary>
    internal sealed class Created
    {
        public Guid? App { get; set; }

        public List<Guid> Items { get; } = [];

        public List<Guid> Images { get; } = [];

        public List<Guid> Features { get; } = [];

        public List<Guid> Canvases { get; } = [];

        /// <summary>Id en el archivo → id creado.</summary>
        public Dictionary<Guid, Guid> ItemIds { get; } = [];

        /// <summary>Id en el archivo → id creado.</summary>
        public Dictionary<Guid, Guid> FeatureIds { get; } = [];

        /// <summary>Módulos creados (no los reutilizados).</summary>
        public List<Guid> Modules { get; } = [];

        /// <summary>Id en el archivo → id en la app (creado o, si se reutiliza, el mismo).</summary>
        public Dictionary<Guid, Guid> ModuleIds { get; } = [];
    }

    /// <summary>
    /// Crea catálogo, imágenes, features y lienzos en la app y anota todo en <paramref name="created"/>; devuelve los
    /// errores si un lienzo no se pudo guardar (quien llama deshace).
    /// </summary>
    private async Task<Dictionary<string, string[]>?> WriteAsync(
        Guid appId, Package package, Plan plan, Created created, string userId, CancellationToken ct)
    {
        foreach (var item in plan.NewItems)
        {
            var id = await appWriter.CreateCatalogItemAsync(appId, item, userId, ct).ConfigureAwait(false);
            created.Items.Add(id);
            created.ItemIds[item.Id] = id;
        }

        var imageIds = new Dictionary<Guid, Guid>();
        foreach (var (assetId, bytes) in UsedImages(package).OrderBy(i => i.Key))
        {
            var id = await assetWriter.StoreAsync(appId, bytes, userId, ct).ConfigureAwait(false)
                ?? throw new InvalidOperationException("Una imagen ya validada no se pudo guardar.");
            created.Images.Add(id);
            imageIds[assetId] = id;
        }

        foreach (var module in plan.Modules)
        {
            if (module.Reused)
            {
                created.ModuleIds[module.Source.Id] = module.Source.Id;
                continue;
            }

            var id = Guid.CreateVersion7();
            if (!await appWriter.CreateModuleAsync(appId, id, module.Name, module.Description, userId, ct).ConfigureAwait(false))
            {
                throw new InvalidOperationException("No se pudo crear un módulo con un id nuevo.");
            }

            created.Modules.Add(id);
            created.ModuleIds[module.Source.Id] = id;
        }

        foreach (var feature in plan.Features)
        {
            var id = await appWriter.CreateFeatureAsync(appId, feature.Name, feature.Description, userId, ct).ConfigureAwait(false);
            created.Features.Add(id);
            created.FeatureIds[feature.Source.Id] = id;
        }

        // Primero los lienzos de los módulos creados (sus interfaces), después los de las features que los usan.
        foreach (var module in plan.Modules.Where(m => !m.Reused))
        {
            var moduleId = created.ModuleIds[module.Source.Id];
            var graph = Rewrite(module.Graph, created.ItemIds, imageIds, created.FeatureIds, plan.ExistingFeatures, created.ModuleIds);
            var errors = await canvasWriter.CreateAsync(moduleId, graph, userId, ct).ConfigureAwait(false);
            if (errors.Count > 0)
            {
                return errors.ToDictionary(e => module.Source.Canvas + (e.Key == "/" ? "" : e.Key), e => e.Value);
            }

            created.Canvases.Add(moduleId);
        }

        foreach (var feature in plan.Features)
        {
            var featureId = created.FeatureIds[feature.Source.Id];
            var graph = Rewrite(feature.Graph, created.ItemIds, imageIds, created.FeatureIds, plan.ExistingFeatures, created.ModuleIds);
            var errors = await canvasWriter.CreateAsync(featureId, graph, userId, ct).ConfigureAwait(false);
            if (errors.Count > 0)
            {
                return errors.ToDictionary(e => feature.Source.Canvas + (e.Key == "/" ? "" : e.Key), e => e.Value);
            }

            created.Canvases.Add(featureId);
        }

        return null;
    }

    /// <summary>
    /// Borra lo creado, al revés; sin el token del pedido (si se canceló, igual hay que deshacer). En una app nueva,
    /// borrar la app se lleva sus features y su catálogo.
    /// </summary>
    private async Task UndoAsync(Created created)
    {
        await canvasWriter.DeleteAsync(created.Canvases, CancellationToken.None).ConfigureAwait(false);
        await assetWriter.DeleteAsync(created.Images, CancellationToken.None).ConfigureAwait(false);
        if (created.App is { } appId)
        {
            await canvasWriter.DeleteMapAsync(appId, CancellationToken.None).ConfigureAwait(false);
            await appWriter.DeleteAppAsync(appId, CancellationToken.None).ConfigureAwait(false);
            return;
        }

        await appWriter.DeleteFeaturesAsync([.. created.Features, .. created.Modules], CancellationToken.None).ConfigureAwait(false);
        await appWriter.DeleteCatalogItemsAsync(created.Items, CancellationToken.None).ConfigureAwait(false);
    }

    /// <summary>
    /// El grafo con los ids de la app de destino: <c>catalogId</c> de los elementos creados, <c>assetId</c> de las imágenes
    /// subidas (sin imagen, fuera), <c>targetFeatureId</c> de las features del archivo (a una que no está, fuera) y
    /// <c>version</c> 0. Los ids de nodos y conexiones se conservan: son únicos en su lienzo.
    /// </summary>
    internal static JsonElement Rewrite(
        JsonElement graph,
        IReadOnlyDictionary<Guid, Guid> items,
        IReadOnlyDictionary<Guid, Guid> images,
        IReadOnlyDictionary<Guid, Guid> packageFeatures,
        IReadOnlySet<Guid> existingFeatures,
        IReadOnlyDictionary<Guid, Guid>? modules = null)
    {
        var root = JsonNode.Parse(graph.GetRawText())!.AsObject();
        root["version"] = 0;
        foreach (var (_, value) in root["nodes"]!.AsObject())
        {
            var node = value!.AsObject();
            switch (node["type"]?.GetValue<string>())
            {
                case "ref" when Guid.TryParse(node["catalogId"]?.GetValue<string>(), out var id) && items.TryGetValue(id, out var created):
                    node["catalogId"] = created.ToString();
                    break;
                case "screen" when Guid.TryParse(node["assetId"]?.GetValue<string>(), out var id):
                    if (images.TryGetValue(id, out var stored))
                    {
                        node["assetId"] = stored.ToString();
                    }
                    else
                    {
                        node.Remove("assetId");
                    }

                    break;
                // Un módulo del archivo pasa a su id en la app; uno que no está queda pendiente con su id (y su título).
                case "module" when Guid.TryParse(node["moduleId"]?.GetValue<string>(), out var id)
                                   && modules is not null && modules.TryGetValue(id, out var module):
                    node["moduleId"] = module.ToString();
                    break;
                case "portal" when Guid.TryParse(node["targetFeatureId"]?.GetValue<string>(), out var id):
                    if (packageFeatures.TryGetValue(id, out var imported))
                    {
                        node["targetFeatureId"] = imported.ToString();
                    }
                    else if (!existingFeatures.Contains(id))
                    {
                        node.Remove("targetFeatureId");
                    }

                    break;
            }
        }

        using var document = JsonDocument.Parse(root.ToJsonString());
        return document.RootElement.Clone();
    }

    private static IEnumerable<(string Id, JsonElement Node)> Nodes(JsonElement graph) =>
        graph.GetProperty("nodes").EnumerateObject()
            .OrderBy(n => n.Name, StringComparer.Ordinal)
            .Select(n => (n.Name, n.Value));

    private static Guid? Id(JsonElement node, string property) =>
        node.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
        && Guid.TryParse(value.GetString(), out var id)
            ? id
            : null;

    private static string Title(JsonElement node) =>
        node.TryGetProperty("title", out var title) ? title.GetString() ?? "" : "";
}
