using System.IO.Compression;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Canvas.Contracts;
using Walkie.Modules.Export.Features;
using Walkie.Modules.Files.Contracts;
using Walkie.Modules.Files.Persistence;

namespace Walkie.IntegrationTests;

/// <summary>Importar un archivo <c>.walkie</c> (spec exportar-e-importar, tarea 6; ADR-0009). Datos ficticios.</summary>
[Collection(ApiTestGroup.Name)]
public sealed class ImportEndpointsTests(WalkieApiFactory factory)
{
    [Fact]
    public async Task Sin_token_responde_401()
    {
        using var client = factory.CreateClient();

        var response = await PostAsync(client, Guid.CreateVersion7(), [1, 2, 3]);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Una_app_inexistente_responde_404_y_sin_archivo_400()
    {
        using var client = factory.CreateAuthenticatedClient();
        var source = await SourceAsync(client);

        Assert.Equal(HttpStatusCode.NotFound, (await PostAsync(client, Guid.CreateVersion7(), source.Package)).StatusCode);
        using var empty = new MultipartFormDataContent();
        var response = await client.PostAsync(ImportUri(source.App), empty);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("file", await ErrorKeysAsync(response));
    }

    [Fact]
    public async Task Ida_y_vuelta_a_otra_app_reconstruye_el_lienzo_con_ids_de_la_nueva_app()
    {
        using var client = factory.CreateAuthenticatedClient();
        var source = await SourceAsync(client);
        var target = await CreateAppAsync(client);

        var response = await PostAsync(client, target, source.Package);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var summary = await SummaryAsync(response);
        Assert.False(summary.GetProperty("dryRun").GetBoolean());
        var imported = Assert.Single(summary.GetProperty("features").EnumerateArray());
        Assert.Equal("Iniciar sesión", imported.GetProperty("name").GetString());
        Assert.Equal(1, summary.GetProperty("newCatalogItems").GetInt32());
        Assert.Equal(0, summary.GetProperty("existingCatalogItems").GetInt32());
        Assert.Equal(1, summary.GetProperty("images").GetInt32());
        // El portal apunta a «Transferir», que no viaja en el archivo ni está en la otra app.
        var warning = Assert.Single(summary.GetProperty("warnings").EnumerateArray());
        Assert.Contains("queda sin destino", warning.GetString(), StringComparison.Ordinal);

        var featureId = imported.GetProperty("id").GetGuid();
        Assert.NotEqual(source.Feature, featureId);
        var features = await client.GetFromJsonAsync<List<FeatureResponse>>(new Uri($"/api/apps/{target}/features", UriKind.Relative));
        var feature = Assert.Single(features!);
        Assert.Equal(featureId, feature.Id);
        Assert.Equal("Entrar con documento.", feature.Description);

        var canvas = await CanvasAsync(client, featureId);
        var original = await CanvasAsync(client, source.Feature);
        Assert.Equal(1, canvas["version"]!.GetValue<int>());

        // El ref apunta a un elemento nuevo de la otra app, con la misma definición.
        var catalogId = Guid.Parse(canvas["nodes"]!["c1"]!["catalogId"]!.GetValue<string>());
        Assert.NotEqual(source.Item, catalogId);
        var item = await client.GetFromJsonAsync<CatalogItemResponse>(new Uri($"/api/catalog/{catalogId}", UriKind.Relative));
        Assert.Equal(target, item!.AppId);
        Assert.Equal("Consultar cliente", item.Title);
        Assert.Equal("GET", item.HttpMethod);

        // La imagen se subió de nuevo con otro id y los mismos bytes.
        var assetId = Guid.Parse(canvas["nodes"]!["s1"]!["assetId"]!.GetValue<string>());
        Assert.NotEqual(source.Asset, assetId);
        Assert.Equal(source.Image, await client.GetByteArrayAsync(new Uri($"/api/assets/{assetId}", UriKind.Relative)));

        // El portal sin destino pierde targetFeatureId; fuera de los ids remapeados, el lienzo es el mismo.
        Assert.Null(canvas["nodes"]!["p1"]!["targetFeatureId"]);
        foreach (var graph in new[] { canvas, original })
        {
            graph.Remove("version");
            graph["nodes"]!["c1"]!.AsObject().Remove("catalogId");
            graph["nodes"]!["s1"]!.AsObject().Remove("assetId");
            graph["nodes"]!["p1"]!.AsObject().Remove("targetFeatureId");
        }

        Assert.True(JsonNode.DeepEquals(original, canvas));
    }

    [Fact]
    public async Task En_la_misma_app_reutiliza_el_catalogo_conserva_portales_y_no_repite_nombres()
    {
        using var client = factory.CreateAuthenticatedClient();
        var source = await SourceAsync(client);

        var first = await SummaryAsync(await PostAsync(client, source.App, source.Package));
        var second = await SummaryAsync(await PostAsync(client, source.App, source.Package));

        Assert.Equal("Iniciar sesión (importada)", first.GetProperty("features")[0].GetProperty("name").GetString());
        Assert.Equal("Iniciar sesión (importada 2)", second.GetProperty("features")[0].GetProperty("name").GetString());
        Assert.Equal(0, first.GetProperty("newCatalogItems").GetInt32());
        Assert.Equal(1, first.GetProperty("existingCatalogItems").GetInt32());
        Assert.Empty(first.GetProperty("warnings").EnumerateArray());

        var canvas = await CanvasAsync(client, first.GetProperty("features")[0].GetProperty("id").GetGuid());
        Assert.Equal(source.Item.ToString(), canvas["nodes"]!["c1"]!["catalogId"]!.GetValue<string>());
        Assert.Equal(source.Transferir.ToString(), canvas["nodes"]!["p1"]!["targetFeatureId"]!.GetValue<string>());
        var catalog = await client.GetFromJsonAsync<List<CatalogItemResponse>>(new Uri($"/api/apps/{source.App}/catalog", UriKind.Relative));
        Assert.Single(catalog!);
    }

    [Fact]
    public async Task Con_dry_run_devuelve_el_resumen_sin_crear_nada()
    {
        using var client = factory.CreateAuthenticatedClient();
        var source = await SourceAsync(client);
        var target = await CreateAppAsync(client);

        var response = await PostAsync(client, target, source.Package, dryRun: true);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var summary = await SummaryAsync(response);
        Assert.True(summary.GetProperty("dryRun").GetBoolean());
        var feature = Assert.Single(summary.GetProperty("features").EnumerateArray());
        Assert.False(feature.TryGetProperty("id", out _));
        Assert.Equal(1, summary.GetProperty("newCatalogItems").GetInt32());
        Assert.Equal(1, summary.GetProperty("images").GetInt32());
        Assert.Empty((await client.GetFromJsonAsync<List<FeatureResponse>>(new Uri($"/api/apps/{target}/features", UriKind.Relative)))!);
        Assert.Empty((await client.GetFromJsonAsync<List<CatalogItemResponse>>(new Uri($"/api/apps/{target}/catalog", UriKind.Relative)))!);
        Assert.Equal(0, await AssetCountAsync(target));
    }

    [Fact]
    public async Task Un_archivo_que_no_es_zip_o_de_otra_version_responde_400_con_mensaje_claro()
    {
        using var client = factory.CreateAuthenticatedClient();
        var source = await SourceAsync(client);
        var target = await CreateAppAsync(client);

        var notZip = await PostAsync(client, target, Encoding.UTF8.GetBytes("no soy un zip"));
        Assert.Equal(HttpStatusCode.BadRequest, notZip.StatusCode);
        Assert.Contains("file", await ErrorKeysAsync(notZip));

        var files = Unzip(source.Package);
        var manifest = JsonNode.Parse(files["manifest.json"])!;
        manifest["formatVersion"] = 1;
        files["manifest.json"] = Encoding.UTF8.GetBytes(manifest.ToJsonString());
        var otherVersion = await PostAsync(client, target, Zip(files));
        Assert.Equal(HttpStatusCode.BadRequest, otherVersion.StatusCode);
        var errors = await ErrorsAsync(otherVersion);
        Assert.Contains("versión del formato", errors["manifest.json"][0], StringComparison.Ordinal);

        files.Remove("manifest.json");
        var noManifest = await PostAsync(client, target, Zip(files));
        Assert.Contains("manifest.json", await ErrorKeysAsync(noManifest));
        Assert.Empty((await client.GetFromJsonAsync<List<FeatureResponse>>(new Uri($"/api/apps/{target}/features", UriKind.Relative)))!);
    }

    [Fact]
    public async Task Los_errores_del_lienzo_y_del_catalogo_traen_su_ruta_en_el_archivo()
    {
        using var client = factory.CreateAuthenticatedClient();
        var source = await SourceAsync(client);
        var target = await CreateAppAsync(client);
        var canvasPath = $"features/{source.Feature}/canvas.json";

        // Una conexión a un nodo que no existe.
        var files = Unzip(source.Package);
        var graph = JsonNode.Parse(files[canvasPath])!;
        graph["edges"]!["e1"]!["to"] = "nadie";
        files[canvasPath] = Encoding.UTF8.GetBytes(graph.ToJsonString());
        var keys = await ErrorKeysAsync(await PostAsync(client, target, Zip(files)));
        Assert.Contains(keys, k => k.StartsWith(canvasPath + "/edges/e1", StringComparison.Ordinal));

        // Un ref a un elemento que no viene en el archivo ni está en la app de destino.
        files = Unzip(source.Package);
        files["catalog.json"] = Encoding.UTF8.GetBytes("[]");
        var response = await PostAsync(client, target, Zip(files));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains($"{canvasPath}/nodes/c1/catalogId", await ErrorKeysAsync(response));

        // Un elemento del catálogo que no cumple walkie-catalog-item.
        files = Unzip(source.Package);
        var catalog = JsonNode.Parse(files["catalog.json"])!;
        catalog[0]!["type"] = "cohete";
        files["catalog.json"] = Encoding.UTF8.GetBytes(catalog.ToJsonString());
        Assert.Contains(await ErrorKeysAsync(await PostAsync(client, target, Zip(files))), k => k.StartsWith("catalog.json/0", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Un_archivo_de_mas_de_50_mb_responde_413()
    {
        using var client = factory.CreateAuthenticatedClient();
        var target = await CreateAppAsync(client);

        var response = await PostAsync(client, target, new byte[(int)ImportHandlers.MaxFileBytes + 1]);

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
    }

    [Fact]
    public async Task Si_falla_a_mitad_de_camino_borra_lo_creado()
    {
        using var client = factory.CreateAuthenticatedClient();
        var source = await SourceAsync(client);
        var target = await CreateAppAsync(client);
        // Dos features en el archivo: el segundo lienzo falla al guardarse, después de crear catálogo, imagen y features.
        var package = await TwoFeaturesAsync(client, source);

        using var scope = factory.Services.CreateScope();
        var services = scope.ServiceProvider;
        var handlers = new ImportHandlers(
            services.GetRequiredService<IAppDirectory>(),
            services.GetRequiredService<IFeatureDirectory>(),
            services.GetRequiredService<ICatalogDirectory>(),
            services.GetRequiredService<IAppWriter>(),
            services.GetRequiredService<IAssetWriter>(),
            new FailingSecondCanvas(services.GetRequiredService<ICanvasWriter>()));

        var result = await handlers.ImportAsync(target, package, dryRun: false, "dev", CancellationToken.None);

        var invalid = Assert.IsType<ImportResult.Invalid>(result);
        Assert.Contains(invalid.Errors.Keys, k => k.EndsWith("canvas.json/version", StringComparison.Ordinal));
        Assert.Empty((await client.GetFromJsonAsync<List<FeatureResponse>>(new Uri($"/api/apps/{target}/features", UriKind.Relative)))!);
        Assert.Empty((await client.GetFromJsonAsync<List<CatalogItemResponse>>(new Uri($"/api/apps/{target}/catalog", UriKind.Relative)))!);
        Assert.Equal(0, await AssetCountAsync(target));
    }

    [Fact]
    public void Los_nombres_repetidos_reciben_un_sufijo_dentro_de_los_120_caracteres()
    {
        var taken = new HashSet<string>(["Pagos", "Pagos (importada)", new string('a', 120)], StringComparer.OrdinalIgnoreCase);

        Assert.Equal("Cobros", ImportHandlers.UniqueName("Cobros", taken));
        Assert.Equal("pagos (importada 2)", ImportHandlers.UniqueName("pagos", taken));
        var longName = ImportHandlers.UniqueName(new string('a', 130), taken);
        Assert.Equal(120, longName.Length);
        Assert.EndsWith(" (importada)", longName, StringComparison.Ordinal);
    }

    [Fact]
    public async Task El_endpoint_aparece_en_openapi()
    {
        using var client = factory.CreateClient();

        var openApi = await client.GetStringAsync(new Uri("/openapi/v1.json", UriKind.Relative));

        Assert.Contains("/api/apps/{appId}/import", openApi, StringComparison.Ordinal);
    }

    // ---------- Datos ----------

    private sealed record Source(Guid App, Guid Feature, Guid Transferir, Guid Item, Guid Asset, byte[] Image, byte[] Package);

    /// <summary>Una app con «Iniciar sesión» (pantalla con imagen, ref al catálogo y portal a «Transferir») y su <c>.walkie</c>.</summary>
    private static async Task<Source> SourceAsync(HttpClient client)
    {
        var app = await CreateAppAsync(client);
        var created = await client.PostAsJsonAsync(
            new Uri($"/api/apps/{app}/features", UriKind.Relative), new CreateFeatureRequest("Iniciar sesión", "Entrar con documento."));
        var feature = (await created.Content.ReadFromJsonAsync<FeatureResponse>())!.Id;
        var transferir = await CreateFeatureAsync(client, app, "Transferir");
        var item = await CreateItemAsync(client, app);
        var image = TestImages.Create("png", 2, 2);
        var asset = await UploadAsync(client, app, image);
        await SaveAsync(client, feature, Graph(asset, item, transferir));
        var package = await client.GetByteArrayAsync(new Uri($"/api/features/{feature}/export?format=walkie", UriKind.Relative));
        return new Source(app, feature, transferir, item, asset, image, package);
    }

    /// <summary>El archivo de <paramref name="source"/> con «Transferir» también adentro (su lienzo vacío).</summary>
    private static async Task<byte[]> TwoFeaturesAsync(HttpClient client, Source source)
    {
        var files = Unzip(source.Package);
        var other = Unzip(await client.GetByteArrayAsync(new Uri($"/api/features/{source.Transferir}/export?format=walkie", UriKind.Relative)));
        var path = $"features/{source.Transferir}/canvas.json";
        files[path] = other[path];
        var manifest = JsonNode.Parse(files["manifest.json"])!;
        manifest["features"]!.AsArray().Add(JsonNode.Parse(other["manifest.json"])!["features"]![0]!.DeepClone());
        files["manifest.json"] = Encoding.UTF8.GetBytes(manifest.ToJsonString());
        return Zip(files);
    }

    /// <summary>Guarda el primer lienzo y hace fallar el segundo, como si otro lo hubiera guardado antes.</summary>
    private sealed class FailingSecondCanvas(ICanvasWriter inner) : ICanvasWriter
    {
        private int _calls;

        public IReadOnlyDictionary<string, string[]> Validate(JsonElement graph) => inner.Validate(graph);

        public Task<IReadOnlyDictionary<string, string[]>> CreateAsync(Guid featureId, JsonElement graph, string userId, CancellationToken cancellationToken) =>
            ++_calls == 1
                ? inner.CreateAsync(featureId, graph, userId, cancellationToken)
                : Task.FromResult<IReadOnlyDictionary<string, string[]>>(
                    new Dictionary<string, string[]> { ["/version"] = ["La feature ya tiene un lienzo."] });

        public Task DeleteAsync(IReadOnlyCollection<Guid> featureIds, CancellationToken cancellationToken) =>
            inner.DeleteAsync(featureIds, cancellationToken);
    }

    private async Task<int> AssetCountAsync(Guid appId)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<FilesDbContext>();
        return await db.Assets.CountAsync(a => a.AppId == appId);
    }

    private static JsonObject Graph(Guid asset, Guid item, Guid target) => new()
    {
        ["schemaVersion"] = 0,
        ["version"] = 0,
        ["nodes"] = new JsonObject
        {
            ["s1"] = new JsonObject { ["id"] = "s1", ["type"] = "screen", ["title"] = "Login", ["assetId"] = asset.ToString() },
            ["c1"] = new JsonObject { ["id"] = "c1", ["type"] = "ref", ["title"] = "Consultar", ["catalogId"] = item.ToString() },
            ["p1"] = new JsonObject { ["id"] = "p1", ["type"] = "portal", ["title"] = "Transferir", ["targetFeatureId"] = target.ToString() },
        },
        ["edges"] = new JsonObject
        {
            ["e1"] = new JsonObject { ["id"] = "e1", ["from"] = "s1", ["to"] = "c1", ["kind"] = "request" },
            ["e2"] = new JsonObject { ["id"] = "e2", ["from"] = "s1", ["to"] = "p1", ["kind"] = "navigation" },
        },
        ["layout"] = new JsonObject { ["s1"] = new JsonObject { ["x"] = 0, ["y"] = 0 }, ["c1"] = new JsonObject { ["x"] = 240, ["y"] = 0 } },
    };

    // ---------- HTTP y zip ----------

    private static Uri ImportUri(Guid appId, bool dryRun = false) =>
        new($"/api/apps/{appId}/import{(dryRun ? "?dryRun=true" : "")}", UriKind.Relative);

    private static async Task<HttpResponseMessage> PostAsync(HttpClient client, Guid appId, byte[] file, bool dryRun = false)
    {
        using var part = new ByteArrayContent(file);
        part.Headers.ContentType = MediaTypeHeaderValue.Parse("application/zip");
        using var content = new MultipartFormDataContent { { part, "file", "feature.walkie" } };
        return await client.PostAsync(ImportUri(appId, dryRun), content);
    }

    private static async Task<JsonElement> SummaryAsync(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        var summary = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Empty(Walkie.Shared.Schemas.WalkieSchemas.Errors(Walkie.Shared.Schemas.WalkieSchemas.ImportSummary, summary));
        return summary;
    }

    private static async Task<Dictionary<string, string[]>> ErrorsAsync(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        return problem.GetProperty("errors").Deserialize<Dictionary<string, string[]>>()!;
    }

    private static async Task<IReadOnlyCollection<string>> ErrorKeysAsync(HttpResponseMessage response) =>
        (await ErrorsAsync(response)).Keys;

    private static async Task<JsonObject> CanvasAsync(HttpClient client, Guid featureId) =>
        (await client.GetFromJsonAsync<JsonObject>(new Uri($"/api/features/{featureId}/canvas", UriKind.Relative)))!;

    private static Dictionary<string, byte[]> Unzip(byte[] package)
    {
        using var zip = new ZipArchive(new MemoryStream(package), ZipArchiveMode.Read);
        var files = new Dictionary<string, byte[]>();
        foreach (var entry in zip.Entries)
        {
            using var content = entry.Open();
            using var bytes = new MemoryStream();
            content.CopyTo(bytes);
            files[entry.FullName] = bytes.ToArray();
        }

        return files;
    }

    private static byte[] Zip(Dictionary<string, byte[]> files)
    {
        using var buffer = new MemoryStream();
        using (var zip = new ZipArchive(buffer, ZipArchiveMode.Create, leaveOpen: true))
        {
            foreach (var (name, bytes) in files)
            {
                using var entry = zip.CreateEntry(name).Open();
                entry.Write(bytes);
            }
        }

        return buffer.ToArray();
    }

    private static async Task SaveAsync(HttpClient client, Guid featureId, JsonObject graph)
    {
        var response = await client.PutAsJsonAsync(new Uri($"/api/features/{featureId}/canvas", UriKind.Relative), graph);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    private static async Task<Guid> UploadAsync(HttpClient client, Guid appId, byte[] image)
    {
        using var file = new ByteArrayContent(image);
        file.Headers.ContentType = MediaTypeHeaderValue.Parse("image/png");
        using var content = new MultipartFormDataContent { { file, "file", "login.png" } };
        var response = await client.PostAsync(new Uri($"/api/apps/{appId}/assets", UriKind.Relative), content);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<AssetResponse>())!.Id;
    }

    private static async Task<Guid> CreateItemAsync(HttpClient client, Guid appId)
    {
        var response = await client.PostAsJsonAsync(
            new Uri($"/api/apps/{appId}/catalog", UriKind.Relative),
            new CreateCatalogItemRequest("api", "Consultar cliente", null, TestJson.Http("GET", "/clientes/{id}")));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<CatalogItemResponse>())!.Id;
    }

    private static async Task<Guid> CreateAppAsync(HttpClient client)
    {
        var response = await client.PostAsJsonAsync(new Uri("/api/apps", UriKind.Relative), new CreateAppRequest("Banca de prueba"));
        return (await response.Content.ReadFromJsonAsync<AppResponse>())!.Id;
    }

    private static async Task<Guid> CreateFeatureAsync(HttpClient client, Guid appId, string name)
    {
        var response = await client.PostAsJsonAsync(
            new Uri($"/api/apps/{appId}/features", UriKind.Relative), new CreateFeatureRequest(name));
        return (await response.Content.ReadFromJsonAsync<FeatureResponse>())!.Id;
    }
}
