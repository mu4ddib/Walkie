using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc;
using Walkie.Modules.Apps.Contracts;
using Walkie.Modules.Canvas.Contracts;

namespace Walkie.IntegrationTests;

/// <summary>Galería de features (spec espacio-de-trabajo, criterios 7 y 8 en la API): renombrar, descripción,
/// fechas, cantidad de features y vistas previas del lienzo. Datos ficticios.</summary>
[Collection(ApiTestGroup.Name)]
public sealed class FeatureGalleryTests(WalkieApiFactory factory)
{
    private const string AnyId = "0193a1b2-0000-7000-8000-000000000001";

    [Theory]
    [InlineData("PUT", "/api/features/" + AnyId)]
    [InlineData("GET", "/api/apps/" + AnyId + "/canvas-previews")]
    public async Task Sin_token_responde_401(string method, string path)
    {
        using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(new HttpMethod(method), new Uri(path, UriKind.Relative))
        {
            Content = JsonContent.Create(new { name = "x" }),
        };

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Crear_feature_con_descripcion_y_la_app_cuenta_sus_features()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);

        var response = await client.PostAsJsonAsync(
            FeaturesUri(appId), new CreateFeatureRequest("Transferir", "  Mover dinero entre cuentas propias  "));
        await client.PostAsJsonAsync(FeaturesUri(appId), new CreateFeatureRequest("Iniciar sesión"));

