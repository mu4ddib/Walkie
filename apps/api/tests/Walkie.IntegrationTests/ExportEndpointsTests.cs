using System.IO.Compression;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json.Nodes;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Files.Contracts;

namespace Walkie.IntegrationTests;

/// <summary>Export de una feature como .zip (spec export-markdown, criterios 2 y 9). Datos ficticios.</summary>
[Collection(ApiTestGroup.Name)]
public sealed class ExportEndpointsTests(WalkieApiFactory factory)
{
    [Fact]
    public async Task Sin_token_responde_401()
    {
        using var client = factory.CreateClient();

        var response = await client.GetAsync(ExportUri(Guid.CreateVersion7()));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Una_feature_inexistente_responde_404()
    {
        using var client = factory.CreateAuthenticatedClient();

        var response = await client.GetAsync(ExportUri(Guid.CreateVersion7()));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Devuelve_un_zip_con_el_markdown_y_las_imagenes_de_las_pantallas()
    {
        using var client = factory.CreateAuthenticatedClient();
        var app = await CreateAppAsync(client);
        var feature = await CreateFeatureAsync(client, app, "Iniciar sesión");
        var transferir = await CreateFeatureAsync(client, app, "Transferir");
        var item = await CreateItemAsync(client, app);
        var image = TestImages.Create("png", 2, 2);
        var asset = await UploadAsync(client, app, image);
        await SaveAsync(client, feature, Graph(asset, item, transferir));

        var response = await client.GetAsync(ExportUri(feature));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/zip", response.Content.Headers.ContentType!.MediaType);
        Assert.Equal("attachment", response.Content.Headers.ContentDisposition!.DispositionType);
        Assert.Equal("iniciar-sesion.zip", response.Content.Headers.ContentDisposition.FileName?.Trim('"'));

        var files = await UnzipAsync(response);
        var imagePath = $"img/login-{asset.ToString("N")[..8]}.png";
        Assert.Equal([imagePath, "iniciar-sesion.md"], files.Keys.Order(StringComparer.Ordinal));
        Assert.Equal(image, files[imagePath]);

        var markdown = Encoding.UTF8.GetString(files["iniciar-sesion.md"]);
        Assert.StartsWith("# Iniciar sesión\n\nApp: **Banca de prueba** · Versión del lienzo: 1 ·", markdown, StringComparison.Ordinal);
        Assert.Contains($"![Login]({imagePath})", markdown, StringComparison.Ordinal);
        Assert.Contains("### Consultar cliente (del catálogo)", markdown, StringComparison.Ordinal);
        Assert.Contains("Lleva a **Transferir**.", markdown, StringComparison.Ordinal);
        Assert.Contains("```mermaid\nflowchart LR\n", markdown, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Sin_imagenes_el_zip_solo_trae_el_markdown()
    {
        using var client = factory.CreateAuthenticatedClient();
        var feature = await CreateFeatureAsync(client, await CreateAppAsync(client), "Transferir");

        var files = await UnzipAsync(await client.GetAsync(ExportUri(feature)));

        Assert.Equal(["transferir.md"], files.Keys);
        Assert.EndsWith("Este lienzo está vacío.\n", Encoding.UTF8.GetString(files["transferir.md"]), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Exporta_la_ultima_version_guardada()
    {
        using var client = factory.CreateAuthenticatedClient();
        var app = await CreateAppAsync(client);
        var feature = await CreateFeatureAsync(client, app, "Iniciar sesión");
        var graph = Graph(null, null, null);
        await SaveAsync(client, feature, graph);
        graph["version"] = 1;
        graph["nodes"]!["s1"]!["title"] = "Login nuevo";
        await SaveAsync(client, feature, graph);

        var markdown = Encoding.UTF8.GetString((await UnzipAsync(await client.GetAsync(ExportUri(feature))))["iniciar-sesion.md"]);

        Assert.Contains("Versión del lienzo: 2", markdown, StringComparison.Ordinal);
        Assert.Contains("### Login nuevo", markdown, StringComparison.Ordinal);
    }

    [Fact]
    public async Task La_web_puede_leer_el_nombre_del_archivo_por_CORS()
    {
        using var client = factory.CreateAuthenticatedClient();
        var feature = await CreateFeatureAsync(client, await CreateAppAsync(client), "Transferir");
        using var request = new HttpRequestMessage(HttpMethod.Get, ExportUri(feature));
        request.Headers.Add("Origin", "http://localhost:5173");

        var response = await client.SendAsync(request);

        Assert.Contains("Content-Disposition", response.Headers.GetValues("Access-Control-Expose-Headers"));
    }

    [Fact]
    public async Task El_endpoint_aparece_en_openapi()
    {
        using var client = factory.CreateClient();

        var doc = await client.GetStringAsync(new Uri("/openapi/v1.json", UriKind.Relative));

        Assert.Contains("\"/api/features/{featureId}/export\"", doc, StringComparison.Ordinal);
    }

    [Fact]
    public async Task El_contexto_para_IA_sale_en_markdown_y_en_json_con_el_proposito_de_la_feature()
    {
        using var client = factory.CreateAuthenticatedClient();
        var app = await CreateAppAsync(client);
        var response = await client.PostAsJsonAsync(
            new Uri($"/api/apps/{app}/features", UriKind.Relative),
            new CreateFeatureRequest("Iniciar sesión", "El cliente entra con su documento y clave."));
        var feature = (await response.Content.ReadFromJsonAsync<FeatureResponse>())!.Id;
        await SaveAsync(client, feature, Graph(null, await CreateItemAsync(client, app), null));

        var markdown = await client.GetAsync(AiUri(feature, "ai"));
        var json = await client.GetAsync(AiUri(feature, "ai-json"));

        Assert.Equal(HttpStatusCode.OK, markdown.StatusCode);
        Assert.Equal("text/markdown", markdown.Content.Headers.ContentType!.MediaType);
        Assert.Equal("iniciar-sesion-contexto-ia.md", markdown.Content.Headers.ContentDisposition!.FileName?.Trim('"'));
        var text = await markdown.Content.ReadAsStringAsync();
        Assert.StartsWith("# Contexto para IA: Iniciar sesión", text, StringComparison.Ordinal);
        Assert.Contains("El cliente entra con su documento y clave.", text, StringComparison.Ordinal);
        Assert.Contains("### Consultar cliente (API)", text, StringComparison.Ordinal);

        Assert.Equal(HttpStatusCode.OK, json.StatusCode);
        Assert.Equal("application/json", json.Content.Headers.ContentType!.MediaType);
        Assert.Equal("iniciar-sesion.context.json", json.Content.Headers.ContentDisposition!.FileName?.Trim('"'));
        var context = await json.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        Assert.Empty(Walkie.Shared.Schemas.WalkieSchemas.Errors(Walkie.Shared.Schemas.WalkieSchemas.AiContext, context));
        Assert.Equal(feature, context.GetProperty("feature").GetProperty("id").GetGuid());
        Assert.Equal("El cliente entra con su documento y clave.", context.GetProperty("feature").GetProperty("description").GetString());
        Assert.Contains(context.GetProperty("gaps").EnumerateArray(), g => g.GetProperty("kind").GetString() == "request-without-response");
    }

    [Fact]
    public async Task Un_formato_desconocido_responde_400_y_una_feature_inexistente_404()
    {
        using var client = factory.CreateAuthenticatedClient();
        var feature = await CreateFeatureAsync(client, await CreateAppAsync(client), "Transferir");

        var unknown = await client.GetAsync(AiUri(feature, "pdf-gigante"));
        var missing = await client.GetAsync(AiUri(Guid.CreateVersion7(), "ai"));

        Assert.Equal(HttpStatusCode.BadRequest, unknown.StatusCode);
        var problem = await unknown.Content.ReadFromJsonAsync<Microsoft.AspNetCore.Mvc.ValidationProblemDetails>();
        Assert.Contains("format", problem!.Errors.Keys);
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
    }

    [Fact]
    public async Task El_contexto_de_la_app_reune_sus_features_y_su_catalogo_en_markdown_y_json()
    {
        using var client = factory.CreateAuthenticatedClient();
        var app = await CreateAppAsync(client);
        var login = await CreateFeatureAsync(client, app, "Iniciar sesión");
        var transferir = await CreateFeatureAsync(client, app, "Transferir");
        await SaveAsync(client, login, Graph(null, await CreateItemAsync(client, app), transferir));

        var markdown = await client.GetAsync(new Uri($"/api/apps/{app}/export", UriKind.Relative));
        var json = await client.GetAsync(new Uri($"/api/apps/{app}/export?format=ai-json", UriKind.Relative));

        Assert.Equal(HttpStatusCode.OK, markdown.StatusCode);
        Assert.Equal("text/markdown", markdown.Content.Headers.ContentType!.MediaType);
        Assert.Equal("banca-de-prueba-contexto-ia.md", markdown.Content.Headers.ContentDisposition!.FileName?.Trim('"'));
        var text = await markdown.Content.ReadAsStringAsync();
        Assert.StartsWith("# Contexto para IA: Banca de prueba (app completa)", text, StringComparison.Ordinal);
        Assert.Contains("- **Iniciar sesión** → **Transferir** (por el portal «Transferir»)", text, StringComparison.Ordinal);
        Assert.Contains("## Feature: Transferir", text, StringComparison.Ordinal);

        Assert.Equal(HttpStatusCode.OK, json.StatusCode);
        Assert.Equal("banca-de-prueba.app-context.json", json.Content.Headers.ContentDisposition!.FileName?.Trim('"'));
        var context = await json.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        Assert.Empty(Walkie.Shared.Schemas.WalkieSchemas.Errors(Walkie.Shared.Schemas.WalkieSchemas.AppAiContext, context));
        Assert.Equal(2, context.GetProperty("features").GetArrayLength());
        Assert.Equal("Iniciar sesión", context.GetProperty("catalog")[0].GetProperty("usedBy")[0].GetString());
    }

    [Fact]
    public async Task El_contexto_de_la_app_responde_400_con_otro_formato_y_404_si_no_existe()
    {
        using var client = factory.CreateAuthenticatedClient();
        var app = await CreateAppAsync(client);

        var markdownZip = await client.GetAsync(new Uri($"/api/apps/{app}/export?format=markdown", UriKind.Relative));
        var missing = await client.GetAsync(new Uri($"/api/apps/{Guid.CreateVersion7()}/export", UriKind.Relative));
        var anonymous = await factory.CreateClient().GetAsync(new Uri($"/api/apps/{app}/export", UriKind.Relative));
        var doc = await factory.CreateClient().GetStringAsync(new Uri("/openapi/v1.json", UriKind.Relative));

        Assert.Equal(HttpStatusCode.BadRequest, markdownZip.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        Assert.Contains("\"/api/apps/{appId}/export\"", doc, StringComparison.Ordinal);
    }

    private static Uri AiUri(Guid featureId, string format) =>
        new($"/api/features/{featureId}/export?format={format}", UriKind.Relative);

    /// <summary>Pantalla (con imagen si se da), <c>ref</c> a un elemento del catálogo y portal (si se dan), conectados.</summary>
    private static JsonObject Graph(Guid? asset, Guid? item, Guid? target)
    {
        var nodes = new JsonObject { ["s1"] = new JsonObject { ["id"] = "s1", ["type"] = "screen", ["title"] = "Login" } };
        var edges = new JsonObject();
        if (asset is not null)
        {
            nodes["s1"]!["assetId"] = asset.ToString();
        }

        if (item is not null)
        {
            nodes["c1"] = new JsonObject { ["id"] = "c1", ["type"] = "ref", ["title"] = "Consultar", ["catalogId"] = item.ToString() };
            edges["e1"] = new JsonObject { ["id"] = "e1", ["from"] = "s1", ["to"] = "c1", ["kind"] = "request" };
        }

        if (target is not null)
        {
            nodes["p1"] = new JsonObject { ["id"] = "p1", ["type"] = "portal", ["title"] = "Transferir", ["targetFeatureId"] = target.ToString() };
            edges["e2"] = new JsonObject { ["id"] = "e2", ["from"] = "s1", ["to"] = "p1", ["kind"] = "navigation" };
        }

        return new JsonObject
        {
            ["schemaVersion"] = 0, ["version"] = 0, ["nodes"] = nodes, ["edges"] = edges, ["layout"] = new JsonObject(),
        };
    }

    private static Uri ExportUri(Guid featureId) => new($"/api/features/{featureId}/export", UriKind.Relative);

    private static async Task<Dictionary<string, byte[]>> UnzipAsync(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        await using var stream = await response.Content.ReadAsStreamAsync();
        using var zip = new ZipArchive(stream, ZipArchiveMode.Read);
        var files = new Dictionary<string, byte[]>();
        foreach (var entry in zip.Entries)
        {
            using var content = entry.Open();
            using var bytes = new MemoryStream();
            await content.CopyToAsync(bytes);
            files[entry.FullName] = bytes.ToArray();
        }

        return files;
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
