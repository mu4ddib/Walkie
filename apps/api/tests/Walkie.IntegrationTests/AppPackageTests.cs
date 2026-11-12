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
using Walkie.Shared.Schemas;

namespace Walkie.IntegrationTests;

/// <summary>
/// Exportar e importar la app completa (spec exportar-e-importar, tarea 7; ADR-0009): el <c>.walkie</c> con scope app y
/// <c>POST /api/apps/import</c>, que crea una app nueva. Datos ficticios.
/// </summary>
[Collection(ApiTestGroup.Name)]
public sealed class AppPackageTests(WalkieApiFactory factory)
{
    [Fact]
    public async Task Sin_token_responde_401()
    {
        using var client = factory.CreateClient();

        using var content = new MultipartFormDataContent();
        var response = await client.PostAsync(new Uri("/api/apps/import", UriKind.Relative), content);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task El_walkie_de_la_app_trae_todas_las_features_todo_el_catalogo_y_el_mapa()
    {
        using var client = factory.CreateAuthenticatedClient();
        var source = await SourceAsync(client, withMap: true);

        var response = await client.GetAsync(new Uri($"/api/apps/{source.App}/export?format=walkie", UriKind.Relative));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/zip", response.Content.Headers.ContentType!.MediaType);
        Assert.EndsWith(".walkie", response.Content.Headers.ContentDisposition!.FileName?.Trim('"'), StringComparison.Ordinal);
        var files = Unzip(await response.Content.ReadAsByteArrayAsync());
        var manifest = JsonDocument.Parse(files["manifest.json"]).RootElement;
        Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.Package, manifest));
        Assert.Equal("app", manifest.GetProperty("scope").GetString());
        Assert.Equal(source.Name, manifest.GetProperty("app").GetProperty("name").GetString());
        Assert.Equal(
            ["Iniciar sesión", "Transferir"],
            manifest.GetProperty("features").EnumerateArray().Select(f => f.GetProperty("name").GetString()).Order(StringComparer.Ordinal));

        // Todo el catálogo, también lo que ningún lienzo usa.
        Assert.Equal(2, manifest.GetProperty("catalog").GetProperty("count").GetInt32());
        Assert.Equal(2, JsonDocument.Parse(files["catalog.json"]).RootElement.GetArrayLength());