        var feature = await response.Content.ReadFromJsonAsync<FeatureResponse>();
        Assert.Equal("Mover dinero entre cuentas propias", feature!.Description);
        Assert.Equal(feature.CreatedAt, feature.UpdatedAt);
        var app = await client.GetFromJsonAsync<AppResponse>(new Uri($"/api/apps/{appId}", UriKind.Relative));
        Assert.Equal(2, app!.FeatureCount);
        var list = await client.GetFromJsonAsync<List<AppResponse>>(new Uri("/api/apps", UriKind.Relative));
        Assert.Equal(2, list!.Single(a => a.Id == appId).FeatureCount);
    }

    [Fact]
    public async Task Renombrar_feature_cambia_nombre_descripcion_y_fecha()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var created = await CreateFeatureAsync(client, appId, "Login");

        var response = await client.PutAsJsonAsync(
            FeatureUri(created.Id), new UpdateFeatureRequest("  Iniciar sesión  ", "Entrar con usuario y clave"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var updated = await response.Content.ReadFromJsonAsync<FeatureResponse>();
        Assert.Equal("Iniciar sesión", updated!.Name);
        Assert.Equal("Entrar con usuario y clave", updated.Description);
        Assert.Equal(created.CreatedAt, updated.CreatedAt);
        Assert.True(updated.UpdatedAt >= created.UpdatedAt);
        var features = await client.GetFromJsonAsync<List<FeatureResponse>>(FeaturesUri(appId));
        Assert.Equal([updated], features);

        var cleared = await client.PutAsJsonAsync(FeatureUri(created.Id), new UpdateFeatureRequest("Iniciar sesión", null));
        Assert.Equal("", (await cleared.Content.ReadFromJsonAsync<FeatureResponse>())!.Description);
    }

    [Fact]
    public async Task Renombrar_sin_nombre_o_con_descripcion_larga_responde_400()
    {
        using var client = factory.CreateAuthenticatedClient();
        var feature = await CreateFeatureAsync(client, await CreateAppAsync(client), "Login");

        var noName = await client.PutAsJsonAsync(FeatureUri(feature.Id), new UpdateFeatureRequest("  ", null));
        var longText = await client.PutAsJsonAsync(FeatureUri(feature.Id), new UpdateFeatureRequest("Login", new string('a', 501)));

        await AssertValidationErrorAsync(noName, "Name");
        await AssertValidationErrorAsync(longText, "Description");
    }

    [Fact]
    public async Task Renombrar_feature_inexistente_responde_404()
    {
        using var client = factory.CreateAuthenticatedClient();

        var response = await client.PutAsJsonAsync(FeatureUri(Guid.CreateVersion7()), new UpdateFeatureRequest("Login", null));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Vistas_previas_traen_nodos_con_posicion_y_conexiones_de_cada_lienzo_guardado()
    {
        using var client = factory.CreateAuthenticatedClient();
        var appId = await CreateAppAsync(client);
        var saved = await CreateFeatureAsync(client, appId, "Transferir");
        await CreateFeatureAsync(client, appId, "Sin lienzo");
        var item = await client.PostAsJsonAsync(
            new Uri($"/api/apps/{appId}/catalog", UriKind.Relative), new CreateCatalogItemRequest("database", "Cuentas", null, null));
        var itemId = (await item.Content.ReadFromJsonAsync<CatalogItemResponse>())!.Id;
        var put = await client.PutAsJsonAsync(new Uri($"/api/features/{saved.Id}/canvas", UriKind.Relative), Graph(itemId));
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);

        var previews = await client.GetFromJsonAsync<List<CanvasPreview>>(PreviewsUri(appId));

        var preview = Assert.Single(previews!);
        Assert.Equal(saved.Id, preview.FeatureId);
        Assert.Equal(
            [new PreviewNode("s1", "screen", 10, 20, 240, 120), new PreviewNode("r1", "database", 400, 20, null, null)],
            preview.Nodes.OrderBy(n => n.X));
        Assert.Equal([new PreviewEdge("s1", "r1")], preview.Edges);
    }

    [Fact]
    public async Task Vistas_previas_de_una_app_inexistente_responden_404()
    {
        using var client = factory.CreateAuthenticatedClient();

        var response = await client.GetAsync(PreviewsUri(Guid.CreateVersion7()));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Los_endpoints_aparecen_en_openapi()
    {
        using var client = factory.CreateClient();

        var doc = await client.GetStringAsync(new Uri("/openapi/v1.json", UriKind.Relative));

        Assert.Contains("UpdateFeature", doc, StringComparison.Ordinal);
        Assert.Contains("GetCanvasPreviews", doc, StringComparison.Ordinal);
    }

    /// <summary>Pantalla con posición y tamaño, un ref a la BD sin tamaño y un nodo sin posición (no sale).</summary>
    private static JsonObject Graph(Guid catalogId) => new()
    {
        ["schemaVersion"] = 0,
        ["version"] = 0,
        ["nodes"] = new JsonObject
        {
            ["s1"] = new JsonObject { ["id"] = "s1", ["type"] = "screen", ["title"] = "Monto" },
            ["r1"] = new JsonObject { ["id"] = "r1", ["type"] = "ref", ["title"] = "Cuentas", ["catalogId"] = catalogId.ToString() },
            ["a1"] = new JsonObject { ["id"] = "a1", ["type"] = "actor", ["title"] = "Cliente" },
        },
        ["edges"] = new JsonObject
        {
            ["e1"] = new JsonObject { ["id"] = "e1", ["from"] = "s1", ["to"] = "r1", ["kind"] = "reads" },
        },
        ["layout"] = new JsonObject
        {
            ["s1"] = new JsonObject { ["x"] = 10, ["y"] = 20, ["w"] = 240, ["h"] = 120 },
            ["r1"] = new JsonObject { ["x"] = 400, ["y"] = 20 },
        },
    };

    private static Uri FeaturesUri(Guid appId) => new($"/api/apps/{appId}/features", UriKind.Relative);

    private static Uri FeatureUri(Guid featureId) => new($"/api/features/{featureId}", UriKind.Relative);

    private static Uri PreviewsUri(Guid appId) => new($"/api/apps/{appId}/canvas-previews", UriKind.Relative);

    private static async Task<Guid> CreateAppAsync(HttpClient client)
    {
        var response = await client.PostAsJsonAsync(new Uri("/api/apps", UriKind.Relative), new CreateAppRequest("Banca"));
        return (await response.Content.ReadFromJsonAsync<AppResponse>())!.Id;
    }

    private static async Task<FeatureResponse> CreateFeatureAsync(HttpClient client, Guid appId, string name)
    {
        var response = await client.PostAsJsonAsync(FeaturesUri(appId), new CreateFeatureRequest(name));
        return (await response.Content.ReadFromJsonAsync<FeatureResponse>())!;
    }

    private static async Task AssertValidationErrorAsync(HttpResponseMessage response, string field)
    {
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        Assert.Contains(field, problem!.Errors.Keys);
    }
}