        // La distribución del mapa, tal como se guardó.
        Assert.Equal("map.json", manifest.GetProperty("map").GetProperty("path").GetString());
        var map = JsonDocument.Parse(files["map.json"]).RootElement;
        Assert.Equal(120, map.GetProperty(source.Login.ToString()).GetProperty("x").GetDouble());
        Assert.True(map.TryGetProperty($"catalog:{source.Used}", out _));
        Assert.Contains($"img/{source.Asset}.png", files.Keys);
    }

    [Fact]
    public async Task Sin_mapa_acomodado_el_archivo_no_trae_map_json_y_una_app_inexistente_responde_404()
    {
        using var client = factory.CreateAuthenticatedClient();
        var source = await SourceAsync(client, withMap: false);

        var files = Unzip(await client.GetByteArrayAsync(new Uri($"/api/apps/{source.App}/export?format=walkie", UriKind.Relative)));

        Assert.DoesNotContain("map.json", files.Keys);
        Assert.False(JsonDocument.Parse(files["manifest.json"]).RootElement.TryGetProperty("map", out _));
        var missing = await client.GetAsync(new Uri($"/api/apps/{Guid.CreateVersion7()}/export?format=walkie", UriKind.Relative));
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
    }

    [Fact]
    public async Task Importar_la_app_crea_una_app_nueva_con_ids_nuevos_portales_y_mapa_remapeados()
    {
        using var client = factory.CreateAuthenticatedClient();
        var source = await SourceAsync(client, withMap: true);
        var package = await client.GetByteArrayAsync(new Uri($"/api/apps/{source.App}/export?format=walkie", UriKind.Relative));

        var response = await PostAsync(client, package);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var summary = await SummaryAsync(response);
        // Ya hay una app con ese nombre (la de origen): la nueva lleva «(importada)».
        var app = summary.GetProperty("app");
        Assert.Equal(source.Name, app.GetProperty("sourceName").GetString());
        Assert.Equal($"{source.Name} (importada)", app.GetProperty("name").GetString());
        var appId = app.GetProperty("id").GetGuid();
        Assert.NotEqual(source.App, appId);
        Assert.Equal($"/api/apps/{appId}", response.Headers.Location!.OriginalString);
        Assert.Equal(2, summary.GetProperty("newCatalogItems").GetInt32());
        Assert.Equal(1, summary.GetProperty("images").GetInt32());
        Assert.Empty(summary.GetProperty("warnings").EnumerateArray());

        var features = (await client.GetFromJsonAsync<List<FeatureResponse>>(new Uri($"/api/apps/{appId}/features", UriKind.Relative)))!;
        Assert.Equal(["Iniciar sesión", "Transferir"], features.Select(f => f.Name).Order(StringComparer.Ordinal));
        var login = features.Single(f => f.Name == "Iniciar sesión").Id;
        var transferir = features.Single(f => f.Name == "Transferir").Id;
        var catalog = (await client.GetFromJsonAsync<List<CatalogItemResponse>>(new Uri($"/api/apps/{appId}/catalog", UriKind.Relative)))!;
        Assert.Equal(["Consultar cliente", "Registrar auditoría"], catalog.Select(i => i.Title).Order(StringComparer.Ordinal));
        Assert.DoesNotContain(catalog, i => i.Id == source.Used || i.Id == source.Unused);

        // El portal apunta a la «Transferir» nueva y el ref al elemento nuevo.
        var canvas = (await client.GetFromJsonAsync<JsonObject>(new Uri($"/api/features/{login}/canvas", UriKind.Relative)))!;
        Assert.Equal(transferir.ToString(), canvas["nodes"]!["p1"]!["targetFeatureId"]!.GetValue<string>());
        var used = catalog.Single(i => i.Title == "Consultar cliente").Id;
        Assert.Equal(used.ToString(), canvas["nodes"]!["c1"]!["catalogId"]!.GetValue<string>());

        // El mapa conserva las posiciones con los ids nuevos.
        var map = (await client.GetFromJsonAsync<AppMap>(new Uri($"/api/apps/{appId}/map", UriKind.Relative)))!;
        Assert.Equal(1, map.Layout.Version);
        Assert.Equal(new MapPosition(120, 40), map.Layout.Positions[login.ToString()]);
        Assert.Equal(new MapPosition(400, 200), map.Layout.Positions[$"catalog:{used}"]);
        Assert.Equal(2, map.Layout.Positions.Count);
    }

    [Fact]
    public async Task Con_dry_run_devuelve_el_resumen_sin_crear_la_app()
    {
        using var client = factory.CreateAuthenticatedClient();
        var source = await SourceAsync(client, withMap: true);
        var package = await client.GetByteArrayAsync(new Uri($"/api/apps/{source.App}/export?format=walkie", UriKind.Relative));

        var response = await PostAsync(client, package, dryRun: true);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var summary = await SummaryAsync(response);
        Assert.True(summary.GetProperty("dryRun").GetBoolean());
        Assert.False(summary.GetProperty("app").TryGetProperty("id", out _));
        Assert.Equal(2, summary.GetProperty("features").GetArrayLength());
        var apps = (await client.GetFromJsonAsync<List<AppResponse>>(new Uri("/api/apps", UriKind.Relative)))!;
        Assert.DoesNotContain(apps, a => a.Name == $"{source.Name} (importada)");
    }

    [Fact]
    public async Task Un_mapa_invalido_responde_400_con_su_ruta_y_no_crea_nada()
    {
        using var client = factory.CreateAuthenticatedClient();
        var source = await SourceAsync(client, withMap: true);
        var files = Unzip(await client.GetByteArrayAsync(new Uri($"/api/apps/{source.App}/export?format=walkie", UriKind.Relative)));
        var broken = new JsonObject { [source.Login.ToString()] = new JsonObject { ["x"] = "lejos" } };
        files["map.json"] = Encoding.UTF8.GetBytes(broken.ToJsonString());

        var response = await PostAsync(client, Zip(files));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        var keys = problem.GetProperty("errors").EnumerateObject().Select(e => e.Name).ToList();
        Assert.Contains(keys, k => k.StartsWith("map.json", StringComparison.Ordinal));
        var apps = (await client.GetFromJsonAsync<List<AppResponse>>(new Uri("/api/apps", UriKind.Relative)))!;
        Assert.DoesNotContain(apps, a => a.Name == $"{source.Name} (importada)");
    }

    [Fact]
    public async Task Si_falla_a_mitad_de_camino_borra_la_app_entera()
    {
        using var client = factory.CreateAuthenticatedClient();
        var source = await SourceAsync(client, withMap: true);
        var package = await client.GetByteArrayAsync(new Uri($"/api/apps/{source.App}/export?format=walkie", UriKind.Relative));
        var assetsBefore = await AssetCountAsync();

        using var scope = factory.Services.CreateScope();
        var services = scope.ServiceProvider;
        var handlers = new ImportHandlers(
            services.GetRequiredService<IAppDirectory>(),
            services.GetRequiredService<IFeatureDirectory>(),
            services.GetRequiredService<ICatalogDirectory>(),
            services.GetRequiredService<IAppWriter>(),
            services.GetRequiredService<IAssetWriter>(),
            new ImportEndpointsTests.FailingSecondCanvas(services.GetRequiredService<ICanvasWriter>()));

        var result = await handlers.ImportAppAsync(package, dryRun: false, "dev", CancellationToken.None);

        Assert.IsType<ImportResult.Invalid>(result);
        var apps = (await client.GetFromJsonAsync<List<AppResponse>>(new Uri("/api/apps", UriKind.Relative)))!;
        Assert.DoesNotContain(apps, a => a.Name == $"{source.Name} (importada)");
        Assert.Equal(assetsBefore, await AssetCountAsync());
    }

    [Fact]
    public async Task Los_endpoints_aparecen_en_openapi()
    {
        using var client = factory.CreateClient();

        var openApi = await client.GetStringAsync(new Uri("/openapi/v1.json", UriKind.Relative));

        Assert.Contains("\"/api/apps/import\"", openApi, StringComparison.Ordinal);
        Assert.Contains("format=walkie: la app completa", openApi, StringComparison.Ordinal);
    }

    // ---------- Datos ----------

    private sealed record Source(Guid App, string Name, Guid Login, Guid Transferir, Guid Used, Guid Unused, Guid Asset);

    /// <summary>
    /// Una app con «Iniciar sesión» (pantalla con imagen, ref a «Consultar cliente» y portal a «Transferir»), «Transferir»
    /// vacía, un elemento del catálogo que nadie usa y, si se pide, el mapa acomodado.
    /// </summary>
    private static async Task<Source> SourceAsync(HttpClient client, bool withMap)
    {
        var name = $"Banca {Guid.CreateVersion7():N}"[..30];
        var app = (await (await client.PostAsJsonAsync(new Uri("/api/apps", UriKind.Relative), new CreateAppRequest(name)))
            .Content.ReadFromJsonAsync<AppResponse>())!.Id;
        var login = await CreateFeatureAsync(client, app, "Iniciar sesión");
        var transferir = await CreateFeatureAsync(client, app, "Transferir");
        var used = await CreateItemAsync(client, app, "Consultar cliente");
        var unused = await CreateItemAsync(client, app, "Registrar auditoría");
        var asset = await UploadAsync(client, app, TestImages.Create("png", 2, 2));
        var graph = new JsonObject
        {
            ["schemaVersion"] = 0,
            ["version"] = 0,
            ["nodes"] = new JsonObject
            {
                ["s1"] = new JsonObject { ["id"] = "s1", ["type"] = "screen", ["title"] = "Login", ["assetId"] = asset.ToString() },
                ["c1"] = new JsonObject { ["id"] = "c1", ["type"] = "ref", ["title"] = "Consultar", ["catalogId"] = used.ToString() },
                ["p1"] = new JsonObject { ["id"] = "p1", ["type"] = "portal", ["title"] = "Transferir", ["targetFeatureId"] = transferir.ToString() },
            },
            ["edges"] = new JsonObject
            {
                ["e1"] = new JsonObject { ["id"] = "e1", ["from"] = "s1", ["to"] = "c1", ["kind"] = "request" },
                ["e2"] = new JsonObject { ["id"] = "e2", ["from"] = "s1", ["to"] = "p1", ["kind"] = "navigation" },
            },
            ["layout"] = new JsonObject(),
        };
        var saved = await client.PutAsJsonAsync(new Uri($"/api/features/{login}/canvas", UriKind.Relative), graph);
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);

        if (withMap)
        {
            var layout = new JsonObject
            {
                ["version"] = 0,
                ["positions"] = new JsonObject
                {
                    [login.ToString()] = new JsonObject { ["x"] = 120, ["y"] = 40 },
                    [$"catalog:{used}"] = new JsonObject { ["x"] = 400, ["y"] = 200 },
                    // Una feature que ya no existe: al importar se descarta.
                    [Guid.CreateVersion7().ToString()] = new JsonObject { ["x"] = 0, ["y"] = 0 },
                },
            };
            var map = await client.PutAsJsonAsync(new Uri($"/api/apps/{app}/map/layout", UriKind.Relative), layout);
            Assert.Equal(HttpStatusCode.OK, map.StatusCode);
        }

        return new Source(app, name, login, transferir, used, unused, asset);
    }

    private async Task<int> AssetCountAsync()
    {
        using var scope = factory.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<FilesDbContext>().Assets.CountAsync();
    }

    private static async Task<HttpResponseMessage> PostAsync(HttpClient client, byte[] file, bool dryRun = false)
    {
        using var part = new ByteArrayContent(file);
        part.Headers.ContentType = MediaTypeHeaderValue.Parse("application/zip");
        using var content = new MultipartFormDataContent { { part, "file", "app.walkie" } };
        return await client.PostAsync(new Uri($"/api/apps/import{(dryRun ? "?dryRun=true" : "")}", UriKind.Relative), content);
    }

    private static async Task<JsonElement> SummaryAsync(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        var summary = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Empty(WalkieSchemas.Errors(WalkieSchemas.ImportSummary, summary));
        return summary;
    }

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

    private static async Task<Guid> UploadAsync(HttpClient client, Guid appId, byte[] image)
    {
        using var file = new ByteArrayContent(image);
        file.Headers.ContentType = MediaTypeHeaderValue.Parse("image/png");
        using var content = new MultipartFormDataContent { { file, "file", "login.png" } };
        var response = await client.PostAsync(new Uri($"/api/apps/{appId}/assets", UriKind.Relative), content);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<AssetResponse>())!.Id;
    }

    private static async Task<Guid> CreateItemAsync(HttpClient client, Guid appId, string title)
    {
        var response = await client.PostAsJsonAsync(
            new Uri($"/api/apps/{appId}/catalog", UriKind.Relative),
            new CreateCatalogItemRequest("api", title, null, TestJson.Http("GET", "/clientes/{id}")));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<CatalogItemResponse>())!.Id;
    }

    private static async Task<Guid> CreateFeatureAsync(HttpClient client, Guid appId, string name)
    {
        var response = await client.PostAsJsonAsync(
            new Uri($"/api/apps/{appId}/features", UriKind.Relative), new CreateFeatureRequest(name));
        return (await response.Content.ReadFromJsonAsync<FeatureResponse>())!.Id;
    }
}
